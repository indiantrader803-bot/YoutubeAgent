"""Optional cloud AI: any OpenAI-compatible provider (Groq, OpenRouter, Gemini, OpenAI, LM Studio...) for scoring moments and writing titles and hooks.

Off by default. Nothing leaves the computer unless you switch it on. When it is on, only the TEXT of a candidate clip (its transcript lines) is
sent to the provider you chose; videos, audio and frames never are. The key is stored only in data/llm.json on this computer, is never
shown again by the page and is never written to the error log.

Settings: data/llm.json  {"enabled": true, "base_url": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile", "api_key": "..."}
or the environment variables NEONCLIPPING_LLM_BASE_URL, NEONCLIPPING_LLM_MODEL, NEONCLIPPING_LLM_KEY.
"""
from pathlib import Path
from urllib.parse import urlparse
import json, os, re, time, urllib.error, urllib.request

PREFIX = 'cloud:'
OLLAMA = 'http://127.0.0.1:11434'
ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('NEONCLIPPING_DATA_DIR', str(ROOT / 'data')))
PRESETS = {
    'groq': {'label': 'Groq (fast, free tier)', 'base_url': 'https://api.groq.com/openai/v1', 'model': 'llama-3.3-70b-versatile'},
    'openrouter': {'label': 'OpenRouter', 'base_url': 'https://openrouter.ai/api/v1', 'model': 'meta-llama/llama-3.3-70b-instruct'},
    'gemini': {'label': 'Google Gemini', 'base_url': 'https://generativelanguage.googleapis.com/v1beta/openai', 'model': 'gemini-2.5-flash'},
    'openai': {'label': 'OpenAI', 'base_url': 'https://api.openai.com/v1', 'model': 'gpt-4o-mini'},
    'lmstudio': {'label': 'LM Studio on this PC', 'base_url': 'http://127.0.0.1:1234/v1', 'model': ''},
}


def _path():
    return Path(os.environ.get('NEONCLIPPING_DATA_DIR', str(DATA))) / 'llm.json'


def valid_base_url(value):
    """https anywhere, or http only for this computer (LM Studio, llama.cpp). Returns the cleaned URL or raises ValueError."""
    url = str(value or '').strip().rstrip('/')
    if len(url) > 300:
        raise ValueError('The address is too long.')
    p = urlparse(url)
    local = (p.hostname or '').lower() in ('127.0.0.1', 'localhost', '::1')
    if p.scheme not in ('https', 'http') or not p.hostname or p.username or p.password:
        raise ValueError('Enter the provider address, for example https://api.groq.com/openai/v1')
    if p.scheme == 'http' and not local:
        raise ValueError('Use https for providers on the internet (http is only allowed for this computer).')
    return url


