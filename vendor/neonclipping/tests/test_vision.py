import io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI,HTTPException
import vision
class VisualReview(unittest.TestCase):
    def test_structured_model_output_is_readable_text(self):
        self.assertEqual(vision.clean_description('{"description":"A plane is visible."}'),'A plane is visible.')
    def test_unsupported_vision_only_model_is_not_advertised(self):
        response=io.BytesIO(json.dumps({'models':[{'name':'moondream:latest','capabilities':['vision']}]}).encode())
        with patch('vision.urllib.request.urlopen',return_value=response):self.assertIsNone(vision.model())
    def test_cached_review_reuses_model_outputs_and_sample_times(self):
        with tempfile.TemporaryDirectory() as tmp,patch('vision.model',return_value='gemma4:test'),patch('vision.subprocess.check_output',return_value=b'jpeg'),patch('vision.describe',return_value='A plane is visible.') as describe:
            data=Path(tmp);first=vision.review(data/'source.mp4',10,20,data);again=vision.review(data/'source.mp4',10,20,data)
            self.assertFalse(first['cached']);self.assertTrue(again['cached']);self.assertEqual(describe.call_count,3)
            self.assertEqual([f['time'] for f in again['frames']],[13,20,27])
            moved=vision.review(data/'source.mp4',20,20,data)
            self.assertNotEqual(first['key'],moved['key'])
            self.assertEqual(list(data.glob('*.json')),[])
    def test_frame_route_rejects_traversal_and_missing_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            app=FastAPI();vision.attach(app,Path(tmp),{},lambda p:{'duration':10});routes={r.path:r.endpoint for r in app.routes}
            for key,index in (('../outside',0),('a'*64,3)):
                with self.assertRaises(HTTPException):routes['/vision/frame/{key}/{index}'](key,index)
            with self.assertRaises(HTTPException):routes['/vision/review']({'id':'missing','end':5})
if __name__=='__main__':unittest.main()
