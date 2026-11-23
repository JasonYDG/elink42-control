"""Build the explicit GitHub Pages file set using only Python's standard library."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import io
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build' / 'elink42-control'
ASSETS = ['index.html', 'style.css', 'i18n.js', 'holidays.js', 'calendar.js', 'charset.js', 'protocol.js',
          'sdk-preview.js','sdk-preview.wasm','sdk6-preview.wasm','sdk7-preview.wasm','sdk8-preview.wasm','sdk9-preview.wasm','sdk10-preview.wasm','sdk22-preview.wasm','sdk-ota.js', 'ble.js', 'features.js', 'archive.js', 'ota.js', 'firmware.js', 'render.js', 'wallpapers.js', 'rotation.js', 'app.js', '.nojekyll']
ASSETS += ['timetable.html', 'timetable.css', 'planner.js', 'course-table.js', 'school-native.js', 'reminder-native.js', 'course-editor.js', 'course-import.js', 'timetable-template.xlsx', 'vendor/xlsx.full.min.js', 'vendor/xlsx.LICENSE']
SDK_REVISION = 31
WEB_VERSION = '0.8.30'
SDK_FILES = [f'firmware/elink42-sdk-v{SDK_REVISION}-{panel}.e42ota' for panel in ('tricolor-ssd1619','fourcolor-jd79668')]
V33_FILES = [f'firmware/elink42-{panel}-v33-ota.zip' for panel in ('tricolor-ssd1619','fourcolor-jd79668')]
ASSETS += ['screen-workbench.js','tools/serve_local.py','firmware/LICENSES.txt',*SDK_FILES, *(name.replace(f'-v{SDK_REVISION}-', f'-v{previous}-') for previous in (6,7,8,9,10,12,14,15,16,17,18,19,20,21,22,23,24,28) for name in SDK_FILES)]
ASSETS += ['calendar-font.js','fonts/fusion-pixel-10px-monospaced-zh_hans.bdf.gz','fonts/fusion-pixel-12px-monospaced-zh_hans.bdf.gz','fonts/OFL.txt']
ASSETS += V33_FILES + ['firmware/elink42-v33-sdk21-migration.zip']
ASSETS += ['stock-local.html', 'downloads/ElinkStockSync-1.0.0.exe', 'downloads/ElinkStockSync-1.0.1.exe']

def firmware_images():
    import base64,re
    embedded=json.loads(re.search(r'const pack=(\{.*?\});return', (ROOT/'firmware.js').read_text('ascii')).group(1))
    bundle=base64.b64decode(embedded['data'],validate=True)
    assert hashlib.sha256(bundle).hexdigest()==embedded['sha256']
    packs=json.loads(re.search(r'const packs=(\{.*?\});const pack=', (ROOT/'firmware.js').read_text('ascii')).group(1))
    assert set(packs)=={'2','5'}
    result={}
    for model,name in [(2,'tricolor-ssd1619'),(5,'fourcolor-jd79668')]:
            pack=packs[str(model)]
            assert pack['name']==f'elink42-{name}-v33-ota.zip'
            encoded=base64.b64decode(pack['data'],validate=True)
            assert hashlib.sha256(encoded).hexdigest()==pack['sha256']
            assert (ROOT/'firmware'/pack['name']).read_bytes()==encoded
            with zipfile.ZipFile(io.BytesIO(encoded))as inner:
                assert inner.testzip()is None and set(inner.namelist())=={'manifest.json','firmware.dat','firmware.bin'}
                image,dat=inner.read('firmware.bin'),inner.read('firmware.dat')
            assert len(image)==238532 and len(dat)==104 and hashlib.sha256(image).digest()[::-1]==dat[24:56]
            assert struct.unpack_from('<I',image,0x417870-0x404000)[0]==33
            assert struct.unpack_from('<III',dat,12)==(0x5A4B0000|model<<8,33,238532)
            result[str(model)]={'bundle_sha256':pack['sha256'],'application_sha256':hashlib.sha256(image).hexdigest(),'application_bytes':len(image)}
    return result

def console_assets():
    html = (ROOT / 'index.html').read_text(encoding='utf8')
    # The stock-page export reads the two named scripts separately.
    group = re.search(r'(?:<script defer src="[^"]+"></script>\s*)+', html)
    names = re.findall(r'src="([\w-]+\.js)\?', group[0])
    assert names[-1] == 'app.js' and len(names) == html.count('<script defer src=')
    bundle = b'\n;\n'.join((ROOT / name).read_bytes() for name in names)
    digest = hashlib.sha256(bundle).hexdigest()[:12]
    tag = f'<script defer src="console.js?v={WEB_VERSION}&h={digest}"></script>'
    return {'index.html': (html[:group.start()] + tag + html[group.end():]).encode('utf8'), 'console.js': bundle}

def build():
    images=sorted(p.relative_to(ROOT).as_posix() for p in (ROOT/'assets/wallpapers').rglob('*') if p.is_file())
    assert len(images)==236 and all(re.fullmatch(r'assets/wallpapers/(thumbs/[a-z0-9-]+\.webp|display/[a-z0-9-]+\.png)',p) for p in images)
    generated = console_assets()
    files = ASSETS+images+['console.js']
    assert len(files) == len(set(files)) == 325
    firmware=firmware_images()
    OUT.mkdir(parents=True, exist_ok=True)
    assert OUT.resolve().is_relative_to((ROOT / 'build').resolve())
    for p in OUT.rglob('*'):
        if p.is_file() and p.relative_to(OUT).as_posix() not in files:
            p.unlink()
    hashes = {}
    for name in files:
        dest = OUT / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if name in generated:
            dest.write_bytes(generated[name])
        else:
            shutil.copyfile(ROOT / name, dest)
        hashes[name] = hashlib.sha256(dest.read_bytes()).hexdigest()
    manifest = {'version': WEB_VERSION, 'sdk_revision': SDK_REVISION, 'repository': 'JasonYDG/elink42-control',
                'pages_url': 'https://jasonydg.github.io/elink42-control/',
                'content': 'web-control-with-bundled-signed-ota', 'firmware_revision': 33, 'firmware_images':firmware,'assets': hashes}
    (OUT / 'site-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'directory': str(OUT), 'files': len(hashes) + 1}))

if __name__ == '__main__':
    build()
