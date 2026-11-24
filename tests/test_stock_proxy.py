import importlib.util
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
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
                with self.assertRaises(HTTPError) as error:
                    urlopen(base + '/api/stock/quote?symbols=sh000001')
                self.assertEqual(error.exception.code, 404)
                error.exception.close()
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(base + '/', headers={'Host': 'untrusted.local'}))
                self.assertEqual(error.exception.code, 403)
                error.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
