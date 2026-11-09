# Tap drive + hold skim recomposition

## Controls and mechanics
Tap Shift for the immediate normal dash. Keep Shift held through propulsion
(~160ms, variant dependent) to sustain a low ground-relative skim. Release to
catch/recover. Hold extension is capped at 480ms, so this cannot fly indefinitely.
Cooldown, charges, attacks and existing invulnerability windows are unchanged;
the extension does not repeatedly grant invulnerability. Air, up-dash, backward
guard and wall-blocked dashes cannot use the sustained ground motor.

Tap core pitch now peaks at 1.22 radians (~70 degrees), versus 60 previously.
Hold approaches 1.52 radians (~87 degrees from upright). This is core pitch,
not a claim that every projected silhouette segment is perfectly horizontal.

The new mechanic is not a playback speed change: a finite additional governed
motor interval sustains coast velocity around 850 world pixels/sec, consuming
at most .48 seconds. Motor age/pose progress pauses during this interval then
resumes catch. Strength eases in/out independently. At near-horizontal drive,
pelvis height lowers toward 25 world pixels, reachable IK targets move both
feet behind the hips and ~10/15 pixels above the roof, arms streamline backward,
and the head follows the drive. Release restores the original contact solve.
Toe clearance is clamped during recovery to avoid floor penetration. The saya
flattens with skim strength so its tip doesn't intersect the roof.

This is an arcade ground-relative suspension: gameplay collider remains on the
roof and normal attacks still work. It is intentionally not a jump, free-flight
ability, collision bypass or full rigid-body simulation. Low dust, short ground
streaks and a shadow smear are emitted at a bounded 25Hz during the skim.

## Reference study / honest scope
Re-inspected the actual downloaded movement crop of Naruto fan sprites:
https://github.com/SKJTCodes/Naruto/blob/main/Naruto.png
Run row: long forward trunk silhouette, arms swept back, legs trailing/recovering.
Dash row: tightly compressed departure and discrete catch; do not copy its
near-instant smear as an A/B pose teleport in this procedural rig.

Re-inspected actual knight game animation sheet:
https://github.com/phaserjs/examples/blob/master/public/3.86/assets/animations/knight.png
Weapon/body offset and planted recovery make attack/travel silhouettes readable.
This sheet is not evidence of a near-flight dash; that mechanic is authored here.

Internet search also returned a Sekiro rotoscope/animation observation:
https://www.tumblr.com/walkcycles/623791248464117760/gwarsh-it-feels-good-to-sprint-around-as-sekiro
Its description contrasts compact inclined sprinting with exaggerated Naruto
silhouettes; only the returned text was read, not its underlying video.
https://vrcmods.com/item?id=3723 lists a Naruto-style run asset; it was not
installed or treated as measured motion data. Search results with unsupported
historical/biomechanical stories were deliberately not used. No anime episode
or commercial-game footage was newly watched for this change, and no claim
is made that this is a historical traditional ninja technique.

## Validation
`bun run check`: 112 tests pass, typecheck, lint and animation audits pass.
`bun run build`: successful. `git diff --check`: clean.
New held tests exercise 30/60/120Hz, both equipment modes, early release and
full hold, finite poses, actual near-horizontal peak, raised feet, recovery
floor clearance and bounded hold duration. Existing tap contact tests remain.
`held-skim-dash.png` / poses JSON: actual Player updates at 240Hz, 12 samples.
Regenerate with `node --import tsx scripts/render-held-dash.ts`.

Production browser capture: 350 updates at 120Hz / 175 frames at 60Hz;
zero JS errors, all poses finite, both equipment modes reach near-horizontal
(~87.09 degrees); no toe penetration during dash. This is an offline animation
capture, not a device performance benchmark. See `held-skim-dash-browser.json`
and real-speed `held-skim-dash-gameplay.webp`.
