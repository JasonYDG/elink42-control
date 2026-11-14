import importlib.util
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location('serve_local', Path(__file__).parents[1] / 'tools/serve_local.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StockProxyTest(unittest.TestCase):
    def test_http_routes_origin_boundaries_and_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'index.html').write_text('local console', encoding='utf-8')
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(module.Handler, directory=directory))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(base + '/') as response:
                    self.assertEqual(response.read(), b'local console')
                body = 'v_sh000001="上证指数";'.encode('gbk')
                with patch.object(module, 'fetch_quotes', return_value=body) as upstream:
                    with urlopen(base + '/api/stock/quote?symbols=sh000001,sz000001') as response:
                        self.assertEqual(response.read(), body)
                        self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    upstream.assert_called_once_with(['sh000001', 'sz000001'])
                    for suffix in ['', '?url=https://example.com', '?symbols=sh000001&symbols=sz000001', '?symbols=sh000001,sh000001', '?symbols=sh000001%26url=x']:
                        with self.assertRaises(HTTPError) as error:
                            urlopen(base + '/api/stock/quote' + suffix)
                        self.assertEqual(error.exception.code, 400)
                        error.exception.close()
                    self.assertEqual(upstream.call_count, 1)
                    for headers in [{'Origin': 'https://example.com'}, {'Host': 'example.com'}, {'Sec-Fetch-Site': 'cross-site'}]:
                        with self.assertRaises(HTTPError) as error:
                            urlopen(Request(base + '/api/stock/quote?symbols=sh000001', headers=headers))
                        self.assertEqual(error.exception.code, 403)
                        error.exception.close()
                    self.assertEqual(upstream.call_count, 1)
                    server.allowed_origins = {'http://127.0.0.1:8289'}
                    with urlopen(Request(base + '/api/stock/quote?symbols=sh000001', headers={'Origin': 'http://127.0.0.1:8289'})) as response:
                        self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:8289')
                    server.quotes_only = True
                    with self.assertRaises(HTTPError) as error:
                        urlopen(base + '/')
                    self.assertEqual(error.exception.code, 404)
                    error.exception.close()
                with patch.object(module, 'fetch_quotes', side_effect=TimeoutError()):
                    with self.assertRaises(HTTPError) as error:
                        urlopen(base + '/api/stock/quote?symbols=sh000001')
                    self.assertEqual(error.exception.code, 502)
                    error.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
