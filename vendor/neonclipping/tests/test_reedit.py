"""Run: python -m unittest discover -s tests -v. No network, models or GPU required."""
import copy
import json
from pathlib import Path
import tempfile
import time
import unittest
from fastapi import FastAPI, HTTPException
from reedit import attach
from layouts import CATALOG, geometry, text_positions

class SavedClipEdits(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data=Path(self.temp.name);self.state={};self.submitted=[]
        self.app=FastAPI()
        for i,name in enumerate(('a','b','c')):
            (self.data/(name+'source.mp4')).write_bytes(b'local source placeholder')
            settings={'id':name+'source','start':i*10,'end':i*10+5,'layout':'stack',
                'top':.32,'cam':{'x':.8,'y':0,'w':.2,'h':.3},'game':{'x':0,'y':0,'w':.8,'h':1},
                'captions':True,'caption_style':'gta','caption_y':1450,'title':name,
                'source_url':'https://www.youtube.com/watch?v=example' if name!='c' else 'other',
                'words':[{'start':0,'end':1,'text':name}]}
            record={'source':name+'source','settings':settings,'result':{'status':'done','caption_words':1}}
            (self.data/(name+'.json')).write_text(json.dumps(record))
            (self.data/(name+'.mp4')).write_bytes(b'previous export')
        def save(job,fields):self.state[job]={**self.state.get(job,{}),**copy.deepcopy(fields)}
        def export(settings):
            self.submitted.append(copy.deepcopy(settings));job='new'+str(len(self.submitted))
            result={'status':'done','file':job,'srt':'/text/'+job+'/srt'}
            (self.data/(job+'.json')).write_text(json.dumps({'source':settings['id'],'settings':settings,'result':result}))
            self.state[job]=result
            return {'job':job}
        attach(self.app,self.data,self.state,lambda p:{'w':1280,'h':720,'duration':100},export,save)
        self.endpoints={route.path:route.endpoint for route in self.app.routes}

    def wait(self,job):
        deadline=time.monotonic()+3
        while self.state[job]['status']=='running' and time.monotonic()<deadline:time.sleep(.01)
        self.assertEqual(self.state[job]['status'],'done',self.state[job])

    def test_video_wide_edit_keeps_distinct_words_and_ranges(self):
        result=self.endpoints['/clips/reedit']({'file':'a','scope':'video','changes':{'layout':'circle','caption_style':'clean'},
            'words':[{'start':0,'end':1,'text':'edited a'}]})
        self.wait(result['job'])
        self.assertEqual(len(self.submitted),2)
        by_title={s['title']:s for s in self.submitted}
        self.assertEqual(by_title['a']['words'][0]['text'],'edited a')
        self.assertEqual(by_title['b']['words'][0]['text'],'b')
        self.assertEqual(by_title['a']['start'],0)
        self.assertEqual(by_title['b']['start'],10)
        self.assertTrue(all(s['layout']=='circle' for s in self.submitted))
        self.assertTrue((self.data/'a.mp4').exists())
        self.assertIn('superseded_by',json.loads((self.data/'a.json').read_text()))
        self.assertNotIn('superseded_by',json.loads((self.data/'c.json').read_text()))

    def test_invalid_batch_fails_before_any_export(self):
        with self.assertRaises(HTTPException) as caught:
            self.endpoints['/clips/reedit']({'file':'a','files':['a','b'],'changes':{'layout':'missing'}})
        self.assertEqual(caught.exception.status_code,400)
        self.assertEqual(self.submitted,[])

    def test_missing_source_does_not_download(self):
        (self.data/'asource.mp4').unlink()
        with self.assertRaises(HTTPException) as caught:
            self.endpoints['/clips/{file}/edit']('a')
        self.assertEqual(caught.exception.status_code,409)
        self.assertEqual(self.submitted,[])

    def test_all_layouts_have_bounded_geometry_and_safe_text(self):
        self.assertEqual(len(CATALOG),11)
        for name,_,_ in CATALOG:
            for size in (.2,.32,.5):
                for layer in geometry(name,size)['layers']:
                    self.assertGreater(layer['w'],0);self.assertGreater(layer['h'],0)
                    self.assertLessEqual(layer['x']+layer['w'],1080)
                    self.assertLessEqual(layer['y']+layer['h'],1920)
        self.assertGreater(text_positions('circle')['hook_y'],400)
        self.assertLess(text_positions('bottom')['caption_y'],1450)

if __name__=='__main__':unittest.main()
