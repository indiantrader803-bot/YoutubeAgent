import json,tempfile,unittest
from pathlib import Path
import learn
class PreferenceLearning(unittest.TestCase):
    def test_repeated_clicks_and_revisions_do_not_fake_training_examples(self):
        with tempfile.TemporaryDirectory() as tmp:
            data=Path(tmp);features={'words':.8,'motion':.2}
            for rating in (1,2,3,4,5,1,2,5):result=learn.record(data,'original',rating,features)
            self.assertEqual(result['ratings'],1);self.assertFalse(result['fitted'])
            (data/'revision.json').write_text(json.dumps({'settings':{'revision_of':'original'}}))
            result=learn.record(data,'revision',1,features)
            self.assertEqual(result['ratings'],1)
            self.assertEqual(learn.ratings(data)[0]['rating'],1)
            self.assertEqual(len((data/'feedback.jsonl').read_text().splitlines()),9)
    def test_real_regression_fit_uses_varied_distinct_labels(self):
        with tempfile.TemporaryDirectory() as tmp:
            data=Path(tmp)
            for i in range(8):result=learn.record(data,'clip'+str(i),1 if i<4 else 5,{'words':i/7,'motion':1-i/7,'chat':None})
            self.assertTrue(result['fitted']);self.assertEqual(result['ratings'],8)
            weights=learn.load_weights(data)
            self.assertAlmostEqual(sum(weights.values()),1,places=3)
            self.assertGreater(weights['words']/weights['motion'],learn.DEFAULT['words']/learn.DEFAULT['motion'])
    def test_constant_labels_and_corrupt_records_do_not_claim_training(self):
        with tempfile.TemporaryDirectory() as tmp:
            data=Path(tmp)
            for i in range(8):result=learn.record(data,'clip'+str(i),5,{'words':i/7})
            self.assertFalse(result['fitted']);self.assertIn('mix',result['message'])
            with (data/'feedback.jsonl').open('a') as f:f.write('bad json\nnull\n'+json.dumps({'file':'bad','rating':5,'features':{'words':float('nan')}})+'\n')
            self.assertEqual(len(learn.ratings(data)),8)
            (data/'weights.json').write_text('[1,2]')
            self.assertEqual(learn.load_weights(data),learn.DEFAULT)
if __name__=='__main__':unittest.main()
