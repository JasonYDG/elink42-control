"""Serve the static console on loopback."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class Handler(SimpleHTTPRequestHandler):
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
        super().do_GET()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', choices=('127.0.0.1', 'localhost'), default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8289)
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    with ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=args.directory.resolve())) as server:
        print(f'ELINK42 local console: http://127.0.0.1:{server.server_port}/', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
