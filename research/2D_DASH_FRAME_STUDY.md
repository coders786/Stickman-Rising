# 2D dash frame study

Inspected on 2026-11-09. The publicly displayed preview GIFs were decoded into individual frames and inspected in sequence; these are previews, not measurements of an actual game's runtime. No source artwork or sprites were imported into Stickman Rising.

## Visual references

1. **ZeggyGames, 2D Pixel Art Character Template** — [artist's asset page](https://zegley.itch.io/2d-platformermetroidvania-asset-pack). The 10-frame displayed dash preview has one upright starting image, a smeared acceleration image, four similar extended drive images, then a low upright catch with trailing particles and two settling images before the idle pose. Its displayed GIF reports 100 ms per image; that does not establish the intended in-game frame timing. The useful principle is a strong readable drive silhouette followed by a separate catch, not the exact poses or timing.
2. **Clembod, Warrior-Free Animation Set** — [artist's asset page](https://clembod.itch.io/warrior-free-animation-set). The 14-frame displayed dash-attack preview holds a compact advancing silhouette for four images, changes to a lower transitional pose, then swings, holds the follow-through, and returns upright. The pack lists separate dash and dash-attack animations. The preview reports 100 ms per image; the asset page lists 7 dash frames and 10 dash-attack frames, so the preview should not be treated as the raw animation timeline. The useful principle is that a dash/attack transition can preserve a clear body silhouette while the weapon action has its own poses.
3. **Animation principles for games** — [Game Developer](https://www.gamedeveloper.com/production/the-12-principles-of-animation-in-video-games/) discusses overlapping action and balancing anticipation/recovery against control. Strong silhouettes and staggered follow-through help readability, but recovery timing needs to serve game control rather than match an example GIF.

## Game-specific interpretation

- A held charge supplies anticipation before the powered release, so no extra launch delay was added. The standard dash remains upright; the charged dash alone takes the user's low, near-ground skimming silhouette.
- The feet have a small alternating offset during the charged skim instead of remaining mechanically locked at identical heights; both stay near the ground and the collision motor remains grounded. The foot contacts return during the catch.
- Landing stays low and joint-flexed, then the arms/head settle slightly after the legs. These are restrained in-betweens on the existing rig, not copied sprite drawings. Arms remain in a forward/neutral guard, never both held behind.
- The standard and charged dashes still have the requested stabilization before locomotion, with attacks available and a queued jump. Their different momentum, durations and effects are preserved. No glowing foot ring was reintroduced.
