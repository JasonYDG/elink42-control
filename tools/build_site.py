"""Build the explicit GitHub Pages file set using only Python's standard library."""
from pathlib import Path
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build' / 'elink42-control'
ASSETS = ['index.html', 'style.css', 'charset.js', 'protocol.js',
          'ble.js', 'features.js', 'archive.js', 'ota.js', 'render.js', 'app.js', '.nojekyll']

def build():
    files = ASSETS
    assert len(files) == len(set(files)) == 11
    OUT.mkdir(parents=True, exist_ok=True)
    assert OUT.resolve().is_relative_to((ROOT / 'build').resolve())
    for p in OUT.rglob('*'):
        if p.is_file() and p.relative_to(OUT).as_posix() not in files:
            p.unlink()
    hashes = {}
    for name in files:
        dest = OUT / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, dest)
        hashes[name] = hashlib.sha256(dest.read_bytes()).hexdigest()
    manifest = {'version': '0.5.3', 'repository': 'JasonYDG/elink42-control',
                'pages_url': 'https://jasonydg.github.io/elink42-control/',
                'content': 'web-control-only', 'assets': hashes}
    (OUT / 'site-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'directory': str(OUT), 'files': len(hashes) + 1}))

if __name__ == '__main__':
    build()
