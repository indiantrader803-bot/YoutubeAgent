import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from fastapi import HTTPException
from bundles import build_bundle

class Bundles(unittest.TestCase):
    def test_exact_media_captions_copy_and_no_machine_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'clip.mp4').write_bytes(b'original compressed video bytes')
            (root/'clip.srt').write_text('1\n00:00:00,000 --> 00:00:01,000\nHello\n')
            settings={'title':'CON:/ unsafe? title','hook':'Hello','post_caption':'A post','start':1,'end':2}
            (root/'clip.json').write_text(json.dumps({'source':'source','settings':settings,'result':{'status':'done','caption_words':1}}))
            result=build_bundle(root,['clip','clip'],root/'bundles')
            self.assertEqual(result['clips'],1)
            with zipfile.ZipFile(root/'bundles'/(result['bundle']+'.zip')) as archive:
                self.assertIsNone(archive.testzip())
                media=next(name for name in archive.namelist() if name.endswith('.mp4'))
                self.assertEqual(archive.read(media),b'original compressed video bytes')
                self.assertIn('clips.txt',archive.namelist());self.assertIn('clips.json',archive.namelist())
                self.assertNotIn(str(root),archive.read('clips.json').decode())
                self.assertNotIn(':',media)

    def test_missing_media_and_bad_selection_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with self.assertRaises(HTTPException):build_bundle(root,[],root/'bundles')
            with self.assertRaises(HTTPException):build_bundle(root,['../outside'],root/'bundles')

if __name__=='__main__':unittest.main()
