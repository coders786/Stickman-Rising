# Six new sword-ritual breakdowns and breathing idle

## Sword actions

Six authored poses added **to each** action, not six duplicated render frames:

- Sheathe: 5 → **11 keys**, new poses at 110, 300, 370, 500, 700 and 780ms.
  They cover lift, alignment, tip approach, slide and hand settlement.
- Draw: 6 → **12 keys**, new poses at 35, 85, 120, 185, 245 and 275ms.
  They cover grip closure, extraction, release, follow-through and guard settle.

Durations stay 850ms and 300ms. Existing monotone in-betweens, short-arc wrist
winding, danger interrupts and final contact/weapon solvers remain intact.
Blade visibility still gates at 420ms sheathing and 120ms drawing, with no
added input delay. Saya-support fingers now remain gathered (openness 0.14–0.24)
instead of flaring into a decorative open hand. The right grip remains closed.

## Idle

Replaced the three-key breath with a seven-key, 5.4-second cycle: inhale,
crest, delayed shoulder/hand settling, exhale and quiet recovery. Root sway is
less than 0.3 rig units; vertical breath excursion is about 0.88. Leg/foot
channels remain constant so the planted stance does not march or slide.
Pelvis/chest counterrotation and small head compensation keep it composed.
Pure-black body, outline-only anatomy and no ponytail remain unchanged.

Automatic safe-idle flourishes now wait 7.2 seconds instead of 2.6, allowing a
complete breathing cycle before a flourish interrupts it. Combat guard is
unchanged; movement/combat interrupts still take priority.

## Evidence

- [Actual authored-key sheet](ritual-idle-key-sheet.png), new keys labelled.
  Pre-contact rig study; weapon lines show endpoints before visibility gates.
  Reproduce: `node --import tsx scripts/render-ritual-idle-sheet.ts`.
- [Real-speed gameplay](ritual-idle-gameplay.webp): seven seconds / 420 frames
  sampled at 60Hz, including one whole quiet idle loop and both sword rituals.
- [Browser report](ritual-idle-browser.json): 840 updates at 120Hz, finite poses,
  zero JavaScript errors; full idle cycle and both visibility gates verified.
  Offline simulation sampling is not a device FPS benchmark.
- `bun run check`: **80/80 tests**, typecheck/lint and animation/continuity audits.
  New tests cover exact additional keys, unchanged durations, anatomical bounds,
  gathered fingers, idle seam, stationary legs and no premature flourish.
- Production build succeeds. Dash, sprint, jump and universal switching tests pass.
