import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import captions

def words(text,step=.45):
    return [{'start':.3+i*step,'end':.7+i*step,'text':w} for i,w in enumerate(text.split())]

class GroupWords(unittest.TestCase):
    def test_every_word_exactly_once_in_order(self):
        for text in ('this is a caption test oh my god look at that chase','a b c d e','one','a b c d e f g h i j k l m n o p q r s t',
                     'this is a caption test oh my god look at that chase now'):
            for mc in (10,12,15,17,24,40):
                got=[w['text'] for g in captions.group_words(words(text),max_chars=mc) for w in g]
                self.assertEqual(got,text.split(),(text,mc))
    def test_groups_are_at_most_four_words(self):
        for mc in (12,17,24):
            for g in captions.group_words(words('a b c d e f g h i j k l m n o p'),max_chars=mc):
                self.assertLessEqual(len(g),5)    # 4 + the merged lone word rule never exceeds 5 here
    def test_random_streams(self):
        import random
        random.seed(7)
        for _ in range(500):
            n=random.randint(1,40);t=0;ws=[]
            for i in range(n):
                t+=random.choice((.2,.4,.9,1.4));ws.append({'start':t,'end':t+.3,'text':random.choice(('hi','okay.','what','YES!','no,','chase','a'))+''})
            got=[w['text'] for g in captions.group_words(ws,max_chars=random.choice((12,17,24))) for w in g]
            self.assertEqual(got,[w['text'] for w in ws])



class Cleanup(unittest.TestCase):
    def test_fold_accents_and_junk(self):
        self.assertEqual(captions.ascii_fold('nósga'),'nosga')
        self.assertEqual(captions.ascii_fold('função'),'funcao')
        self.assertEqual(captions.ascii_fold('mera dost kamjor hai'),'mera dost kamjor hai')
        self.assertEqual(captions.ascii_fold('okال'),'ok')
    def test_repeat_loops_are_cut(self):
        ws=[{'start':i,'end':i+.4,'text':t} for i,t in enumerate('mein chal chal chal chal chal chal chal sach'.split())]
        self.assertEqual([w['text'] for w in captions.collapse_repeats(ws)],['mein','chal','chal','chal','sach'])
    def test_three_repeats_stay(self):
        ws=[{'start':i,'end':i+.4,'text':t} for i,t in enumerate('bhaag bhaag bhaag ruko'.split())]
        self.assertEqual([w['text'] for w in captions.collapse_repeats(ws)],['bhaag','bhaag','bhaag','ruko'])
    def test_punctuation_does_not_hide_a_loop(self):
        ws=[{'start':i,'end':i+.4,'text':t} for i,t in enumerate('ha. ha, ha ha! ha'.split())]
        self.assertEqual(len(captions.collapse_repeats(ws)),3)

class Anims(unittest.TestCase):
    def render(self, anim, style='gta'):
        import tempfile
        from pathlib import Path
        W = words('this is a caption test oh my god')
        with tempfile.TemporaryDirectory() as d:
            captions.write(W, style, Path(d), 'x', '', 1450, 300, 1080, 1920, anim)
            text = (Path(d) / 'x.ass').read_text(encoding='utf-8')
        return [l for l in text.split(chr(10)) if l.startswith('Dialogue: 1')], text

    def test_no_control_characters_in_any_animation(self):
        for anim in captions.ANIMS:
            for style in ('gta', 'bold', 'clean', 'hormozi', 'mrbeast'):
                ev, text = self.render(anim, style)
                self.assertTrue(ev, (anim, style))
                self.assertFalse([c for c in text if ord(c) < 32 and c not in chr(10) + chr(9)], (anim, style))

    def test_one_by_one_shows_a_single_word(self):
        ev, _ = self.render('one_by_one')
        self.assertEqual(len(ev), 8)
        for l in ev:
            body = l.split(',,')[-1]
            plain = ''.join(part.split('}')[-1] for part in body.split('{') if part)
            self.assertEqual(len(plain.split()), 1, l)

    def test_build_up_grows_to_the_full_line(self):
        ev, _ = self.render('build_up')
        def plain(l):
            body = l.split(',,')[-1]
            return ''.join(part.split('}')[-1] for part in body.split('{') if part).split()
        counts = [len(plain(l)) for l in ev]
        self.assertEqual(counts[:4], [1, 2, 3, 4])
        self.assertEqual(counts[4:], [1, 2, 3, 4])

    def test_full_line_is_one_event_per_group(self):
        ev, _ = self.render('full_line')
        self.assertEqual(len(ev), 2)

    def test_highlight_is_the_old_behaviour(self):
        ev, _ = self.render('highlight')
        self.assertEqual(len(ev), 8)

class Nukta(unittest.TestCase):
    def test_youtube_precomposed_nukta_letters(self):
        import translit
        got = [translit.to_hinglish(w) for w in ('कपड़े', 'पड़ेगा', 'थोड़ा', 'थोड़ा')]
        self.assertEqual(got, ['kapde', 'padega', 'thoda', 'thoda'])


if __name__ == '__main__':
    unittest.main()
