from pathlib import Path
import tempfile
import unittest
from layouts import CATALOG, geometry, output_settings, text_positions
from captions import write

class Formats(unittest.TestCase):
    def test_all_formats_and_layouts_fit_even_pixel_canvas(self):
        for aspect in ('vertical','square','portrait','threefour','landscape'):
            for resolution in (720,1080,2160):
                width,height,_=output_settings({'aspect':aspect,'resolution':resolution})
                self.assertEqual(width%2,0);self.assertEqual(height%2,0)
                for name,_,_ in CATALOG:
                    for size in (.2,.5):
                        for layer in geometry(name,size,width,height)['layers']:
                            self.assertGreater(layer['w'],0);self.assertGreater(layer['h'],0)
                            self.assertGreaterEqual(layer['x'],0);self.assertGreaterEqual(layer['y'],0)
                            self.assertLessEqual(layer['x']+layer['w'],width)
                            self.assertLessEqual(layer['y']+layer['h'],height)

    def test_captions_have_matching_canvas_and_center(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            for width,height in ((1080,1920),(1920,1080),(720,720)):
                for style in ('clean','gta','hormozi'):
                    placement=text_positions('game',width=width,height=height)
                    write([{'start':0,'end':1,'text':'Readable'}],style,folder,'test','Short hook',placement['caption_y'],placement['hook_y'],width,height)
                    text=(folder/'test.ass').read_text(encoding='utf-8')
                    self.assertIn('PlayResX: '+str(width),text);self.assertIn('PlayResY: '+str(height),text)
                    self.assertIn('\\pos('+str(width//2)+',',text)

    def test_unsupported_output_requests_rejected(self):
        for body in ({'aspect':'bad'},{'resolution':10000},{'fps':10000}):
            with self.assertRaises(ValueError):output_settings(body)

if __name__=='__main__':unittest.main()
