from unittest.mock import patch
import io,json,unittest
import curation,learn,smart
class Curation(unittest.TestCase):
    def test_balanced_does_not_reward_only_motion(self):
        weights=curation.profile_weights(learn.DEFAULT)
        self.assertGreater(weights['llm'],weights['motion']*4)
        self.assertEqual(curation.profile_weights(learn.DEFAULT,'action'),learn.DEFAULT)
        self.assertTrue(curation.filler('Like and subscribe. Hit the bell. We will start soon.'))
        self.assertFalse(curation.filler('I hit the wall but the car was still moving.'))
        self.assertFalse(curation.hook_supported('Mistake in life advice','Please follow me and hit the bell icon.'))
        self.assertTrue(curation.extract_hook('The police are behind us. No, the car is stuck.').endswith('No, the car is stuck'))      # may carry a short lead-in
    def test_quiet_transcript_candidates_cover_later_video(self):
        words=[{'start':i,'end':i+.7,'text':('actually' if i%37==0 else 'story')} for i in range(300)]
        candidates=curation.transcript_candidates(words,300,30,5)
        self.assertEqual(len(candidates),5);self.assertGreater(candidates[-1]['start'],200)
    def test_repeat_story_and_time_overlap_do_not_dominate(self):
        candidates=[{'start':0,'end':30,'rank':.9,'kind':'action','transcript':'police chase car crash'}, {'start':5,'end':35,'rank':.89,'kind':'action','transcript':'police chase car crash'}, {'start':40,'end':70,'rank':.88,'kind':'action','transcript':'police chase car crash'}, {'start':80,'end':110,'rank':.85,'kind':'humour','transcript':'my friend forgot the keys'}]
        chosen=curation.select(candidates,2)
        self.assertEqual(chosen[1]['kind'],'humour')
        self.assertEqual(curation.select(candidates,2,'action')[1]['start'],40)
    def test_unfounded_hook_and_context_only_evidence_fall_back(self):
        def response(payload):return io.BytesIO(json.dumps({'response':json.dumps(payload)}).encode())
        with patch('smart.urllib.request.urlopen',return_value=response({'score':9,'hook':'I won 500000 dollars','evidence':'I found my keys','kind':'story'})):
            result=smart._judge('fake','I found my keys under the chair after searching.')
        self.assertNotIn('500000',result['hook'])
        with patch('smart.urllib.request.urlopen',return_value=response({'score':8,'hook':'Secret winner exposed','evidence':'He won the prize','kind':'story'})):
            result=smart._judge('fake','[before] He won the prize [CLIP] I found my keys [after] Goodbye')
        self.assertTrue(result['hook'].endswith('I found my keys'))
if __name__=='__main__':unittest.main()
