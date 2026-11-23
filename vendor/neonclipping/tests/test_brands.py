import tempfile
import unittest
from pathlib import Path
from fastapi import FastAPI,HTTPException
import brands
import captions

class CaptionBrands(unittest.TestCase):
    def test_strict_values_prevent_ass_injection(self):
        for config in ({'caption_font':'Arial,120'},{'caption_color':'red'},{'caption_size':float('nan')},{'caption_max_words':0},{'caption_font':'Bad{font}'}):
            with self.assertRaises((ValueError,TypeError)):brands.appearance(config)
        self.assertEqual(brands.ass_color('#12AB34'),'&H0034AB12&')

    def test_profiles_persist_without_polluting_clip_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            data=Path(tmp);app=FastAPI();brands.attach(app,data)
            routes={r.path:r.endpoint for r in app.routes if hasattr(r,'endpoint')}
            # Both methods share a path, so select them explicitly.
            save=next(r.endpoint for r in app.routes if r.path=='/brands' and 'POST' in r.methods)
            get=next(r.endpoint for r in app.routes if r.path=='/brands' and 'GET' in r.methods)
            save({'name':'GTA Neon','settings':{'caption_font':'Impact','caption_color':'#12ab34','caption_size':90}})
            self.assertEqual(list(data.glob('*.json')),[])
            second=FastAPI();brands.attach(second,data)
            restored=next(r.endpoint for r in second.routes if r.path=='/brands' and 'GET' in r.methods)()
            self.assertEqual(restored['profiles']['GTA Neon']['caption_color'],'#12AB34')
            with self.assertRaises(HTTPException):save({'name':'','settings':{'caption_size':90}})

    def test_one_word_groups_and_rendered_ass_settings(self):
        words=[{'start':i*.6,'end':i*.6+.5,'text':w} for i,w in enumerate(('hello','there','friend'))]
        with tempfile.TemporaryDirectory() as tmp:
            data=Path(tmp)
            captions.write(words,'gta',data,'custom',appearance={'caption_font':'Impact','caption_size':96,'caption_color':'#12AB34','caption_active':'#FE12AB','caption_outline':'#010203','caption_max_words':1})
            ass=(data/'custom.ass').read_text(encoding='utf-8')
            self.assertIn('Main,Impact,',ass);self.assertIn('\\fs96',ass)
            self.assertIn('\\3c&H00030201&',ass);self.assertIn('&H00AB12FE&',ass)
            self.assertEqual(len(captions.group_words(words,max_words=1)),3)
            self.assertTrue(all(len(group)==1 for group in captions.group_words(words,max_words=1)))

if __name__=='__main__':unittest.main()
