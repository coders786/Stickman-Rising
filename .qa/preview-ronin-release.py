"""Compare a standalone preview's raw HTTP responses with its release files.

Usage: python3 .qa/preview-ronin-release.py <standalone> [port]
Optional SR_QA_HOST selects the Host/Origin used by the preview proxy.
"""
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

build = Path(sys.argv[1])
port = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
next_dir = next(p.parent for p in build.glob('.next*/BUILD_ID'))
build_id = (next_dir / 'BUILD_ID').read_text().strip()
preview_host = os.environ.get('SR_QA_HOST') or f'{port}-{os.environ.get("E2B_SANDBOX_ID", "preview")}.e2b.app'
headers = {'Host': preview_host, 'Origin': 'https://' + preview_host}


def get(path):
    with urlopen(Request(f'http://127.0.0.1:{port}' + path, headers=headers), timeout=12) as f:
        assert f.status == 200, path
        return f.read(), f.headers


root, head = get('/')
assert build_id.encode() in root and 'no-store' in head['Cache-Control']
assert not head.get('X-Frame-Options') and 'frame-ancestors' not in (head.get('Content-Security-Policy') or '').lower()
assert b'/night-crossing/' not in root
links = sorted(set(re.findall(r'(?:href|src)="(/_next/static/[^"#?]+)', root.decode())))
assert len(links) >= 10
for link in links:
    raw, h = get(link)
    assert raw == (next_dir / link.removeprefix('/_next/')).read_bytes(), link
    assert 'immutable' in h['Cache-Control'], link

bridge = build / 'public' / 'bridge'
names = sorted(p.relative_to(bridge).as_posix() for p in bridge.rglob('*') if p.is_file())
assets = {}
for name in names:
    raw, h = get('/bridge/' + name)
    assert raw == (bridge / name).read_bytes(), name
    if name.endswith('.br'):
        assert h['Content-Encoding'] == 'br', name
    if name.endswith('.webp'):
        assert h['Content-Type'] == 'image/webp', name
    if name.startswith('baked-v1/') or name == 'shop-return-v2.webp':
        assert 'immutable' in h['Cache-Control'], name
    assets[name] = {'bytes': len(raw), 'sha256': sha256(raw).hexdigest()}

retired = ['/night-crossing/v1/01-last-train.png', '/bridge/sky-basis-v5.rgba.br',
           '/bridge/shop-return-v1.webp', '/bridge/packed-v4/l1-bc7.ktx']
assert not (build / 'public' / 'night-crossing').exists()
for path in retired:
    try:
        get(path)
    except HTTPError as e:
        assert e.code == 404, path
    else:
        raise AssertionError('Retired asset still deployed: ' + path)
assert isinstance(json.loads(get('/api/scores')[0]), list)
print(json.dumps({'build': build_id, 'originAccepted': True, 'iframeHeadersClear': True, 'rootSHA256': sha256(root).hexdigest(),
                  'staticLinks': len(links), 'retiredLoader404': True, 'scoresApi': True, 'assets': assets}, indent=2))
