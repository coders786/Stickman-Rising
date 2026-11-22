"""Rebuild the archived flame-eye storyboard from pre-ink-cut QA captures.

The current Night Crossing uses .qa/slasher-reveal-frames.mjs and has no eye
aperture frames. Do not feed that tool's output into this archival script.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('captures', type=Path, help='directory containing desktop-frames/ and live.json + live/')
parser.add_argument('out', type=Path, nargs='?', default=Path('research/ember-slit'))
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)


def font(name, size):
    try:
        return ImageFont.truetype(name + '.ttf', size)
    except OSError:
        return ImageFont.load_default(size=size)


shots = [
    ('eyes-black', '01 / BLACK', 'The arena stays covered'),
    ('eyes-lifting', '02 / OPEN', 'Two solid eyes, no face'),
    ('eyes-ignite', '03 / IGNITE', 'One red flash at 80% aperture'),
    ('eyes-held', '04 / HOLD', 'Fire flickers while the bridge loads'),
    ('black-beat', '05 / SEAL', 'Eyes shut after the real submit'),
    ('cut-center', '06 / MURASAMA', 'The bare blade leads the cut'),
    ('cut-scored', '07 / FULL CUT', 'Lower-left to upper-right'),
    ('cut-peel', '08 / REVEAL', 'The live arena opens from the cut'),
    ('cut-clear', '09 / PLAY', 'No veil or lingering artwork'),
]
board = Image.new('RGB', (1250, 979), '#141319')
draw = ImageDraw.Draw(board)
mono, note = font('DejaVuSansMono-Bold', 14), font('DejaVuSans', 15)
draw.rectangle((24, 29, 28, 112), fill='#ec5445')
draw.text((43, 31), 'STICKMAN RISING   /   ENGAGE & RETRY', font=mono, fill='#ef7d69')
draw.text((40, 49), 'Night Crossing', font=font('DejaVuSans-Bold', 46), fill='#fbf0ec')
draw.text((1226, 101), 'C I N E M A T I C   S E Q U E N C E', font=mono, fill='#9f8c94', anchor='ra')
for i, (key, label, detail) in enumerate(shots):
    x, y = 24 + i % 3 * 406, 137 + i // 3 * 274
    frame = Image.open(args.captures / 'desktop-frames' / f'{key}.png').convert('RGB')
    draw.rectangle((x-1, y-1, x+389, y+218), fill='#3d3038')
    board.paste(frame.resize((389, 218), Image.Resampling.LANCZOS), (x, y))
    draw.text((x, y+224), label, font=mono, fill='#f6917e')
    draw.text((x, y+242), detail, font=note, fill='#dfd3d8')
board.save(args.out / 'sequence.webp', quality=92, method=6)

# Start on the black beat, not on title frames still queued by the recorder.
runs = json.loads((args.captures / 'live.json').read_text())['runs']
run = next(r for r in runs if r['name'] == 'ENGAGE')
frames, times = [], []
for sample in run['playback']:
    frame = Image.open(args.captures / 'live' / sample['path']).convert('RGB')
    if not frames:
        assert sample['ms'] < 500, 'The recorder missed the opening blackout'
        if any(high > 3 for _, high in frame.resize((24, 14), Image.Resampling.BOX).getextrema()):
            continue
    frame.thumbnail((860, 800), Image.Resampling.LANCZOS)
    frames.append(frame)
    times.append(sample['ms'])
assert len(frames) >= 12, 'Expected a real Engage recording starting on black'
spans = [max(1, round(end - start)) for start, end in zip(times, times[1:])] + [780]
frames[0].save(args.out / 'live-reveal.webp', save_all=True, append_images=frames[1:], duration=spans,
               loop=1, quality=85, method=5, minimize_size=True)
print(f'{len(frames)} compositor frames, {sum(spans[:-1])} ms of recorded playback')
