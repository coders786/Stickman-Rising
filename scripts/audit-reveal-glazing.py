"""Make review sheets from browser captures, not from the runtime art inputs.

Requires Pillow and NumPy. See docs/NIGHT-CROSSING.md and BRIDGE-GLAZING.md
for the probes. Save their JSON stdout under <captures>/reports, and name
SR_SHOTS directories release-reveal-desktop, before-<tier>, after-<tier>.
"""
import argparse
import json
from math import ceil, floor
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('captures', type=Path)
parser.add_argument('out', type=Path, nargs='?', default=Path('research'))
parser.add_argument('--reveal-folder', default='release-reveal-desktop')
args = parser.parse_args()
root = args.captures


def report(name):
    return json.loads((root / 'reports' / f'{name}.json').read_text())


def screenshot(folder, name):
    return Image.open(root / folder / f'{name}.png').convert('RGB')


def label(g, xy, text, size, color='#e2d6d1'):
    g.text(xy, text, font=ImageFont.load_default(size=size), fill=color)


def card(sheet, img, x, y, w, h):
    sheet.paste(ImageOps.contain(img, (w, h), Image.Resampling.LANCZOS), (x, y))


def sheet(width, height, title, subtitle):
    out = Image.new('RGB', (width, height), '#0d1117')
    g = ImageDraw.Draw(out)
    label(g, (18, 12), title, 24)
    label(g, (19, 41), subtitle, 13, '#9daabc')
    return out, g


def save(img, area, name):
    out = args.out / area
    out.mkdir(parents=True, exist_ok=True)
    img.save(out / name, 'WEBP', quality=93, method=6)


folder = args.reveal_folder
frames = [('black', '01  BLACK'), ('flash', '02  SIGNAL FLASH'), ('eyes', '03  EMBER EYES'),
          ('flare', '04  LIVE FLARES'), ('draw', '05  DRAW ACROSS'),
          ('draw-upper', '06  STEEL RISES'), ('playing', '07  ARENA')]
board, g = sheet(1184, 485, 'NIGHT CROSSING / RONIN REVEAL',
                 'Browser frames · timed art samples above · live compositor handoff below')
for i, (name, title) in enumerate(frames):
    x, y, w, h = (16 + i * 292, 63, 280, 157) if i < 4 else (16 + (i - 4) * 388, 244, 376, 211)
    card(board, screenshot(folder, name), x, y, w, h)
    label(g, (x + 1, y + h + 3), title, 12, '#f1acaa')
assert not np.asarray(screenshot(folder, 'black')).any()
save(board, 'ronin-reveal', 'storyboard.webp')


def storefront(folder, name, sample, pad=8):
    img = screenshot(folder, name)
    a, b = (sample['screen'][k] for k in ['upper', 'lower'])
    return img.crop((max(0, floor(a['x']) - pad), max(0, floor(a['y']) - pad),
                     min(img.width, ceil(b['x']) + pad), min(img.height, ceil(b['y']) + pad)))


board, g = sheet(1184, 748, 'BRIDGE / CLEAR GLASS',
                 'Frozen seed, camera, room and weather · same completed Metro/Market frames, before and after')
comparison = {}
for row, tier in enumerate(['master', 'optimized', 'canvas']):
    before, after = [report(f'{tag}-{tier}') for tag in ['before', 'after']]
    comparison[tier] = {}
    assert before['viewport'] == after['viewport']
    for j, name in enumerate(['metro', 'market']):
        a, b = [q['samples'][name] for q in [before, after]]
        for key in ['x', 'y', 'zoom']:
            assert abs(a['camera'][key] - b['camera'][key]) < 1e-5, (tier, name, key)
        l, r = [storefront(f'{tag}-{tier}', name, b) for tag in ['before', 'after']]
        delta = np.abs(np.asarray(l, dtype=np.int16) - np.asarray(r, dtype=np.int16)).max(2)
        comparison[tier][name] = {'meanMaxRGBDelta': float(delta.mean()), 'peakRGBDelta': int(delta.max()),
                                  'changed3Levels': int((delta >= 3).sum()), 'cropPixels': int(delta.size)}
        for k, img in enumerate([l, r]):
            x, y = 16 + (j * 2 + k) * 292, 70 + 221 * row
            card(board, img, x, y, 280, 179)
            label(g, (x + 1, y + 185), f'{tier.upper()} / {name.upper()} / {"V2" if k else "V1"}', 12, '#b6c5d1')
save(board, 'bridge-glazing', 'storefront-comparison.webp')

sample = report('after-master')['samples']['market']
board, g = sheet(1076, 299, 'NIGHT MARKET / SOURCES IN THE GLASS',
                 'Same real rendered window · change the projected light, not the opacity or the room')
comparison['marketSources'] = {}
normal = np.asarray(storefront('after-master', 'market', sample), dtype=np.int16)
for j, (suffix, title) in enumerate([('', 'NORMAL PRACTICALS'), ('-lamps-off', 'PRACTICAL RETURN OFF'), ('-flash', 'LIGHTNING ON THE RETURN')]):
    img = storefront('after-master', 'market' + suffix, sample)
    if suffix:
        d = np.abs(normal - np.asarray(img, dtype=np.int16)).max(2)
        comparison['marketSources'][suffix[1:]] = {'peakRGBDelta': int(d.max()), 'changed3Levels': int((d >= 3).sum())}
    x = 18 + j * 350
    card(board, img, x, 69, 335, 199)
    label(g, (x + 1, 273), title, 13, '#b6c5d1')
save(board, 'bridge-glazing', 'market-sources.webp')
(args.out / 'bridge-glazing' / 'matched-pixels.json').write_text(json.dumps(comparison, indent=2) + '\n')
