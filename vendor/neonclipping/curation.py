"""Broader candidate discovery and duplicate-resistant final selection.

These are local curation rules, not newly trained visual event recognition.
"""
import math
import re
PROFILES=('balanced','action','dialogue')
KINDS=('action','reaction','humour','story','opinion','insight','other')
def focus_settings(body):
    brief=str(body.get('focus_brief') or '').strip()
    if len(brief)>800:raise ValueError('Keep the transcript focus under 800 characters.')
    def phrases(key):
        value=body.get(key) or []
        if isinstance(value,str):value=value.split(',')
        if not isinstance(value,list) or len(value)>20 or any(not isinstance(p,str) or len(p)>80 for p in value):raise ValueError('Use at most 20 phrases of 80 characters each.')
        return [p.strip().casefold() for p in value if p.strip()]
    return brief,phrases('include_phrases'),phrases('exclude_phrases')

def passes_filters(text,includes=(),excludes=()):
    text=' '.join(text.casefold().split())
    def contains(phrase):return bool(re.search(r'(?<!\w)'+re.escape(' '.join(phrase.casefold().split()))+r'(?!\w)',text))
    return (not includes or any(contains(p) for p in includes)) and not any(contains(p) for p in excludes)

def focus_match(brief,text):
    query=set(re.findall(r'\w+',brief.casefold()))-{'a','an','the','and','or','of','in','to','about','moments','clips','find','me'}
    source=set(re.findall(r'\w+',text.casefold()))
    return len(query&source)/max(1,len(query))

def focus_rank(score,relevance):
    return score if relevance is None else .65*score+.35*max(0,min(1,relevance))
def filler(text):
    phrases=('like and subscribe','hit the bell','follow me','we will start soon','give me a minute','welcome back everyone','thanks for watching')
    lower=text.casefold()
    return sum(phrase in lower for phrase in phrases)>=2

def extract_hook(text):
    """Use a real payoff sentence when a small model cannot support its proposed hook."""
    sentences=[part.strip() for part in re.split(r'[.!?।\n]+',text) if len(part.split())>=3]
    if not sentences:return ' '.join(text.split()[:9])[:80]
    def merit(sentence):
        tokens=sentence.casefold()
        cues=('but','instead','wrong','stuck','finally','silence','impact','whole time','mistake','lekin','isliye','galti','actually','police','car','gaadi','keys')
        return sum(2 if cue in ('stuck','whole time','silence','impact','lekin','isliye') else 1 for cue in cues if cue in tokens)-max(0,len(sentence.split())-12)*.05
    line=max(sentences,key=merit);tokens=line.split()
    tokens=tokens if len(tokens)<=9 else tokens[-9:]
    hook=' '.join(tokens)
    if len(tokens)<=6 and not hook.endswith(('?','!')):
        hook=('Wait for it: ','This is the part: ','Listen to this: ')[sum(map(ord,hook))%3]+hook
    return hook[:80]

def hook_supported(hook,text):
    if len(hook.split())<4:return False
    stop={'the','a','an','is','in','of','to','and','with','this','that','for','on','it','his','her','he','she','they','their','my','me','i','you','your','was','are','how','why','what','when','reveals','revealed','unexpected','surprising'}
    def words(value):
        tokens=re.findall(r'\w+',value.casefold());result=set()
        for token in tokens:
            if token in stop:continue
            for ending in ('ing','ed','es','s'):
                if token.endswith(ending) and len(token)>len(ending)+3:token=token[:-len(ending)];break
            result.add(token)
        return result
    proposed,source=words(hook),words(text)
    shared=len(proposed&source)      # a punchy hook only has to name something that is really in the clip (numbers are checked separately)
    return shared>=1 and shared/max(1,len(proposed))>=.25
def profile_weights(weights,profile='balanced'):
    if profile not in PROFILES:raise ValueError('Choose Balanced, Action or Dialogue moments.')
    out=dict(weights)
    factors={'balanced':{'llm':2.5,'motion':.5,'loud':.7,'shout':.65,'flash':.5,'strobe':.5,'cuts':.6},'dialogue':{'llm':3.5,'motion':.25,'loud':.4,'shout':.4,'flash':.25,'strobe':.25,'cuts':.4},'action':{}}[profile]
    for key,value in factors.items():out[key]=out.get(key,0)*value
    return out

def transcript_candidates(words,duration,length,count,focus=''):
    if not words or count<1:return []
    count=max(1,min(30,count));length=min(length,duration);out=[]
    markers=re.compile(r'\b(but|actually|instead|why|how|because|wait|wrong|mistake|never|finally|imagine|secret|lekin|kyun|kaise|galti|pata|achanak)\b',re.I)
    for bucket in range(count):
        a=duration*bucket/count;b=duration*(bucket+1)/count
        positions=[i for i,word in enumerate(words) if a<=word['start']<b]
        if not positions:continue
        def merit(index):
            text=' '.join(w['text'] for w in words[index:index+30]);return len(markers.findall(text))+.7*text.count('?')+.3*text.count('!')+8*focus_match(focus,text)
        index=max(positions,key=merit);start=max(0,min(words[index]['start']-.3,duration-length));end=min(duration,start+length)
        visible=[w for w in words if start<=w['start']<end]
        if len(visible)<8:continue
        out.append({'start':round(start,2),'end':round(end,2),'title':'Dialogue candidate','score':0,'reason':'Transcript-led candidate: review story, joke, opinion or insight','status':'done','proposal_kind':'dialogue','features':{}})
    return out

def select(clips,count,profile='balanced'):
    """Balance relevance with topic/category variety; reject strongly overlapping repeats."""
    remaining=sorted(clips,key=lambda clip:-clip.get('rank',0));chosen=[]
    def tokens(clip):return set(re.findall(r'\w+',clip.get('transcript','').casefold()))
    def overlap(a,b):return max(0,min(a['end'],b['end'])-max(a['start'],b['start']))/max(.001,min(a['end']-a['start'],b['end']-b['start']))
    while remaining and len(chosen)<count:
        candidates=[c for c in remaining if not any(overlap(c,old)>.35 for old in chosen)]
        if not candidates:break
        def merit(candidate):
            score=candidate.get('rank',0)
            if profile=='action':return score
            words=tokens(candidate);similarity=max((len(words&tokens(old))/max(1,len(words|tokens(old))) for old in chosen),default=0)
            repeated=any(candidate.get('kind') in KINDS[:-1] and candidate.get('kind')==old.get('kind') for old in chosen)
            return score-.20*similarity-(.08 if repeated else 0)
        winner=max(candidates,key=merit);chosen.append(winner);remaining.remove(winner)
    return chosen
