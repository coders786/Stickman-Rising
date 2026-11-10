# 30 fps combat animation study

Researched 2026-11-09. The aim is smooth-feeling motion at a 30 fps display, not an assertion that interpolation can create extra rendered images.

## Reference images and sources

- Inspected sampled frames from two public Shadow Fight 2 gameplay GIFs: [a kick exchange](https://tenor.com/view/shadow-fight2-sparta-kick-gameplay-fight-gif-15106047) and [a Shadow/Hermit exchange](https://tenor.com/search/shadow-fight-gifs). Their low-resolution thumbnails were decoded at a reported 100 ms per GIF image. They show readable silhouetted stances, weight changes, attack reactions and a lowered recovery before standing, but are **not** reliable 30 fps source material or a basis for copying animation timings. No art was imported.
- An [interview with Nekki's animation team](https://3dvf.com/en/redaction/siggraph-2019-cascadeur-are-physics-and-deep-learning-the-next-step-in-character-animation/) describes its earlier 2D animation tools and the later physics-assisted Cascadeur workflow. This project uses its own authored poses, physics and IK, not Cascadeur.
- [Mariel Cartwright's GDC presentation](https://media.gdcvault.com/gdcchina14/presentations/833784_MarielCartwright_PowerfulAndEffective_EN.pdf) stresses clear key silhouettes, fast player anticipation, and follow-through when frames are limited. Those are animation-design principles, not a request to copy specific characters.
- [Fixed-step/interpolation discussion](https://github.com/kingimann/OkaySpaceGameEngine/pull/496) distinguishes simulation frequency from render frequency. This game already uses capped 60 Hz simulation substeps inside its frame loop. A 30 fps display has only 30 visible updates per second, so better pose timing and spacing can improve readability but cannot produce true 60 fps output.
- “Blade” was not identified precisely; no particular game was assumed or copied. A title or link can be used for a separate study.

## Applied to this game

At 30 displayed frames per second, consecutive power-dash poses previously jumped about 26.7 degrees during the rise/catch. The charged lean now approaches and leaves the skim over more visible frames (maximum authored pitch slew 10 rad/s rather than 14), while retaining the near-horizontal drive, near-ground feet, powered release, momentum and low recovery. With the game-style 60 Hz simulation sampled at 30 fps, the measured largest pose step during the dash is about 19.1 degrees. These are target bounds and sampled results, not an objective guarantee of perfect smoothness on every machine.

`npm run art:dash-motion -- /home/user/dash-visual/30fps --fps=30` renders the real player at 60 updates per second and captures 30 displayed poses per second. `--fps=60` captures 60 for comparison. GIF format uses centisecond frame delays: 30 fps is encoded with 30/40 ms intervals to maintain the correct average duration, so playback may vary across viewers. The generated contact sheets and telemetry make the frames inspectable without a desktop editor. Automated tests also exercise the two-substep 30 fps path, ground clearance, attack, and recovery.
