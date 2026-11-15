# Proposed rendering experiments: math, controls and rejection rules

> Extended and tightened for mobile in [TECHNIQUES.md](../mobile-2.5d/TECHNIQUES.md), with [current evidence](../mobile-2.5d/EVIDENCE.md). These original experiments remain proposals, not integrated engine fixes.

Companion to [PLAN.md](PLAN.md). These are **design proposals**, not implemented engines, world-first claims or new benchmark results. Names describe scene-specific combinations of established caching, conservative bounds, material shading, reprojection and batching.

Every experiment gets a direct same-effects path, a candidate path, fixed scene/quality/physical output, artifact identity and a full-frame comparison. A microbenchmark alone cannot justify promotion.

## E0. Repair the temporal and coordinate foundation

### Genuine analytic time keys

For an evaluable field F at clock t, maintain endpoints t0 <= t <= t1 and F0=F(t0), F1=F(t1):

```text
u = clamp((t-t0)/(t1-t0), 0, 1)
Fcached(t) = mix(F0, F1, u)
```

Evaluate the future endpoint only for fields whose future is determined by the packet/model. Unknown future player input is not predicted and must not delay combat rendering. On a jump beyond the interval, regenerate a valid bracket rather than extrapolate stale data indefinitely.

For extinction, it can be useful to interpolate optical depth and reconstruct transmission:

```text
tau(t) = mix(tau0, tau1, u)
T(t)   = exp(-tau(t))
```

This is still a temporal approximation, not an exact identity for arbitrary cloud motion. Keep the native direct comparison and hazard refreshes near boundaries.

The current `min(previous,current)` scalar operation is neither interpolation nor future bracketing. If a design intentionally keeps a minimum to prevent light leaks, document it as a biased visibility filter.

### Frame-rate-independent response

```text
a = 1 - exp(-dt / tauResponse)
yNext = y + a * (target-y)
```

Different attack/release tau values are allowed. Compute this once in update, not every time the scene happens to be drawn.

### A wind envelope must match the actual wind equation

The archived HTML uses a horizontal velocity with coefficient-sum bound 0.85*M. The game's different formula is:

```text
vx(t,s) = 0.85*s*[1 + .28*sin(.23*t) + .16*sin(.61*t+1.2) + .08*cos(1.17*t-.4)]
```

Thus a simple safe bound is:

```text
abs(vx) <= .85*(1+.28+.16+.08)*abs(s) = 1.292*abs(s)
```

Its primitive multiplied by variable s(t) satisfies:

```text
d/dt [s(t)*F(t)] = s(t)*F'(t) + s'(t)*F(t)
```

The second term is why the current varying `storm.wind` breaks the claimed equality. Two correct options:

1. Define the complete analytic carrier, including storm amplitude, in one clock. Expand products of sines/cosines with product-to-sum identities and integrate the resulting harmonics. Handle zero/resonant frequencies by their limits.
2. Treat user changes as explicit strength segments. For constant strength si over [ti,ti+1): `D(t)=D(ti)+si*(F(t)-F(ti))`. Carry offsets through changes so displacement is continuous. If strength ramps continuously, integrate the defined ramp, not its current value times the old primitive.

Pick one. Do not reuse old proof constants with a new carrier. Test t=0, long times, negative strength, changing strength, pause, slow motion and visual/simulation clock relationships.

### Shared camera convention

World-space packets use one worldToScreen matrix and its inverse, with documented parallax/sky variants. CSS dimensions, physical backing dimensions and exact scale ratios remain distinct. Use the same matrix for material art, light positions, shadow receivers, reflected roots and contact fog. Roll is either intentionally included/excluded with a named scene rule, never accidentally absent from one pass.

**Gate:** equal elapsed time produces equivalent state across draw cadences; repeated rendering of the same frame does not advance motion; static reference transforms match every subsystem.

## E1. Aperture-Coherent Moon Transport (ACMT)

### Problem

The current Canvas art, scalar moon cover, ground-cloud marks and atmospheric fan are separate approximations. A light cache can be numerically stable yet disagree visibly with the cloud that supposedly caused it.

### Proposal

Create one `CloudPacket` in scene/world coordinates. It contains model revision, analytic positions at time keys, common density/coverage data and moon aperture coordinates. All consumers share the mapping:

