"""Feature weights + a feedback loop: star ratings from the user slowly re-weight what makes a clip good.

Every candidate clip gets features in 0..1: loud (sudden loudness), shout (raised voice), words (exclamations said),
motion, flash, strobe, cuts, llm (local AI score / 10). Score = weighted sum of the features that are available.
Ratings (1-5 stars) are stored locally in data/feedback.jsonl. With enough ratings the weights are fitted by ridge regression that
pulls back toward the defaults, blended in gradually (alpha = n/60, max 0.85). Nothing is uploaded.
"""
import json
import time
import math
import threading
from pathlib import Path
import numpy as np

FEATURES = ['loud', 'shout', 'words', 'motion', 'flash', 'strobe', 'cuts', 'llm', 'chat']
DEFAULT = {'loud': .17, 'shout': .13, 'words': .20, 'motion': .17, 'flash': .08, 'strobe': .04, 'cuts': .03, 'llm': .18, 'chat': .14}
MIN_RATINGS = 8
LOCK=threading.RLock()


def _paths(data):
    return Path(data) / 'feedback.jsonl', Path(data) / 'weights.json'


def load_weights(data):
    _, wp = _paths(data)
    try:
        w = json.loads(wp.read_text(encoding='utf-8'))
        if not isinstance(w,dict):raise ValueError('Invalid learned weights')
        result={k: float(w.get(k, DEFAULT[k])) for k in FEATURES}
        if not all(math.isfinite(v) and v>0 for v in result.values()):raise ValueError('Invalid learned weights')
        return result
    except (OSError, ValueError,TypeError):
        return dict(DEFAULT)


def score(features, weights):
    """Weighted mean over the features that exist (missing ones do not count as zero)."""
    num = den = 0.0
    for k in FEATURES:
        if features.get(k) is None:
            continue
        num += weights[k] * float(features[k])
        den += weights[k]
    return num / den if den else 0.0


def ratings(data):
    fp, _ = _paths(data)
    out = []
    if fp.exists():
        for line in fp.read_text(encoding='utf-8').splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    latest={}
    for row in out:
        if not isinstance(row,dict) or not row.get('file') or row.get('rating') not in (1,2,3,4,5) or not isinstance(row.get('features'),dict):continue
        values=[row['features'].get(k) for k in FEATURES if row['features'].get(k) is not None]
        if not values or any(not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=1 for v in values):continue
        key=row.get('moment_id') or row['file']
        if not isinstance(key,str):continue
        latest[key]=row
    return list(latest.values())

def moment_id(data,file):
    """Revisions of one selected moment count as one training example."""
    seen=set()
    while file not in seen:
        seen.add(file)
        try:parent=json.loads((Path(data)/(file+'.json')).read_text(encoding='utf-8')).get('settings',{}).get('revision_of')
        except (OSError,ValueError):break
        if not isinstance(parent,str) or not parent.isalnum():break
        file=parent
    return file


def record(data, file, rating, features, extra=None):
    if not isinstance(file,str) or not file.isalnum() or rating not in (1,2,3,4,5):raise ValueError('Choose a saved moment and a rating from 1 to 5.')
    if not isinstance(features,dict):raise ValueError('No usable scoring features for this moment.')
    features={k:features.get(k) for k in FEATURES}
    values=[v for v in features.values() if v is not None]
    if not values or any(not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=1 for v in values):raise ValueError('Invalid moment scoring features.')
    fp, _ = _paths(data)
    row = {'t': int(time.time()), 'file': file, 'rating': int(rating), 'features': features, **(extra or {}),'moment_id':moment_id(data,file)}
    with LOCK:
        with fp.open('a', encoding='utf-8') as f:f.write(json.dumps(row, ensure_ascii=False) + '\n')
        return refit(data)


def _refit(data):
    """Ridge regression of rating on features, shrunk toward DEFAULT. Returns a summary dict (also saves weights.json)."""
    rows = [r for r in ratings(data) if r.get('features')]
    n = len(rows)
    summary = {'ratings': n, 'weights': dict(DEFAULT), 'fitted': False, 'insight': [],'message':f'Rate {max(0,MIN_RATINGS-n)} more different moments to start adapting.'}
    if n >= MIN_RATINGS:
        X = np.array([[float(r['features'].get(k)) if r['features'].get(k) is not None else np.nan for k in FEATURES] for r in rows])
        for column in range(len(FEATURES)):
            observed=X[:,column][np.isfinite(X[:,column])];mean=float(observed.mean()) if len(observed) else 0
            X[~np.isfinite(X[:,column]),column]=mean
        y = np.array([(r['rating'] - 3) / 2.0 for r in rows])      # -1..1
        if y.std()<1e-6 or not np.any(X.std(axis=0)>1e-6):
            summary['message']='Rate a mix of stronger and weaker moments; these ratings do not yet provide a useful comparison.'
            _save_weights(data,summary['weights']);return summary
        # correlation per feature (what the data says)
        corr = {}
        for j, k in enumerate(FEATURES):
            if X[:, j].std() > 1e-6 and y.std() > 1e-6:
                corr[k] = float(np.corrcoef(X[:, j], y)[0, 1])
        w0 = np.array([DEFAULT[k] for k in FEATURES])
        w0=w0/w0.sum()
        lam = 2.0
        # solve min ||X w - y||^2 + lam ||w - w0||^2  (centered features)
        Xc = X - X.mean(axis=0)
        A = Xc.T @ Xc + lam * np.eye(len(FEATURES))
        b = Xc.T @ y + lam * w0
        wf = np.clip(np.linalg.solve(A, b), 0.01, None)
        wf = wf / wf.sum()
        alpha = min(0.85, n / 60.0)
        w = (1 - alpha) * w0 + alpha * wf
        w = w / w.sum()
        summary.update(weights={k: round(float(v), 4) for k, v in zip(FEATURES, w)}, fitted=True, alpha=round(alpha, 2))
        summary['message']='Preferences updated from different rated moments.'
        ranked = sorted(corr.items(), key=lambda kv: -abs(kv[1]))[:3]
        summary['insight'] = [f"{k}: {'higher' if c > 0 else 'lower'} = better rated ({c:+.2f})" for k, c in ranked]
    _save_weights(data,summary['weights'])
    return summary

def _save_weights(data,weights):
    _,wp=_paths(data);temp=wp.with_suffix('.tmp');temp.write_text(json.dumps(weights),encoding='utf-8');temp.replace(wp)

def refit(data):
    with LOCK:return _refit(data)