def _read():
    cfg = {}
    try:
        cfg = json.loads(_path().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        pass
    env_url = os.environ.get('NEONCLIPPING_LLM_BASE_URL')
    if env_url:
        cfg = {**cfg, 'enabled': True, 'base_url': env_url, 'model': os.environ.get('NEONCLIPPING_LLM_MODEL') or cfg.get('model', ''),
               'api_key': os.environ.get('NEONCLIPPING_LLM_KEY') or cfg.get('api_key', '')}
    return cfg if isinstance(cfg, dict) else {}


def config():
    """Usable settings or None."""
    cfg = _read()
    if not cfg.get('enabled'):
        return None
    try:
        base = valid_base_url(cfg.get('base_url'))
    except ValueError:
        return None
    model = str(cfg.get('model') or '').strip()
    local = (urlparse(base).hostname or '').lower() in ('127.0.0.1', 'localhost', '::1')
    key = str(cfg.get('api_key') or '').strip()
    if not model or (not key and not local):
        return None
    return {'base_url': base, 'model': model, 'api_key': key}


def public():
    cfg = _read()
    return {'enabled': bool(cfg.get('enabled')), 'base_url': str(cfg.get('base_url') or ''), 'model': str(cfg.get('model') or ''),
            'has_key': bool(cfg.get('api_key')), 'ready': config() is not None, 'presets': PRESETS}


def save(enabled, base_url, model, api_key=None):
    try:
        cfg = json.loads(_path().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        cfg = {}
    cfg['enabled'] = bool(enabled)
    if base_url not in (None, ''):
        cfg['base_url'] = valid_base_url(base_url)
    if model is not None:
        cfg['model'] = str(model).strip()[:120]
    if api_key not in (None, ''):          # empty keeps the saved key; a new value replaces it
        cfg['api_key'] = str(api_key).strip()[:400]
    _path().parent.mkdir(parents=True, exist_ok=True)
    _path().write_text(json.dumps(cfg), encoding='utf-8')
    return public()


def clear_key():
    try:
        cfg = json.loads(_path().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return
    cfg.pop('api_key', None)
    _path().write_text(json.dumps(cfg), encoding='utf-8')


def model_name():
    """The model id smart.py should use: 'cloud:<model>' when the cloud option is on and complete, else None (Ollama is used)."""
    cfg = config()
    return PREFIX + cfg['model'] if cfg else None


def _scrub(text, key):
    text = str(text)
    if key:
        text = text.replace(key, '***')
    return re.sub(r'(?i)(bearer\s+)[A-Za-z0-9._\-]+', r'\1***', text)[-300:]


def _chat(cfg, prompt, budget, temperature, json_mode, timeout=60):
    body = {'model': cfg['model'], 'messages': [{'role': 'user', 'content': prompt}], 'temperature': temperature, 'max_tokens': int(budget)}
    if json_mode:
        body['response_format'] = {'type': 'json_object'}
    headers = {'Content-Type': 'application/json', 'User-Agent': 'NeonClipping'}
    if cfg['api_key']:
        headers['Authorization'] = 'Bearer ' + cfg['api_key']
    req = urllib.request.Request(cfg['base_url'] + '/chat/completions', json.dumps(body).encode(), headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read(4_000_000).decode('utf-8', 'replace'))
    return str(data['choices'][0]['message']['content'] or '')


def cloud_complete(prompt, budget=250, temperature=.25, json_mode=True):
    cfg = config()
    if not cfg:
        raise RuntimeError('Cloud AI is not set up.')
    last = None
    for attempt in range(3):
        try:
            return _chat(cfg, prompt, budget, temperature, json_mode)
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 400 and json_mode:
                json_mode = False                      # some providers or models reject response_format
                continue
            if e.code == 429 and attempt < 2:
                try:
                    wait = min(10, float(e.headers.get('Retry-After') or 2))
                except (TypeError, ValueError):
                    wait = 2
                time.sleep(wait)
                continue
            break
        except Exception as e:      # noqa: BLE001 - network, timeout, bad JSON
            last = e
            if attempt < 1:
                time.sleep(1)
                continue
            break
    code = f'HTTP {last.code}' if isinstance(last, urllib.error.HTTPError) else type(last).__name__
    raise RuntimeError(f'Cloud AI request failed ({code}): ' + _scrub(last, cfg['api_key']))


def complete(model, payload):
    """Text answer for an Ollama-style payload (as built by smart._payload), from the cloud provider or from Ollama."""
    if str(model).startswith(PREFIX):
        opts = payload.get('options') or {}
        return cloud_complete(payload['prompt'], opts.get('num_predict', 250), opts.get('temperature', .25), payload.get('format') == 'json')
    req = urllib.request.Request(OLLAMA + '/api/generate', json.dumps(payload).encode(), {'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=90))['response']


def parse_json(text):
    """JSON object from a model answer, tolerating ```json fences and text around it."""
    text = str(text or '').strip()
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text, flags=re.I)
    try:
        return json.loads(text)
    except ValueError:
        a, b = text.find('{'), text.rfind('}')
        if a >= 0 and b > a:
            return json.loads(text[a:b + 1])
        raise


def test():
    """Tiny real request so the user sees whether the key, address and model work."""
    started = time.monotonic()
    try:
        answer = cloud_complete('Reply ONLY with JSON: {"ok": true}', 30, 0, True)
        parse_json(answer)
        return {'ok': True, 'ms': int((time.monotonic() - started) * 1000), 'model': (config() or {}).get('model', '')}
    except Exception as e:      # noqa: BLE001
        return {'ok': False, 'error': str(e)[-260:]}