```text
rho = density(scenePosition, time, CloudPacket)
tauMoon = integrate rho along the chosen stylized optical path
Tmoon = exp(-tauMoon)
```

Use the same aperture result for lunar attenuation, moon-facing lining, key-light energy, shaft strength and water illumination. In a 2D medium this is coherent stylized transport, not full 3D volumetric light tracing.

Expensive smooth media fields may use the original two-key density/transport architecture (R16F and RGBA16F with checked RGBA8 fallback). At discontinuous visibility boundaries, reuse the established per-light neighborhood flags and recompute the original visibility at native resolution. A 3x3 classifier is a tested heuristic, not a universal error theorem.

For moon-centric queries, compare a small aperture/coverage packet against a full 2D field; do not compute a large field if only a tiny angular neighborhood is consumed. Keep fog spatial transport distinct where its receivers genuinely need a 2D field.

### Quality benefit / potential saving

One cloud model eliminates contradictory lighting. Shared fields remove repeated evaluation. Bracketing smooth *data* does not freeze cloud transforms or star twinkles.

### Controls and kill rule

- Direct current-time evaluation from the same density.
- Fixed full-resolution field.
- Two-key field with native edge recomputation.
- Optional aperture-only packet where consumers permit it.

Inspect direct light, reflected moon and shafts together during a bank crossing. Reject extra targets that do not improve full-engine time or whose edge error violates the declared image gate. Do not reuse the old HTML's error statistics as proof for newly authored clouds.

## E2. Response-Basis Art Packets (RBAP)

### Problem

The game stacks broad prepainted lighting pools over already shaded art, then multiplies another light map over it. Material identity flattens while blended area grows.

### Proposal

Art generation emits shared geometry plus bounded material assets, not just one final lit painting:

- sRGB albedo/color.
- Coverage, material ID and optional authored normal/height/roughness.
- Explicit emission for windows, lantern, moon, blade and sparks.
- Optional response bases for fixed source geometry.

A reference linear shading equation is:

```text
L(x,t) = A(x)*Lambient(x,t)
       + sum_i [ Vi(x,t)*Ii(t)*Bi(x, light_i(t), view(t)) ]
       + E(x,t)
```

`Bi` may include diffuse/material response and the chosen specular model. For a **fixed-position, fixed-direction** source with varying intensity, a precomputed response base is exact for the same shading model. For moving sources, changing normals, viewpoint-sensitive specular or moving occluders, either evaluate directly or refresh/use a bounded approximation. Do not present a fixed light basis as exact under arbitrary lightning direction.

Use ordinary normal/roughness shading for general dynamics and compare the extra bases only where useful. Pack sparse material data into bounded atlases; avoid a full-resolution multi-target G-buffer by default. Normals/heights authored from a 2D painting are a deliberate 2.5D approximation.

### Quality benefit / potential saving

The inn can gain far richer board/tile/plaster detail in setup/build-time assets with little extra path work at runtime. One material response replaces several disconnected full-width washes. The same door anchor shades boards, bodies and reflections.

### Controls and kill rule

Compare existing Canvas composition, a direct same-material GPU shader, and any factored response basis. Evaluate fixed and moving light cases separately. Reject a basis if texture/bandwidth/refresh cost exceeds its saved calculations or if it changes shadow boundaries under storms.

## E3. Motion-Certified Reflection Islands (MCRI)

### Problem

A global sample-and-hold atlas couples unrelated actors, omits pose/origin invalidators, and relies on an unsupported <1.5-pixel error claim at 20 Hz.

### Proposal

Cache reflection artwork in **actor-local coordinates**. Composite the current root transform every frame. Separate root motion, cached shape and current lighting/water modulation. A root translation does not require redrawing a perfectly unchanged local pose.

Refresh shape using a conservative projected error estimate:

```text
Eshape <= gammaWater * max_k || Jreflection * (qk(t)-qk(tCache)) || + EotherShape
```

- Jreflection includes camera, DPR and the reflection projection.
- qk covers silhouette control points, sword extrema, cloth/scarf bounds and other deforming features—not merely a few joints.
- For curved/capsule geometry, include a support/Lipschitz bound between controls or use direct current geometry.
- gammaWater bounds amplification by the water distortion mapping.
- EotherShape covers widths, depth ordering or geometry channels not represented by the control set.

