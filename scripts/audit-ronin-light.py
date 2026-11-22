"""Measure real, settled compositor frames and publish a small comparison.

Usage: python scripts/audit-ronin-light.py .cache/player-light research/ronin-lighting
Requires Pillow and NumPy. Raw frames come from .qa/slasher-player-light.mjs.
"""
from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

root = Path(sys.argv[1])
dest = Path(sys.argv[2])
dest.mkdir(exist_ok=True, parents=True)


def rgb(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.int16)


def delta(a, b):
    return np.abs(a - b).max(axis=2)


report = {}
for path in sorted(root.glob('after-*.json')):
    backend = path.stem.removeprefix('after-')
    if not path.stat().st_size:
        continue
    run = json.loads(path.read_text())
    control = root / f'control-{backend}.json'
    before = json.loads(control.read_text())['scenes'] if control.exists() and control.stat().st_size else {}
    measurements = report[backend] = {}
    for name, scene in run['scenes'].items():
        a, u, e = [rgb(path.with_suffix('') / f'{name}{suffix}.png') for suffix in ('', '-unlit', '-empty')]
        off, changed = delta(u, e), delta(a, u)
        ink = (u.max(axis=2) == 0) & (off > 5)
        bright = changed > 5
        ink_hit = bright & ink
        support = np.asarray(Image.fromarray(((off > 2) * 255).astype('uint8')).filter(ImageFilter.MaxFilter(5))) > 0
        # With city mist/FX left in place, prefer the 2 px AA support to a
        # rectangle that would also count the air between the arms or legs.
        spill = int((bright & ~support).sum())
        assert spill <= 3, (backend, name, 'outside the silhouette + AA support', spill)
        black = int((ink & (a.max(axis=2) == 0)).sum())
        assert black >= ink.sum() * .58, (backend, name, 'dark core', black, int(ink.sum()))
        if ink_hit.any():
            samples = a[ink_hit]
            high = samples.max(axis=1) >= np.quantile(samples.max(axis=1), .8)
            tint = np.rint(np.median(samples[high], axis=0)).astype(int).tolist()
        else:
            tint = None
        if name in ('warm', 'left', 'cool', 'covered'):
            assert ink_hit.sum() > 65, (backend, name, 'no visible practicals')
            r, g, b = tint
            if name in ('warm', 'covered'):
                assert r > g > b, (backend, name, tint)
            else:
                assert b > r, (backend, name, tint)
        if name == 'open' and (run.get('lean') or run.get('fallback')):
            assert bright.sum() == 0, (backend, name, 'a missing optical bake must not fake moonlight')
        measurements[name] = {
            'changedAbove5': int(bright.sum()), 'untouchedBlack': black, 'originalBlack': int(ink.sum()),
            'outOfSupportAbove5': spill, 'brightInkMedianRGB': tint, 'headMoon': scene['samples'][1]['lunar'],
            'torsoPrincipal': scene['samples'][0]['fixtures'][0],
            'peakTransient': max(t['transient'] for t in scene['samples']),
        }
        if name in before:
            for key in ('x', 'y', 'pose', 'joints', 'cam'):
                assert before[name][key] == scene[key], (backend, name, key)
            ctrl = rgb(root / f'control-{backend}' / f'{name}.png')
            same = delta(u, ctrl)
            # Exact identity when the settled plate, crop and HUD match.
            # Use the live-ink mask as the witness if a HUD banner overlaps.
            assert np.quantile(same[ink], .99) == 0, (backend, name, 'control ink mismatched')
            measurements[name]['oldVsUnlitDifferentPixels'] = int((same > 0).sum())

(dest / 'pixels.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({b: {s: d['changedAbove5'] for s, d in m.items()} for b, m in report.items()}, indent=2))

if 'canvas' not in report or not (root / 'control-canvas/warm.png').exists():
    sys.exit()

# Use matched browser crops, not re-illustration. Keep enough surrounding
# art to see the lens and shelter, without shrinking the fighter to a dot.
face = '/usr/share/fonts/truetype/dejavu/DejaVuSans{}.ttf'
font = lambda n, bold=False: ImageFont.truetype(face.format('-Bold' if bold else ''), n)
board = Image.new('RGB', (1160, 952), '#101821')
pen = ImageDraw.Draw(board)
pen.text((24, 18), 'STICKMAN RISING   /   LIVE GAMEPLAY', fill='#85bfc1', font=font(13, True))
pen.text((22, 35), 'Light on flat ink', fill='#edf0ed', font=font(34, True))
pen.text((24, 82), 'Same silhouette. Only the ink facing the light picks up color.', fill='#bdcbd0', font=font(17))
for i, (folder, name, label, detail, tint) in enumerate([
    ('control-canvas', 'warm', '01 / BEFORE', 'Uniform black under the lamp', '#9badbb'),
    ('after-canvas', 'warm', '02 / SODIUM', 'Amber from overhead right', '#f0b273'),
    ('after-canvas', 'left', '03 / DECK GUIDE', 'Cool light from the left', '#90d7d8'),
    ('after-canvas', 'cool', '04 / MERCURY', 'Cool bridge lamp from the right', '#bccdde'),
    ('after-canvas', 'covered', '05 / SERVICE BAY', 'Roof blocks the moon; local lamp remains', '#f0b273'),
    ('after-canvas', 'strike', '06 / MID-STRIKE', 'Light follows the moving 2D pose', '#dce2e8'),
]):
    x, y = 24 + (i % 3) * 376, 117 + (i // 3) * 411
    dy = 20 if name == 'strike' else 0
    crop = Image.open(root / folder / (name + '.png')).convert('RGB').crop((301, 124 + dy, 669, 502 + dy))
    panel = ImageOps.fit(crop, (360, 346), method=Image.Resampling.LANCZOS, centering=(.5, .48))
    board.paste(panel, (x, y))
    pen.rectangle((x, y, x + 359, y + 345), outline='#394753')
    pen.text((x + 2, y + 356), label, fill=tint, font=font(13, True))
    pen.text((x + 2, y + 378), detail, fill='#e0e5e7', font=font(14))
board.save(dest / 'comparison.webp', quality=91, method=6)
