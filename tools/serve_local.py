"""Serve the local console and its fixed, read-only stock quote endpoint."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_quotes(symbols):
    # Fixed provider and validated symbols: this endpoint cannot proxy arbitrary URLs.
    url = 'https://qt.gtimg.cn/q=' + ','.join(symbols)
    request = Request(url, headers={'User-Agent': 'ELINK42-Local/0.8.3'})
    with build_opener(NoRedirect).open(request, timeout=12) as response:
        body = response.read(32001)
    if not body or len(body) > 32000:
        raise ValueError('Invalid quote response size')
    body.decode('gbk', errors='strict')
    return body


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get('Origin')
        if origin and origin in getattr(self.server, 'allowed_origins', ()):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        super().end_headers()

    def do_GET(self):
        port = self.server.server_port
        hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
        host = self.headers.get('Host', '')
        if host not in hosts:
            self.send_error(403, 'Local same-origin requests only')
            return
        target = urlsplit(self.path)
        if target.scheme or target.netloc:
            self.send_error(400, 'Absolute request targets are not supported')
            return
        if target.path != '/api/stock/quote':
            if getattr(self.server, 'quotes_only', False):
                self.send_error(404)
            else:
                super().do_GET()
            return
        origin = self.headers.get('Origin')
        allowed_origins = {'http://' + host, *getattr(self.server, 'allowed_origins', ())}
        if origin and origin not in allowed_origins or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            self.send_error(403, 'Local same-origin requests only')
            return
        try:
            if len(target.query) > 150:
                raise ValueError()
            query = parse_qs(target.query, keep_blank_values=True, strict_parsing=True, max_num_fields=1)
            if set(query) != {'symbols'} or len(query['symbols']) != 1:
                raise ValueError()
            symbols = query['symbols'][0].lower().split(',')
            if not 1 <= len(symbols) <= 5 or len(set(symbols)) != len(symbols) or any(not re.fullmatch(r'(sh|sz|bj)\d{6}', s) for s in symbols):
                raise ValueError()
        except ValueError:
            self.send_error(400, 'Expected 1-5 unique A-share symbols')
            return
        try:
            body = fetch_quotes(symbols)
        except (HTTPError, URLError, TimeoutError, OSError, UnicodeError, ValueError) as error:
            if isinstance(error, HTTPError):
                error.close()
            self.send_error(502, 'Quote provider unavailable; previous quotes are preserved')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=gbk')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8289)
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--quotes-only', action='store_true')
    parser.add_argument('--allow-origin', action='append', default=[])
    args = parser.parse_args()
    for origin in args.allow_origin:
        if not re.fullmatch(r'http://(?:127\.0\.0\.1|localhost):\d{1,5}', origin):
            parser.error('--allow-origin requires an exact loopback HTTP origin')
    with ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=args.directory.resolve())) as server:
        server.allowed_origins = set(args.allow_origin)
        server.quotes_only = args.quotes_only
        print(f'ELINK42 local console: http://127.0.0.1:{server.server_port}/', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