If no defensible bound is available, render the current pose. Refresh unconditionally on allocation, actor generation/membership changes, mirrored facing/order changes, attack/contact transitions or light/material events that cannot be represented by live shader parameters.

Provisional target: <=0.75 physical pixels in important reflected edges. Do not impose a fixed low Hz ceiling that makes this target impossible. Static/held poses may reuse for long intervals; fast weapon poses may need full-rate refresh.

Never blend incompatible authored held poses just to create a cache interpolation. The underlying animation language and hit timing remain intact.

### Controls and kill rule

- Full current-pose reflection every frame.
- Current whole-atlas 20-Hz hold.
- Actor-local root-live cache with measured shape errors.

Measure bytes uploaded, pose-painter work, total frame time and event-aligned error. Reject if bookkeeping/island uploads exceed direct drawing, or if the cache requires visible blur to hide stale poses.

## E4. Emitter-Footprint Bloom Ledger (EFBL)

### Problem

Whole-scene bloom captures large amounts of dark/nonemissive art, entails cross-canvas work and visits many pixels that cannot glow. The unused bright-pass constant does not make the current copy selective.

### Proposal

Emit known radiance directly into an emission layer E. Use one defined finite-support blur kernel K with radius r:

```text
B = K * E
Dout = (support(deltaE) expanded by r) intersect viewport
```

Track previous AND current transformed emitter/occluder support, including bilinear filter padding. Motion can invalidate an emission region even when the emitter itself did not move, because foreground geometry can reveal/hide it.

Critical implementation detail: to recompute bloom in Dout, gather emission from `Dout expanded by r`, **including unchanged overlapping emitters**. Re-blurring only changed sources would erase neighboring contributions. Clear old supports before redrawing the affected emission union. Full refresh on size/generation/context change or broad global invalidation.

Maintain a unique physical-pixel tile union and merge runs. Measure a backend-specific crossover to a full pass; 58% from the Canvas star lattice is not automatically the right GPU threshold. Use the same emission/kernel in full-target and localized controls.

The final screen pass can combine scene radiance, B, tone mapping, grade, vignette and grain with explicit premultiplied-alpha/color-space rules. Keep HUD outside it. Linear addition/convolution permits factoring; arbitrary old Canvas blend sequences do not necessarily commute.

### Quality benefit / potential saving

Less milky full-environment glow; stronger deliberate accents and preserved dark material structure. Local bloom has a chance to reduce copied/blended area and eliminate scene-capture synchronization.

### Controls and kill rule

- Existing full-scene bloom (art comparison only; different source equation).
- Explicit-emission bloom evaluated over the full field (correctness reference).
- Same emission/kernel with ledger-local recomputation (optimization comparison).

Stop if localized draws are slower, if bright objects leave trails or if overlapping lights lose energy. An art redesign from whole-scene bloom to explicit emission is not by itself a same-output optimization.

## E5. Shadow Witness Parcels (SWP)

### Problem

A correct integer SAT for a static mask does not establish shadows for a different moving silhouette or a whole wide glint quad. A single resultant light vector is not physically equivalent to independently occluded moon and practical lights.

### Proposal

Use shared prop geometry and current per-light projections. For receiver parcel R and caster i, define the complete source-mask support:

```text
Fi = projection_i(R) (+) rayKernelSupport_i(R) (+) textureFilterSupport
```

`(+)` is the Minkowski sum. Include changing penumbra across R. For affine mappings, transformed corners bound R. For projective mappings, prove the denominator sign/domain and bound it; otherwise subdivide or use interval/direct evaluation.

First compare Fi with source caster bounds or row spans. If it misses, transmission is exactly one. Where a SAT is worthwhile, encode:

```text
code = 0: fully clear
code = 1: uncertain / fractional / swept motion
code = 2: fully opaque
```

Use half-open prefix sums with a zero border for an inclusive rectangle [x0,x1]x[y0,y1]:

```text
sum = P(x1+1,y1+1) - P(x0,y1+1) - P(x1+1,y0) + P(x0,y0)
area = (x1-x0+1)*(y1-y0+1)

sum == 0      => all footprint texels clear
sum == 2*area => all footprint texels opaque, only if full support is in-domain
otherwise     => uncertain
```

A query crossing a shadow edge must not assign its center's answer to an entire 346-pixel-wide glint bar. Split the receiver parcel until its complete support is certified, or evaluate at native receiver pixels.

