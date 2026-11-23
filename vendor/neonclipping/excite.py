"""Excitement from WHAT IS SAID: gamers shout "oh my god", "oh shit", "run", "police", "bhaago", "arre yaar"...

Works on word-timed transcripts (YouTube captions or Whisper). Returns a per-second signal (for finding candidate moments in
the whole video) and a window score (for ranking a candidate). Lexicon weights are a first guess; the feedback loop in learn.py
re-weights the *feature* (how much a clip's exclamations matter), not the words.
"""
import re
import numpy as np

# (regex, weight). Roman + Devanagari. Panic / hype / violence / chase / disbelief / pain.
_LEX = [
    (r"oh my (god|gosh)|omg|oh shit|holy (shit|crap|fuck|hell)?|no way|what the (fuck|f|hell)|wtf|oh no+|nooo+|oh fuck|oh god", 3),
    (r"let'?s go+|lets go+|insane|crazy|bruh|yooo+|yoo+|ayo|bro+\b|dude|sheesh|goat|clip (it|that)", 2),
    (r"run|run run|go go|get out|watch out|behind you|help|police|cops?|chase|chasing|wanted|swat|shoot|shot|shooting|gun|kill|killed|dead|die|dying|dies", 2),
    (r"boom|explo\w*|blast|blow|crash\w*|fire|burn\w*|bomb|grenade|rocket|jump|flip\w*|fall\w*|drop\w*|ahh+|aaa+h*|scream\w*", 2),
    (r"are+ yaar|arre+|are bhai|oye+|abe+|bhaag\w*|bhago|bachao|pulis|police wale|maar\w*|gaya|goli\w*|dhamaka|uff+|oh teri|kya baat|zabardast|pagal|mast|jhakaas|hat\s*teri", 2),
    (r"अरे+|भागो|भाग|बचाओ|पुलिस|मार|मर गया|गोली|धमाका|ब्लास्ट|पागल|उफ़|ओए|यार", 2),
]
_RX = [(re.compile(p, re.I), w) for p, w in _LEX]
# short interjections: weak on their own (1 point), strong when repeated or combined ("oh oh what the holy")
_WEAK = {'oh', 'ooh', 'whoa', 'woah', 'wow', 'yo', 'holy', 'damn', 'dang', 'ugh', 'aah', 'ahh', 'ah', 'bro', 'brother', 'nah', 'what', 'no', 'wait', 'stop', 'yes', 'yeah',
         'arre', 'are', 'abe', 'oye', 'uff', 'अरे', 'ओए', 'उफ़', 'वाह', 'नहीं'}
_PUNCT = re.compile(r"[!?]{1,}")


def word_weight(text):
    t = text.strip().lower()
    if not t:
        return 0.0
    w = 0.0
    for rx, wt in _RX:
        if rx.fullmatch(t) or (len(t) > 3 and rx.search(t) and rx.search(t).group(0) == t):
            w = max(w, wt)
    if w == 0 and t.strip(',.!?') in _WEAK:
        w = 0.7
    if t.endswith('!'):
        w += 1.0
    return w


def _phrase_weight(words, i):
    """Two/three-word phrases such as 'oh my god' or 'oh shit' are matched on the joined text."""
    best = 0.0
    for n in (3, 2):
        if i + n <= len(words):
            joined = ' '.join(w['text'].strip(',.!?').lower() for w in words[i:i + n])
            for rx, wt in _RX:
                m = rx.search(joined)
                if m and len(m.group(0)) >= len(joined) - 1:
                    best = max(best, wt)
    return best


def seconds_signal(words, duration):
    """Per-second excitement 0..1 over the whole video (smoothed 5 s)."""
    n = max(1, int(np.ceil(duration)))
    sig = np.zeros(n)
    for i, w in enumerate(words):
        wt = max(word_weight(w['text']), _phrase_weight(words, i))
        if wt:
            s = min(n - 1, int(w['start']))
            sig[s] += wt
    sig = np.minimum(sig, 6)
    k = np.ones(5) / 5
    sm = np.convolve(sig, k, 'same')
    peak = max(float(np.percentile(sm[sm > 0], 95)) if (sm > 0).any() else 1.0, 1.0)
    return np.clip(sm / peak, 0, 1)


def window_score(words, duration):
    """0..1: how exclamation-dense a candidate clip is. `words` are relative to the clip start."""
    if not words or duration <= 0:
        return 0.0
    total = 0.0
    for i, w in enumerate(words):
        total += max(word_weight(w['text']), _phrase_weight(words, i))
    density = total / max(duration / 8.0, 1.0)          # about one strong shout per 8 s = 3 points per 8 s
    return float(min(1.0, density / 4.0))
