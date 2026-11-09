"""Build the explicit GitHub Pages file set using only Python's standard library."""
from pathlib import Path
import hashlib
import json
import shutil
import io
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build' / 'elink42-control'
ASSETS = ['index.html', 'style.css', 'i18n.js', 'holidays.js', 'calendar.js', 'charset.js', 'protocol.js',
          'ble.js', 'features.js', 'archive.js', 'ota.js', 'firmware.js', 'render.js', 'wallpapers.js', 'rotation.js', 'app.js', '.nojekyll']
ASSETS += ['firmware/'+n for n in ['elink42-ota-v32.zip','elink42-tricolor-ssd1619-v33-ota.zip','elink42-fourcolor-jd79668-v33-ota.zip','elink42-tricolor-ssd1619-v33.hex','elink42-fourcolor-jd79668-v33.hex','README.md','LICENSES.txt']]

def firmware_images():
    bundle=(ROOT/'firmware/elink42-ota-v32.zip').read_bytes()
    import base64,re
    embedded=json.loads(re.search(r'const pack=(\{.*?\});return', (ROOT/'firmware.js').read_text('ascii')).group(1))
    assert base64.b64decode(embedded['data'],validate=True)==bundle
    assert hashlib.sha256(bundle).hexdigest()==embedded['sha256']
    packs=json.loads(re.search(r'const packs=(\{.*?\});const pack=', (ROOT/'firmware.js').read_text('ascii')).group(1))
    assert set(packs)=={'2','5'}
    result={}
    for model,name in [(2,'tricolor-ssd1619'),(5,'fourcolor-jd79668')]:
            pack=packs[str(model)]
            assert pack['name']==f'elink42-{name}-v33-ota.zip'
            encoded=base64.b64decode(pack['data'],validate=True)
            assert encoded==(ROOT/'firmware'/pack['name']).read_bytes()
            assert hashlib.sha256(encoded).hexdigest()==pack['sha256']
            with zipfile.ZipFile(io.BytesIO(encoded))as inner:
                assert inner.testzip()is None and set(inner.namelist())=={'manifest.json','firmware.dat','firmware.bin'}
                image,dat=inner.read('firmware.bin'),inner.read('firmware.dat')
            assert len(image)==238532 and len(dat)==104 and hashlib.sha256(image).digest()[::-1]==dat[24:56]
            assert struct.unpack_from('<I',image,0x417870-0x404000)[0]==33
            assert struct.unpack_from('<III',dat,12)==(0x5A4B0000|model<<8,33,238532)
            memory={};upper=0;filename=f'firmware/elink42-{name}-v33.hex'
            for line in (ROOT/filename).read_text('ascii').splitlines():
                r=bytes.fromhex(line[1:]);assert line.startswith(':') and sum(r)%256==0 and len(r)==r[0]+5
                if r[3]==4:upper=int.from_bytes(r[4:6],'big')<<16
                elif r[3]==0:
                    for i,b in enumerate(r[4:-1]):
                        address=upper+int.from_bytes(r[1:3],'big')+i;assert address not in memory;memory[address]=b
                else:assert r[3]==1
            assert sorted(memory)==list(range(0x404000,0x43E3C4))
            assert bytes(memory[a]for a in sorted(memory))==image
            result[str(model)]={'hex':filename,'application_sha256':hashlib.sha256(image).hexdigest(),'application_bytes':len(image)}
    return result

def build():
    images=sorted(p.relative_to(ROOT).as_posix() for p in (ROOT/'assets/wallpapers').rglob('*') if p.is_file())
    import re
    assert len(images)==116 and all(re.fullmatch(r'assets/wallpapers/(thumbs/[a-z0-9-]+\.webp|display/[a-z0-9-]+\.png)',p) for p in images)
    files = ASSETS+images
    assert len(files) == len(set(files)) == 140
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
        shutil.copyfile(ROOT / name, dest)
        hashes[name] = hashlib.sha256(dest.read_bytes()).hexdigest()
    manifest = {'version': '0.6.20', 'repository': 'JasonYDG/elink42-control',
                'pages_url': 'https://jasonydg.github.io/elink42-control/',
                'content': 'web-control-with-bundled-signed-ota', 'firmware_revision': 33, 'firmware_images':firmware,'assets': hashes}
    (OUT / 'site-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'directory': str(OUT), 'files': len(hashes) + 1}))

if __name__ == '__main__':
    build()