A swept dynamic envelope keeps the **classification** conservative. It does not update the source transmission. Uncertain regions must evaluate a **current** mask/geometry. Bounds use the chosen wind law and all branch/shear equations, not just a fixed two-pixel margin.

For multiple caster planes, retain correlated rays:

```text
Tlight = (1/12) * sum_ray product_caster T(caster, ray)
```

Do not replace it with a product of per-caster averages. For multiple lights, keep separate visibility contributions `sum_light Llight*Tlight`; averaging opposite light directions does not reproduce separate shadows.

### Why this may beat transplanting the village engine

The current CPU field is 640x80 and has relatively few queries. The archived village GPU SAT is 2048x768 and served a much larger multi-plane problem. Neither is automatically optimal for one inn plus a few props.

Compare costs in measured time, not by mixing CPU/GPU operation counts:

```text
Direct:       Nqueries * 12 tap cost
Certificates: amortized build/upload cost + Nqueries*certificate cost
              + Nuncertain*12 tap cost
```

If Nqueries is only 16 glint parcels, building a hierarchy/SAT may never amortize. A few geometry bounds or row spans can be the right result. The proposed invention is the full receiver-support witness and adaptive parcel integration, not a claim that a four-corner SAT query itself is new.

### Controls and kill rule

Direct current-mask, complete-footprint bounds, interval rows and SAT variants. Compare native visibility and final shaded frames. Require zero false certificates in the tested domain. If preprocessing/memory or extra passes lose the total-frame comparison, keep the simpler path.

## E6. Continuous Sky Slices (CSS)

### Problem

A cache hit for a composed sky also holds cloud motion, star twinkles and parallax. A 220-ms hold is a temporal quality tradeoff, not just static-art reuse.

### Proposal

Split the sky into a small number of art planes and dynamic fields. Bake artwork once, then transform each plane continuously:

```text
screenPosition_l(t) = Ml(camera(t)) * localPosition + drift_l(wind(t))
```

Keep intended parallax/roll rules explicit per layer. Evaluate small star twinkle amplitudes each display frame. Cache cloud **density/media construction**, not its transform clock or every output pixel of a moving layer.

Use padded/repeating atlas extents and correct native/filtered sampling to avoid seams. If a high-sky branch excludes fog, specialize it exactly from the shared coordinate predicate; do not leave lower-sky math in all pixels merely for convenience.

### Controls and kill rule

Uncached same-art composition, existing 220-ms composite hold (labelled quality tradeoff) and per-plane continuous transforms. Judge motion on camera reversals, storms and portrait/ultrawide, not only a static screenshot. Reject if additional layer bandwidth outweighs the saved cache rebuilds on target hardware; fuse only truly invariant same-transform art.

## E7. Contact-Locked Draw Packets (CLDP)

### Problem

The code already solves much character geometry during update, which is good. However, visible body, shadow, reflection, ghosts and ribbons still traverse related geometry separately and can use different temporal roots/order conventions.

### Proposal

Build a retained draw packet from the already-solved geometry: local paths/capsules/triangles, coverage/support bounds, material IDs, front/back order, sword socket and foot contacts. Consumers apply their projection/material operation to the same packet.

This does **not** claim the existing renderer solves IK once per draw—it largely does not. The potential saving is command/path generation, repeated painting and cross-consumer bookkeeping, while improving consistency.

Prototype bounded Canvas islands first, then compare direct GPU meshes/instances if uploads dominate. Preserve authored animation exposures and exact contact/hitbox semantics. Cloth/smear geometry needs its own current bounds and cannot be inferred from body joints alone.

### Controls and kill rule

Existing full painters, shared command packets, bounded actor atlas and direct GPU drawing. Validate silhouettes, hands, front/back swaps, weapon sockets and contact AO frame by frame. Reject any batching that changes transparency/order or makes the animation less readable.

## Promotion checklist for every experiment

1. Complete and correct reference available.
2. Identical case, seed, physical output, populations, ray counts and quality settings.
3. Variant IDs and source hashes stored with raw samples.
4. Whole-scene timing, p95/p99, memory, startup and upload costs—not only the kernel.
5. Explicit approximation/error domain and adversarial tests.
6. Real target browser/hardware validation; software-only results labelled.
7. Separate art changes from performance-only changes.
8. Failed experiments archived with reason; simpler baseline stays selectable.
