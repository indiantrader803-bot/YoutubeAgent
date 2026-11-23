import unittest
import curation
class Focus(unittest.TestCase):
    def test_filters_require_whole_phrases_and_support_unicode(self):
        self.assertTrue(curation.passes_filters('This is a neon clipping tool',['neon clipping'],['sponsor']))
        self.assertFalse(curation.passes_filters('A spaceship flies',['ship']))
        self.assertFalse(curation.passes_filters('This is a sponsor message',[],['sponsor']))
        self.assertTrue(curation.passes_filters('यह पुलिस की गाड़ी है',['पुलिस'],[]))
    def test_settings_and_rank_change_without_fake_match(self):
        self.assertEqual(curation.focus_settings({'include_phrases':'Neon, clips','exclude_phrases':'sponsor'}),('', ['neon','clips'], ['sponsor']))
        with self.assertRaises(ValueError):curation.focus_settings({'include_phrases':['x']*21})
        self.assertEqual(curation.focus_rank(.8,None),.8)
        self.assertGreater(curation.focus_rank(.7,1),curation.focus_rank(.8,0))
        self.assertEqual(curation.focus_match('police chase','An editing tutorial'),0)
if __name__=='__main__':unittest.main()
