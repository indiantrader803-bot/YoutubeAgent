import tempfile
import unittest
from pathlib import Path
from fastapi import FastAPI
import transcripts

class Transcripts(unittest.TestCase):
    def test_phrase_search_crosses_cues_and_preserves_source_times(self):
        words=[{'start':i,'end':i+.8,'text':text} for i,text in enumerate(['hello','GTA','six','नमस्ते','दुनिया'])]
        result=transcripts.search(words,'gta SIX')
        self.assertEqual(len(result),1);self.assertEqual(result[0]['match_start'],1);self.assertEqual(result[0]['match_end'],2.8)
        self.assertEqual(len(transcripts.search(words,'नमस्ते दुनिया')),1)
        self.assertEqual(transcripts.search(words,'absent'),[])
        self.assertEqual(transcripts.search(words,'',1,1),[])
        many=[dict(start=i,end=i+.8,text='word') for i in range(120)]
        self.assertEqual(transcripts.search(many,'',2,2)[0]['start'],40)
        self.assertEqual(transcripts.search(many,'word',2,2)[0]['match_start'],2)

    def test_import_cache_search_and_no_asr(self):
        with tempfile.TemporaryDirectory() as tmp:
            data=Path(tmp);(data/'source.mp4').touch();app=FastAPI();state={}
            def forbidden(*args):raise AssertionError('Must not transcribe imported transcript')
            transcripts.attach(app,data,state,lambda p:{'duration':100},forbidden)
            routes={r.path:r.endpoint for r in app.routes}
            source={'id':'source','text':'1\n00:00:10,000 --> 00:00:12,000\nHello world\n'}
            imported=routes['/transcripts/import'](source)
            cached=routes['/transcripts/load']({'id':'source'})
            self.assertTrue(cached['cached']);self.assertEqual(cached['transcript'],imported)
            self.assertEqual(routes['/transcripts/search']({'key':imported['key'],'query':'hello world'})['matches'][0]['start'],10)
            self.assertEqual(list(data.glob('*.json')),[])
            # Replacing source content invalidates the old cache identity.
            (data/'source.mp4').write_bytes(b'new source')
            self.assertTrue(routes['/transcripts/load']({'id':'source'})['missing'])

if __name__=='__main__':unittest.main()
