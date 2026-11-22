#!/usr/bin/env python3
"""Measure matched Chromium captures from .qa/slasher-pure-bridge.mjs.

Use Pillow and NumPy. Run with a capture root containing before/, after/,
reports/; comparison sheets never alter, relight, or recolor source pixels.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

TIERS = ('master', 'optimized', 'canvas')
PHASES = ('before', 'after')
POSES = ('metro', 'strike')
BG, TEXT, MUTED = '#0b1018', '#e4edf5', '#aabbd0'
NEAREST = Image.Resampling.NEAREST


def image(path):
    return Image.open(path).convert('RGB')


def pixels(im):
    return np.asarray(im, dtype=np.int16)


def stats(region):
    data = np.asarray(region).reshape(-1, 3)
    return {'pixels': int(len(data)), 'black': int(np.all(data == 0, axis=1).sum()),
            'medianRgb': np.median(data, axis=0).astype(int).tolist()}


def box(bounds):
    return tuple(round(bounds[k]) for k in ('left', 'top', 'right', 'bottom'))


def joint_xy(joint):
    return np.array([joint['x'], joint['y']])


def joint_samples(actor):
    head = joint_xy(actor['headC'])
    torso = .49 * joint_xy(actor['hip']) + .51 * joint_xy(actor['chest'])
    shins = [(.57 * joint_xy(actor['knee' + leg]) + .43 * joint_xy(actor['ankle' + leg]), 1) for leg in 'LR']
    return dict(zip(('head', 'torso', 'leftShin', 'rightShin'), [(head, 3), (torso, 2), *shins]))


def joint_box(xy, radius):
    x, y = map(int, np.floor(xy))
    return x - radius, y - radius, x + radius + 1, y + radius + 1


def delta(a, b):
    d = np.abs(pixels(a) - pixels(b))
    return {'pixelsChanged': int((d.max(axis=2) > 0).sum()), 'maxChannelDelta': int(d.max()),
            'meanAbsDelta': round(float(d.mean()), 4)}


def font(size, bold=False):
    try:
        return ImageFont.truetype('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf', size)
    except OSError:
        return ImageFont.load_default(size)


def label(draw, xy, text, size=17, color=TEXT, bold=False):
    draw.text(xy, text, font=font(size, bold), fill=color)


def fit(img, limit, resample=NEAREST):
    scale = min(limit[0] / img.width, limit[1] / img.height)
    return img.resize((round(img.width * scale), round(img.height * scale)), resample)


def paste(sheet, im, x, y, w, h):
    sheet.paste(im, (x + (w - im.width) // 2, y + (h - im.height) // 2))


def ronin_sheet(out, crops, nums):
    sheet = Image.new('RGB', (1280, 1118), BG)
    draw = ImageDraw.Draw(sheet)
    label(draw, (32, 24), 'Bridge Ronin: from shaded cloth to flat ink', 34, bold=True)
    label(draw, (34, 69), 'Matched Chromium captures  ·  Seed 42  ·  Same camera, pose, and weather in each pair', color=MUTED)
    columns = ('Before / ready', 'After / ready', 'Before / strike', 'After / strike')
    for i, name in enumerate(columns):
        label(draw, (147 + 281 * i, 113), name, bold=True)
    for j, tier in enumerate(TIERS):
        y = 148 + 313 * j
        label(draw, (33, y + 111), tier.capitalize(), 18, bold=True)
        for i, (pose, phase) in enumerate((p, b) for p in POSES for b in PHASES):
            left = 147 + 281 * i
            photo = crops[tier][pose][phase]
            draw.rectangle((left, y, left + 259, y + 270), fill='#131c27')
            paste(sheet, fit(photo, (260, 271)), left, y, 260, 271)
            v = nums[tier]['poses'][pose][phase]['core']
            n, count = sum(v[k]['black'] for k in ('head', 'torso')), sum(v[k]['pixels'] for k in ('head', 'torso'))
            label(draw, (left, y + 277), f'Black head/torso pixels: {n}/{count}', 14, color=MUTED)
    sheet.save(out / 'ronin-before-after.png')


def environment_sheet(out, im, sky, skyline):
    sheet = Image.new('RGB', (1180, 948), BG)
    draw = ImageDraw.Draw(sheet)
    label(draw, (30, 23), 'Storefront glass and a fixed sky', 32, bold=True)
    label(draw, (31, 68), 'Master renderer  ·  Actual storefront crops, then isolated sky-cache pixels', color=MUTED)
    for n, phase in enumerate(PHASES):
        x = 30 + n * 569
        label(draw, (x, 112), phase.capitalize() + ' / Metro Link', bold=True)
        photo = fit(im[phase], (545, 274))
        paste(sheet, photo, x, 144, 545, 274)
    label(draw, (30, 440), 'Optical sky alone (no skyline, mist, HUD, or near geometry)', 21, bold=True)
    for n, name in enumerate(('Fixed camera', 'Pan / lift / zoom / roll', 'Same camera + 46 seconds')):
        label(draw, (126 + n * 344, 482), name, 14, bold=True)
    for n, phase in enumerate(PHASES):
        y = 511 + n * 206
        label(draw, (31, y + 73), phase.capitalize(), bold=True)
        for i, state in enumerate(('fixed', 'pan', 'later')):
            # Horizontal screen-space pixel range is the same. Resample the
            # different original cache resolutions only for display here.
            src = sky[phase][state].resize((322, 172), Image.Resampling.BILINEAR)
            sheet.paste(src, (126 + 344 * i, y))
        msg = 'Camera-pan RGB changes: ' + f'{skyline[phase]["pan"]["pixelsChanged"]:,} pixels'
        label(draw, (126, y + 180), msg, 14, color=MUTED)
    sheet.save(out / 'glass-and-sky.png')


def inspect_attachment(path, out):
    ref = image(path)
    if ref.size != (1920, 1080):
        raise ValueError('Attachment witness coordinates refer to the supplied 1920×1080 PNG')

    def coord(rendered_box):
        # User's attachment was displayed at 1568×882; measure original pixels.
        return tuple(round(v * (1920 / 1568)) for v in rendered_box)

    windows = {'head': (1122, 489, 1131, 498), 'torso': (1119, 514, 1128, 529), 'leg': (1138, 570, 1146, 581)}
    rect = coord((990, 475, 1170, 683))
    crop = ref.crop(rect)
    crop.resize((crop.width * 2, crop.height * 2), NEAREST).save(out / 'supplied-ronin-crop.png')
    return {'size': list(ref.size), 'source': path.name, 'crop': rect,
            'interiorSamples': {key: {'rect': coord(b), **stats(ref.crop(coord(b)))} for key, b in windows.items()}}


def audit(root, out, attachment=None):
    out.mkdir(parents=True, exist_ok=True)
    report, crops = {}, {}
    for tier in TIERS:
        paths = {p: root / p / tier for p in PHASES}
        logs = {p: json.loads((root / 'reports' / f'{p}-{tier}.json').read_text()) for p in PHASES}
        crops[tier] = {}
        r = report[tier] = {'path': logs['after']['path'], 'poses': {}, 'glass': {}, 'sky': {}}
        for name in POSES:
            r['poses'][name] = {}
            captures = {p: image(paths[p] / f'{name}.png') for p in PHASES}
            pose = logs['after']['receipt'][name]
            paired_pose = logs['before']['receipt'][name]
            assert pose['actor'] == paired_pose['actor'], (tier, name, 'unmatched landmarks')
            for key in ('camera', 'id', 'time', 'x'):
                assert pose.get(key) == paired_pose.get(key), (tier, name, key)
            assert captures['before'].size == captures['after'].size
            actor = pose['actor']
            lo, hi = (f(np.array([joint_xy(j) for j in actor.values()]), axis=0) for f in (np.min, np.max))
            crop = tuple(np.round(np.r_[lo - [23, 20], hi + [24, 13]]).astype(int))
            crops[tier][name] = {}
            for phase in PHASES:
                im = captures[phase]
                crops[tier][name][phase] = im.crop(crop)
                a = pixels(im.crop(crop)); b = pixels(image(paths[phase] / f'{name}-no-player.png').crop(crop))
                coverage = (np.abs(a - b).max(axis=2) > 2)
                r['poses'][name][phase] = {'core': {joint: {'rect': joint_box(pos, radius), **stats(im.crop(joint_box(pos, radius)))}
                                                    for joint, (pos, radius) in joint_samples(actor).items()},
                                           'actorToggleChangedPixels': int(coverage.sum()),
                                           'blackOnChangedPixels': int(((a == 0).all(axis=2) & coverage).sum())}
            r['poses'][name]['geometry'] = {k:v for k,v in pose.items() if k != 'frame' and k != 'glass'}
            core = r['poses'][name]['after']['core']
            assert core['head']['black'] == core['head']['pixels'], (tier, name, 'head not black')
            torso = core['torso']
            if name == 'strike' and torso['black'] != torso['pixels']:
                # At this rolled/exported backing the square witness can
                # meet the silhouette edge. Accept two dark fringe pixels
                # only if they are next to actual brighter scene coverage.
                l, t, rgt, bot = torso['rect']
                surround = pixels(captures['after'].crop((l - 2, t - 2, rgt + 2, bot + 2))).max(2)
                fringe = np.argwhere(surround[2:-2, 2:-2] != 0)
                assert len(fringe) <= 2, (tier, name, 'torso not black')
                for y, x in fringe:
                    assert surround[y + 2, x + 2] <= 7 and surround[y:y+5, x:x+5].max() > 15, (tier, name, 'nonblack interior')
            else:
                assert torso['black'] == torso['pixels'], (tier, name, 'torso not black')
            assert all(core[k]['black'] == core[k]['pixels'] for k in ('leftShin', 'rightShin')), (tier, name, 'shins not black')
        glass_im = {}
        sky_im = {}
        for phase in PHASES:
            data = logs[phase]['receipt']['metro']
            frame = image(paths[phase] / 'metro.png')
            bare = image(paths[phase] / 'metro-no-glass.png')
            coords = [box(p) for p in data['panes']]
            assert data['panes'] == logs['after']['receipt']['metro']['panes']
            r['glass'][phase] = {'glassOnlyInPane': [delta(frame.crop(p), bare.crop(p)) for p in coords], 'painter': data['glass']}
            glass_im[phase] = frame.crop(box(data['region']))
            r['sky'][phase] = {}
            sky_im[phase] = {v:image(paths[phase] / f'sky-{v}.png') for v in ('fixed', 'pan', 'later')}
            for v in ('pan', 'later'):
                orig, mod = sky_im[phase]['fixed'], sky_im[phase][v]
                r['sky'][phase][v] = delta(orig, mod.resize(orig.size, Image.Resampling.BILINEAR) if mod.size != orig.size else mod)
            r['sky'][phase]['moonCss'] = {v: s['atmo']['moonCss'] for v, s in logs[phase]['sky'].items()}
            r['sky'][phase]['raster'] = sky_im[phase]['fixed'].size
            if tier == 'master':
                for pose in POSES:
                    image(paths[phase] / f'{pose}.png').save(out / f'master-{pose}-{phase}.webp', lossless=True, method=5)
        assert r['sky']['after']['pan']['pixelsChanged'] == 0
        assert r['sky']['after']['later']['pixelsChanged'] > 100
        if tier == 'master':
            environment_sheet(out, glass_im, sky_im, r['sky'])
    ronin_sheet(out, crops, report)
    results = {'browsers': report}
    if attachment:
        results['suppliedScreenshot'] = inspect_attachment(attachment, out)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('captures', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--attachment', type=Path)
    args = parser.parse_args()
    result = audit(args.captures, args.output, args.attachment)
    (args.output / 'pixels.json').write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
