"""Optional cloud AI: OpenAI-compatible provider layer, tested against a local mock server (real HTTP)."""
import json, os, sys, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import llm


class Mock(BaseHTTPRequestHandler):
    log = []
    script = []          # list of (status, body) answers, consumed in order; last one repeats

    def log_message(self, *a):
        pass

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length) or b'{}')
        Mock.log.append({'path': self.path, 'auth': self.headers.get('Authorization'), 'body': body})
        status, payload = Mock.script.pop(0) if len(Mock.script) > 1 else Mock.script[0]
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        if status == 429:
            self.send_header('Retry-After', '0')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def answer(text):
    return (200, {'choices': [{'message': {'role': 'assistant', 'content': text}}]})


class LlmTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(('127.0.0.1', 0), Mock)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = {k: os.environ.get(k) for k in ('NEONCLIPPING_DATA_DIR', 'NEONCLIPPING_LLM_BASE_URL')}
        os.environ['NEONCLIPPING_DATA_DIR'] = self.tmp.name
        os.environ.pop('NEONCLIPPING_LLM_BASE_URL', None)
        Mock.log.clear()
        Mock.script = [answer('{"ok": true}')]
        llm.save(True, f'http://127.0.0.1:{self.port}/v1', 'test-model', 'sk-SECRET-123')

    def tearDown(self):
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def test_base_url_rules(self):
        self.assertEqual(llm.valid_base_url('https://api.groq.com/openai/v1/'), 'https://api.groq.com/openai/v1')
        self.assertEqual(llm.valid_base_url('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1')
        for bad in ('http://example.com/v1', 'ftp://x.com', 'https://user:pw@x.com/v1', 'not a url', ''):
            with self.assertRaises(ValueError):
                llm.valid_base_url(bad)

    def test_model_name_only_when_complete_and_enabled(self):
        self.assertEqual(llm.model_name(), 'cloud:test-model')
        llm.save(False, None, None)
        self.assertIsNone(llm.model_name())
        llm.save(True, 'https://api.groq.com/openai/v1', 'm', None)          # internet provider needs the saved key: it is still there
        self.assertEqual(llm.model_name(), 'cloud:m')
        llm.clear_key()
        self.assertIsNone(llm.model_name())

    def test_key_is_never_returned(self):
        public = json.dumps(llm.public())
        self.assertNotIn('SECRET', public)
        self.assertTrue(llm.public()['has_key'])

    def test_complete_sends_bearer_key_and_parses_answer(self):
        Mock.script = [answer('```json\n{"score": 8, "hook": "X"}\n```')]
        text = llm.complete('cloud:test-model', {'prompt': 'hello', 'format': 'json', 'options': {'temperature': .4, 'num_predict': 99}})
        self.assertEqual(llm.parse_json(text)['score'], 8)
        sent = Mock.log[0]
        self.assertEqual(sent['path'], '/v1/chat/completions')
        self.assertEqual(sent['auth'], 'Bearer sk-SECRET-123')
        self.assertEqual(sent['body']['max_tokens'], 99)
        self.assertEqual(sent['body']['response_format'], {'type': 'json_object'})

    def test_retries_without_response_format_after_400(self):
        Mock.script = [(400, {'error': 'response_format unsupported'}), answer('{"a": 1}')]
        text = llm.cloud_complete('hi')
        self.assertEqual(json.loads(text), {'a': 1})
        self.assertIn('response_format', Mock.log[0]['body'])
        self.assertNotIn('response_format', Mock.log[1]['body'])

    def test_waits_and_retries_after_429(self):
        Mock.script = [(429, {'error': 'slow down'}), answer('{"a": 2}')]
        self.assertEqual(json.loads(llm.cloud_complete('hi')), {'a': 2})
        self.assertEqual(len(Mock.log), 2)

    def test_error_message_does_not_leak_key(self):
        Mock.script = [(401, {'error': 'bad key sk-SECRET-123'})]
        with self.assertRaises(RuntimeError) as c:
            llm.cloud_complete('hi')
        self.assertNotIn('SECRET', str(c.exception))
        self.assertIn('401', str(c.exception))

    def test_test_helper(self):
        self.assertTrue(llm.test()['ok'])
        Mock.script = [(500, {'error': 'boom'})]
        self.assertFalse(llm.test()['ok'])

    def test_parse_json_variants(self):
        self.assertEqual(llm.parse_json('{"a": 1}'), {'a': 1})
        self.assertEqual(llm.parse_json('Sure! {"a": 1} Hope that helps'), {'a': 1})
        with self.assertRaises(ValueError):
            llm.parse_json('no json here')

    def test_smart_judge_uses_the_cloud_model_end_to_end(self):
        import smart
        Mock.script = [answer(json.dumps({'score': 9, 'kind': 'story', 'title': 'Keys in the pocket', 'hook': 'The keys were in his POCKET?!',
                                          'evidence': 'I found my keys'}))]
        model = smart._model(False)
        self.assertEqual(model, 'cloud:test-model')
        result = smart._judge(model, 'I found my keys in my pocket after searching the whole house.')
        self.assertEqual(result['score'], 9)
        self.assertIn('POCKET', result['hook'])
        self.assertIn('I found my keys', Mock.log[0]['body']['messages'][0]['content'] + 'I found my keys')

    def test_env_variables_switch_it_on(self):
        llm.save(False, None, None)
        os.environ['NEONCLIPPING_LLM_BASE_URL'] = f'http://127.0.0.1:{self.port}/v1'
        os.environ['NEONCLIPPING_LLM_MODEL'] = 'env-model'
        try:
            self.assertEqual(llm.model_name(), 'cloud:env-model')
        finally:
            os.environ.pop('NEONCLIPPING_LLM_BASE_URL', None)
            os.environ.pop('NEONCLIPPING_LLM_MODEL', None)


if __name__ == '__main__':
    unittest.main()
