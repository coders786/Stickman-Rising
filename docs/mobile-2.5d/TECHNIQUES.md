# Technical designs — equations, comparators and rejection criteria

Companion to [PLAN.md](PLAN.md). **Everything in this file is a proposed runtime design unless explicitly labeled as an executed source witness or isolated reference-model check.** No shader/backend speedup was measured here. Names describe project-specific combinations of established ideas, not global novelty.

The [earlier seven-experiment specification](../graphics-optimization/EXPERIMENTS.md) remains useful; this file tightens its mobile assumptions and extends input/combat/AI/water coverage.

## 0. Contract before optimization

### 0.1 Coordinates and presentation packets

Keep the simulation's existing 2D `(x,y)` convention: floor `y=0`, negative y above ground. Introduce optional **visual** depth/height metadata, not a third gameplay axis. For lighting sketches, use a visual point `P=(x,h,d)` where `h=-y`, `h>=0` is height and `d` is ground-depth placement. Document the conversion from the current pseudo-3D rig rather than assuming its depth channel already has this meaning.

One frame packet includes:

```ts
// Interface sketch, not supplied runtime implementation.
interface SceneFrame {
  simTick: number; simTime: number;
  visualTime: number; visualDt: number;
  generation: number; artRevision: number;
  cssSize: readonly [number, number];
  backingSize: readonly [number, number];
  // Actual backing/CSS ratios, not only a nominal DPR scalar.
  worldToBacking: Float32Array;
  backingToWorld: Float32Array;
  cloudRevision: number; lightRevision: number;
  actors: readonly ActorDrawPacket[];
  contacts: readonly ContactEvent[];
  emitters: readonly EmissionPacket[];
}
```

Use retained storage/read-only views, not fresh nested allocations every draw. The renderer may populate/discard **caches**, but may not advance simulation, consume gameplay RNG, spawn events or change pose histories. Shader/material state derived from the packet is cache state, not another clock.

Render interpolation must select a consistent exposure and root time. Continuous root/camera motion can interpolate; intentional impact drawings select authored exposures. Do not combine an old root with an unrelated future solved hand and call it contact locked. Interpolation's latency and the authoritative simulation/display-time difference are explicit.

### 0.2 Clocks and overload

- `wall`: input timestamps and human rhythm; monotonic.
- `sim`: approved 60-Hz combat ticks, affected by intended hitstop/slow motion.
- `visual`: environment evolution under an explicit pause/hitstop policy.
- `ui`: optional independent menu/HUD animation.

For visual smoothing with a held target over a time interval:

```text
a(dt,tau) = 1 - exp(-dt/tau)
yNext = y + a*(target-y)
```

This has a useful semigroup property for a constant target: two updates of dt/2 equal one update of dt in exact arithmetic. Repeated draws of the same packet are not updates. Changing target interpolation is a different approximation and gets its own test.

Keep an accumulator and a fixed maximum number of **fixed-size** combat updates per render. If demand exceeds the maximum, choose a documented bounded-debt/slowdown/drop policy, log requested versus simulated time, reset interpolation safely and test the resulting experience. Dropping time is a gameplay degradation under overload, not a faster equivalent simulation. Increasing the backlog without a bound risks the spiral of death. Do not disguise a variable 50-ms tick as fixed 1/60.

**Current source witness:** on a 250-ms controlled browser frame the actual engine executes `[1/60,1/60,1/60,.05]`; gameplay advances `.1`, weather `.25`. This is not a proposed algorithm or a phone measurement.

### 0.3 Pool law

For each pool, allocated objects partition into disjoint live and free sets:

```text
Live ∩ Free = ∅
Allocated = Live ∪ Free
acquire: remove from Free or allocate; reset; register once in Live
release: remove once from Live; deactivate; register once in Free
```

Effects held by active gameplay references need a generation-safe handle to avoid stale release/use after reuse. Reset all semantically relevant fields: age/life, active/emitting, coordinates/history, colors, point counts, ownership and revision.

Stable compaction writes surviving indices in original order. Swap-remove is safe only when order is irrelevant or an explicit later ordering pass restores it. Source-over transparency is order dependent.

**Executed model:** 5,000 randomized stable-compaction cases matched the backward-splice control exactly in survivor identity/order. It does not prove rendering time or allocation savings. Actual source probes reproduced missing re-registration for particles/rings/trails; other pools must be tested individually, not blanket-rewritten.

**Locations:** `fx/fx.ts`, `entities/projectiles.ts`; proposed shared pool assertions in audit/debug builds.

---

## 1. Step-owned commands and combat-locked event spine

### Problem and scope

Actual `Game.frame` clears `pressed/released` on a no-step render. Input buffering mitigates some actions but not all. Global randomness and independent contact presentation also make correctness and optimization comparisons harder.

### Data flow

```text
pointer/key event
  → {sequence, sourceId, action, down/up, wallStamp}
  → source-held state + bounded pending command queue
  → next legal input/simulation opportunity
  → accepted/rejected/buffered intent with explicit expiry
  → combat update resolves contact once
  → {eventId,tick,subtick,attackInstance,source,target,point,normal,outcome}
  → audio / FX / camera / emission / local water-fog consumers
```

Queue storage can be a fixed-capacity ring. Every consumer tracks event/sequence identity; it may not infer “new” from “this packet was drawn again.” A contact event needs to remain available for all presentation consumers, not be destructively popped by the first one.

For source ownership, the action's held state is the logical OR over physical/virtual owners, or an integer owner count with idempotent source down/up transitions. This avoids releasing an action while another finger/key still holds it. A joystick remains an analog sample channel; record its sample time and latest value without queuing every movement forever.

### Important hitstop/expiry distinction

“Never clear before an opportunity” does **not** mean “buffer every action indefinitely.” Keep wall-time gameplay windows where intended. During hitstop, accept a legal buffered intent on the input clock if that is the approved game rule; commit its damage/state progression only at the legal simulation boundary. If it expires or is illegal, log rejection instead of silently losing it. Otherwise a 0.05 time scale can leave hundreds of milliseconds between simulation steps and create either lost actions or unwanted late actions.

Measure separately:

1. input arrival → intent/visual acknowledgement;
2. arrival → authoritative legal action;
3. action → presented contact.

An acknowledgement must not pretend a parry became active before the combat rules permit it. Cancelling a whole gesture on blur/pause is intentional reset, not an accidentally missed command.

### Active-interval detection

For a continuous attack clock increasing from `a0` to `a1`, the potentially active part is:

```text
I = [max(a0, hitStart), min(a1, hitEnd)]
```

Process it if nonempty under a consistent boundary convention; give one-shot events unique IDs to prevent a boundary being counted twice. Split at authored snaps, phase boundaries and multi-hit rearm intervals. Sample/evaluate swept **contact geometry restricted to I**, not the entire anticipation/recovery.

**Executed model:** an update from `.083333…` to `.133333…` skips an active window `[.09,.12]` under current-time-only detection but has nonempty interval overlap. This establishes why endpoint testing is insufficient; it does not prove a new sword sweep.

### Swept projectile narrow phase

For a projectile path `p0→p1` and a moving body center `c0→c1`, form relative motion:

```text
q0 = p0-c0
v  = (p1-p0) - (c1-c0)
solve |q0 + u*v|² = R²,  u∈[0,1]
```

Use the earliest valid root, handling zero relative velocity and already-overlapping starts. For a capsule/body band, use segment/capsule time of impact or a conservative broad phase followed by exact intended geometry. In a parry, process remaining travel after the contact under the reflected velocity if the chosen game contract requires it; do not apply a second full dt. Define ties deterministically.

**Actual source witness:** bullet at `(-45,-45)`, vx `900`, dt `.05` reaches player and parries; source multiplier gives vx `-1440`. Next `.05` update travels `0→-72` at y `-45`, passing 11 px from enemy center `(-36,-34)` with radius 30, but credits zero hits. The witness uses actual speed/multiplier and a dt allowed by `Game.frame`; it does not measure encounter frequency.

### Comparison, cost and rejection

- **Controls:** current source behavior (bug witness), corrected simple step-owned edges, then the richer event packet.
- **Potential cost:** queue writes/reads and a few fixed-size records; contacts/FX already perform work that can consume them. Batching events must not add a frame of latency.
- **Executed reference model:** 130 commands delivered once in each 30/60/90/120/144/240-Hz schedule, including hitstop; no missing/duplicate model events. The model does not implement actual acceptance/TTL/combo semantics.
- **Locations:** `core/input.ts`, `game.ts`, `combat/hit-resolution.ts`, player/projectiles, FX/audio; proposed `combat/events.ts`.
- **Reject/fallback:** retain corrected simple input/event handling if the shared spine adds coupling/latency without useful reuse. Never revert to clearing gameplay edges on no-step renders.

---

## 2. Sequential threat / engagement ledger

### Problem

`Enemy.countEngaged` scans the enemy list at eligible attack decisions. A naive “compute the count once per frame” replacement is incorrect because earlier enemies can enter/leave windup/strike/aim before later enemies make their decisions.

### Exact bounded design

At the start of a simulation step, let `E` equal the number of nondead enemies in the engaged state set. During the existing sequential enemy order:

```text
countOtherEngaged(i) = E - isEngaged(i)
old = isEngaged(i)
update enemy i under existing rules
E += isEngaged(i) - old
```

Update the ledger at **every observable transition** if decisions/callbacks inside an update can query it before the method returns. Spawns, deaths, boss state transitions and external combat transitions also update or invalidate it. Keep the direct loop in assertions until replay equivalence is established.

Likewise, an `id→entity` table only replaces lookup; it must not change enemy iteration or hit order. For nearby targets, first compare a flat scan with conservative swept 1D bins. Include blade reach, body scale and motion during the query interval; false-negative broad-phase culling is forbidden.

### Evidence and limits

The isolated sequential ledger model matched the literal loop for **430,000 queries**, 43 entities over 10,000 randomized steps. A stale once-per-render count is explicitly not the tested algorithm. Runtime callbacks and state transitions are not yet integrated.

- **Locations:** `entities/enemy.ts`, `game.ts`, player targeting and projectile broad phase.
- **Cost model:** repeated eligible scans may approach O(N²), but current N is small; maintained count is O(1) per transition/query and has bookkeeping cost. An ID table adds memory and synchronization obligations.
- **Control:** exact current sequential flat loops at the same actor count.
- **Reject:** if traces show no meaningful CPU/tail reduction, keep flat loops. Do not lower offscreen attack cadence to produce a win.

---

## 3. CLDP — Contact-Locked Draw Packets

### Proposal

One approved pose/exposure solve emits retained contour/primitive data and metadata:

```text
poseRevision, rootTransform, facing/orderRevision
contour controls / local triangles / limb depth order
hand/blade/contact anchors
silhouette support bounds including widths/scarf/weapon extrema
material IDs and emission regions
```

Main body, shadow, reflection and trails reference it. Dynamic current roots and the current camera are applied separately. No consumer resamples a different clip time or mutates the solve. A contact packet is chosen at the intended displayed contact time; the authoritative hit resolver is not replaced by a rendering cache.

### Why this is not simply “cache the entire character sprite”

A held body pose may reuse shape while a root moves continuously. A live wrist/cloth/IK correction can invalidate only its dependent part. Facing, front/back limb reorder, grip state and weapon changes can invalidate the full packet immediately. Continuous channels must remain continuous where authored. A single atlas frame for a whole attack would not preserve these conditions.

### Geometry cost control

The present player contour code allocates arrays/points during surface construction and repeats silhouettes for washes/rims. Compare:

1. current correct direct Canvas draw;
2. retained Canvas Path2D/point-array packets at pose revision;
3. one bounded actor-local coverage/material island with live light response;
4. direct GPU contour/triangle packets with a material shader.

Path2D may still incur browser raster work; a cached island adds memory/filtering/uploads; a GPU mesh can change AA/contour behavior. None wins by definition. Preserve alpha order and exaggerated hand/limb widths.

- **Locations:** `anim/rig3d.ts`, `anim/humanoid.ts`, player/enemy draw and shadow methods, renderer.
- **Proof obligation:** all consumers use the same transform/exposure/ordering and support data; repeated render of a packet leaves it unchanged.
- **Reject:** any contact drift, flickering self-overlap, incorrect facing, added presentation latency or whole-frame regression. Keep the direct pose path as fallback.

---

## 4. ACMT + CSS — coherent cloud transport and continuously moving sky art

### One authored medium

For a few scene-depth layers, define optical depth rather than unrelated painted alpha and scalar moon cover:

```text
tau_j(p,t) = densityScale_j * authoredField_j(M_j*p - displacement_j(t))
T(p,t) = exp(-Σ tau_j(p,t))
```

`M_j` and its matching visual transform determine parallax, layer scale and drift. Cloud art may add nonoccluding decorative detail, but anything designated as the occluding bank uses this density/coverage mapping. Multiple layers can have distinct velocities; the same set must drive every relevant consumer.

For a finite moon disc, use normalized aperture quadrature:

```text
Tmoon(t) ≈ Σ a_k * T(moonAperturePoint_k,t),  Σ a_k=1
```

The sample count/positions are quality parameters fixed during A/B. Direct high-sample evaluation is the error reference. A scalar moon factor can drive overall key energy, but spatial shafts/floor breaks need spatial queries, not a falsely universal scalar. Celestial clouds crossing the moon attenuate it; do not explain overlap errors by declaring local atmospheric clouds behind the moon.

For a simple scattering layer:

```text
Cout = T * Cbehind + (1-T) * S
```

`S` is its authored/scattering source color. Overlap/order and depth conventions remain explicit. This is a coherent 2.5D medium, not full multiple scattering.

### Genuine time brackets

For predictable fields, store actual `t0,t1` and values at those times:

```text
u = (t-t0)/(t1-t0),  t0<=t<=t1
tauCached = (1-u)*tau0 + u*tau1
TCached = exp(-tauCached)
```

This is an approximation for a moving field, not exact just because the endpoints are correct. Near density/occlusion boundaries, evaluate current-time density or refresh the key. Unknown future gameplay impulses cannot be precomputed or delayed to fit a bracket. On a time jump, rebuild a valid bracket instead of extending stale data.

**CSS art caching:** cache individual invariant mountain/cloud artwork, transform it every display frame, and evaluate twinkles/live emission outside the frozen plate. Do not bake all sky motion into a 0.22-second refresh.

An explicit authorable parallax convention is `screen_j = O(t) + A(t) * (anchor_j - diag(pX_j,pY_j)*camera(t))`, where `A` is the common zoom/roll transform without a second camera translation, and `O` is the common viewport/shake origin. Use p≈0 for the moon, small p for distant ranges, p=1 for the combat plane and larger p only for deliberate foreground framing. This is layered 2D parallax, not a claim of full perspective reconstruction. Culling/inverse queries must use the same layer transform and include roll/filter support; do not apply camera subtraction twice.

### Correct wind displacement

The port's carrier has a coefficient-sum velocity bound `1.292*|strength|`, not `.85*|strength|`. With varying strength `s(t)`, multiplying a fixed primitive by the current strength introduces the extra derivative term `s'(t)*F(t)`.

Use either an analytically integrated complete harmonic law or continuous piecewise segments:

```text
D(t) = D(t_i) + s_i*(F(t)-F(t_i))  for constant strength segment i
```

For ramps, integrate the ramped law. Recompute all motion-envelope bounds when the law or art deformation changes. “Wind coherency” does not require rain, canopy and water to have identical physical velocities; they share forcing with material-specific response.

### Mobile cost / controls / stop rules

- **Controls:** direct same-density current-time evaluation; separate direct same-art transforms; optionally aperture-only packets versus a full field.
- **Cost:** a few transformed cards and bounded optical-depth samples versus full-field generation/raymarch. More layers still mean more transparent fill.
- **Locations:** `world/zen-night.ts`, `world/storm.ts`, `render/bhst.ts`, light/reflection consumers; proposed `world/cloud-packet.ts`.
- **Proof obligations:** shared mappings; no draw-count dependence; no moon/shaft/floor contradictions; correct dt and wrap continuity; real time-key validity.
- **Reject:** held movement, halo discontinuity, light leaks or a field/cache whose setup/bandwidth exceeds direct work. No dense 3D cloud raymarch in the low-end baseline.

---

## 5. RBAP — material response bases and ten lighting behaviors

### Single forward response

In linear color, a useful stylized reference is:

```text
C = E + rho*(A_hemisphere * AO_indirect + Σ V_i * L_i * a_i * R_i(n,l_i,material))
      + C_specular + C_scatter + C_artRim
```

- `rho`: albedo; `E`: explicit emission.
- `V_i`: visibility of source i, not a blanket global shadow mask.
- `a_i`: bounded attenuation/shape.
- `R_i`: authored cel/material response; e.g. 2–3 controlled bands from n·l.
- Specular, scattering and art rim use the relevant source/visibility, not anonymous unshadowed glow.

AO applies to intended indirect/contact terms, not emission or every source equally. Artist overrides are allowed but named. Decode sRGB albedo before linear-light arithmetic; keep material data channels linear. Define premultiplied-alpha representation and tone/display conversion once. A Canvas fallback gets an approved visual reference; legacy blend equations do not magically commute into this equation.

### Fixed-source bases

If a light's position/direction/view-dependent response and surface geometry are fixed and only its scalar intensity/color changes, precompute an unshadowed response basis `B_i(x)`:

```text
C_i(x,t) = V_i(x,t) * I_i(t) * B_i(x)
```

For this **same model**, the factorization is exact under those assumptions. If the basis includes occlusion, that occlusion must also be fixed. Moving lightning, changing normals/view, sharp cel thresholds or viewpoint-sensitive specular need direct evaluation or bounded interpolation—do not reuse an invalid basis.

Art generation emits albedo, coverage/material ID, optional authored normal/height/roughness and emission, in bounded object/local atlases. Do not demand a full-resolution multi-attachment G-buffer. Static art can gain richer timber/tile/plaster detail without adding live path calls.

### Source-specific details

A smooth compact attenuation option is:

```text
q = distance/range
w = max(0,1-q²)²
a = w/(1 + distance²/k²)
```

This is an art-friendly bounded law, not a calibrated inverse-square source. Current `pointAt` does not hard-cut at `range` despite its comment. If introducing a finite cutoff, compare the visual change rather than claiming identical lighting.

A rectangular door can use normalized two/four source samples, or a fixed-source basis. Normalize total energy; four samples must not quadruple brightness. Area response and area **shadow visibility** are different integration problems. Compare LTC only if its material benefits justify it; LTC is an established technique, not our invention.

Rim may use a view/normal contour term such as `(1-max(0,n·v))^p`, modulated by the actual backlight and silhouette side. Uniform outline dilation is not equivalent to directional rim. Lightning is a temporal/directional modifier and event emitter, not an eleventh mandatory full-screen light pass.

### Cost and validation

- **Controls:** existing Canvas art as art comparison; direct same-material forward shader as optimization reference; fixed-basis candidate.
- **Cost:** extra material/basis fetches versus repeated silhouette/washed-area draws. More texture reads can lose on mobile bandwidth.
- **Locations:** art bake in `zen-night.ts`; `render/{lighting,lights,look,renderer}.ts`; actor materials.
- **Reject:** muddy bands, clipped highlights, inconsistent source color, additional full-screen passes or no total-cost win. Use high precision for world positions/ray denominators and only lower precision where bounded image tests permit it.

---

## 6. SWP — complete-receiver shadow witnesses

### Ground projection reference

In the visual `(x,h,d)` convention, for a directional vector `L` pointing toward a source with `L_h>0`, the ground point is:

```text
S = P - (h/L_h)*L
```

For point origin `O` above the caster (`O_h>h`):

```text
lambda = O_h/(O_h-h)
S = O + lambda*(P-O)
```

Handle near-singular denominators by a documented domain bound/cull/subdivision, not uncontrolled huge coordinates. Project the same geometry used to draw the inn/tree/actor. Clip receiving surfaces and preserve foot contact. If using a deliberately foreshortened stylized projection, name it and maintain its grounding invariants; do not call it exact physical ray tracing.

Different sources have different visibility. A blended moon/door vector is an art approximation and cannot reproduce two separated shadows or independently blocked sources.

### Witness parcel

For receiver parcel `R`, construct all mask samples that the selected reference kernel could visit:

```text
F_i = projection_i(R) (+) rayKernelSupport_i(R) (+) textureFilterSupport
```

`(+)` denotes Minkowski sum. Include the full rectangle/water glint width, varying penumbra and bilinear footprint. Affine corners can bound a parcel; projective mappings need a denominator-domain bound or subdivision.

Start with cheap bounds/row spans. If a SAT is worthwhile, classify each texel:

```text
0 clear; 1 uncertain/fractional/dynamic; 2 fully opaque
```

For a half-open prefix table with zero border, integer rectangle sum is four reads. Only sum `0` proves all clear, or `2*area` proves all opaque, provided the **complete** query lies in the known domain. Any uncertain value, motion sweep or boundary crossing falls back to current direct taps/per-receiver shading or smaller parcels.

Dynamic canopy/actor motion must update a current mask or mark its swept support uncertain. A certified static SAT is not valid for new wind/art; shared projection/caster revision enters the cache key.

### Proof, cost and rejection

- **Existing evidence:** 30,000 static integer/nearest-kernel SAT queries matched the 12-tap reference exactly. This does not prove moving silhouettes, bilinear masks or a whole glint rectangle.
- **Controls:** direct current-mask taps, simple caster bounds, row intervals, SAT certificate, optional distance-field penumbra approximation as a separately reviewed art candidate.
- **Cost:** mask update/readback/build/query and GPU upload must all be counted. Avoid production CPU readback; cache/build static certificates off the hot path. SAT can lose for small geometry or frequent updates.
- **Locations:** `render/bhst.ts`, shadow geometry in `zen-night.ts`/actors, `render/lighting.ts` and local receivers.
- **Reject:** any false-clear/false-opaque parcel, disconnected foot shadow, broad glint leak or whole-frame/resource regression. Uncertainty must increase direct work, not silently lower quality.

---

## 7. MCRI — motion-certified reflection islands

### Exact reuse domain

For a fixed local shape `q`, a current root transform `T_root(t)` and current camera/reflection transform `P(t)`, translating/compositing the same local shape under `P*T_root` preserves root motion without rebaking it. This does not certify shape changes, changing perspective, clip masks or prelit colors.

Cache local actor material/coverage, not an already globally positioned frame. Apply current root, water mapping and compatible live lighting each presentation. Refresh immediately on allocation/context generation, facing/order, material/weapon, exposure/contact or unrepresentable lighting changes.

### Error bound

Let the reflected shape map be `P_ref` including actual backing scale, camera roll/zoom and chosen ground projection. Let water distortion have Jacobian bound `gamma` over the receiver:

```text
E_backing <= gamma * max_k || P_ref(q_k(t)) - P_ref(q_k(cache)) || + E_support
```

`q_k` must include silhouette controls, blade extrema, scarf/cloth and radius/depth changes. `E_support` bounds curve interiors, topology/order changes, widths and filtered texel support. If a valid bound cannot be computed, use current geometry. A few joint centers alone are not a certificate.

Proposed important-edge limit: **0.75 physical/backing pixels**, to be calibrated in motion. This is not a measured achievement. Use the same physical-size convention at fractional DPR and during resize. Attack edges can require a full-rate refresh; long holds can reuse longer. Never impose a fixed 20-Hz ceiling after it fails the bound.

Distortion amplitude alone does not bound `gamma`; a small high-frequency warp can amplify errors sharply. Clamp gradients/design the warp, or evaluate the direct path in hazardous regions. Do not blur stale shapes until they look acceptable.

- **Controls:** full current-pose reflection; corrected whole-atlas cache; local root-live cache.
- **Cost:** refreshed island area + painter/upload bytes + bookkeeping, versus direct geometry. Atlas padding/filtering can waste memory; cache pages need bounded lifetimes.
- **Locations:** `render/renderer.ts` reflection path plus CLDP; proposed reflection cache module.
- **Reject:** stale/empty atlas, incorrect allocation invalidation, delayed blade/foot, old-light color baked into the reflection or total-cost loss. Full current-pose reflection is always available.

---

## 8. WCIQ — Wet-Corridor Impulse Quilt

### Goal and assumption

The visible water is a local puddle/wet film in a 2D battle scene, not an open ocean or a simulated fluid volume. The scene has a few meaningful interactions. Make those interactions coherent and spatially local before paying for general flow.

One event ledger contains `(id,worldPoint,time,impulse,material,sourceKind)`. Water and fog derive their own response kernels from the same event. A foot touching dry wood must not create a water ring. Rain/petals use actual world crossing and wetness queries; draw calls never spawn impulses.

### Low-end analytic surface

For 2–4 coherent components plus bounded ripples:

```text
h(p,t) = Σ A_j*sin(k_j·p - omega_j*t + phi_j) + Σ ripple_i(p,t)
n ∝ (-∂h/∂x, 1, -∂h/∂d)
```

Analytic derivatives give slope without full-field readback. If using physical gravity-capillary parameters, units must be consistent:

```text
omega² = (g*k + (sigma/rho)*k³) * tanh(k*depth)
```

Convert world units to a defined physical scale or call parameters stylized. This dispersion law does not alone model viscosity, shore boundaries, splashes or free-surface breakup.

A project-specific finite-support event kernel can be:

```text
tau = t-eventTime,  r = sqrt(|p-center(tau)|² + epsilon²)
R(tau) = R0 + c*tau,  R0 > epsilon > 0
psi(s) = (1-s²)^3 for 0<=s<1, otherwise 0
ripple = A*exp(-decay*tau)*psi(r/R(tau))*cos(k*(r-c*tau))
```

Evaluate only for `0<=tau<=lifetime` and inside the expanded receiver support. The softened radius has zero spatial derivative at the center, keeping the analytic slope finite there; the Euclidean support is conservatively inside radius R. The cubic envelope has a zero value/first derivative at its edge, avoiding a hard support pop. This is an authored approximate ripple, not an exact wave-equation solution. Center advection is a water-specific response, not necessarily the air-wind integral. Fade by a declared lifetime/error threshold before reclaiming a slot.

Bin event supports along the visible wet corridor or by small receiver patches. Draw/evaluate the *same* contributing kernels as the direct reference. Overflow is not allowed to silently remove important landing/parry effects in an equal-quality test: either allocate within a proved bound, use a direct fallback or explicitly classify the change as an effect-budget tier.

### Optional interaction grid, not baseline requirement

For a puddle needing interacting wavefronts/obstacles, compare a small damped height-field patch:

```text
h_tt + 2*gamma*h_t = c²*Laplacian(h) + forcing
```

A central-time damped update is:

```text
h_next = [2*h_now - (1-gamma*dt)*h_prev + c²*dt²*Lap(h_now) + dt²*f] / (1+gamma*dt)
```

For the uniform rectangular five-point stencil under standard periodic/interior assumptions, use the conservative wave CFL condition:

```text
(c*dt/dx)² + (c*dt/dd)² <= 1
```

Damping does not excuse arbitrary dt. Obstacles, boundaries, variable coefficients and packed formats need their own stability/error checks. Substep visual-grid time consistently; do not feed a 250-ms frame directly into a 60-Hz-tuned solver.

Two 128×32 float32 height arrays are **32 KiB** logical CPU storage; scratch/boundaries/normal buffers and upload staging add more. A two-target RG16F scheme also needs format/renderability checks, and decoded/storage cost is not its only cost. These are arithmetic examples, not a benchmark or a mandated resolution. A coarse grid versus an analytic/direct reference may be a quality tradeoff, not an optimization.

At patch seams use shared boundary samples or a provably compatible overlap blend. Do not double-inject events. Shore masks need absorbing/no-flux rules chosen for the art, not hard unexplained clipping.

### Water composition

Use the same current reflected scene and wetness/roughness mapping:

```text
F = F0 + (1-F0)*(1-max(0,n·v))^5
Cwater = F*RoughReflection + (1-F)*TintedTransmission + SourceGlints
```

This Schlick-like response is established, not invented. A 2.5D painterly camera may use a calibrated view proxy; state that approximation. Distortion, reflected roots, moon glint and the water normal must agree. Wet boards have much less coherent reflection than the puddle.

### Comparisons and rejection

- **Controls:** direct same analytic kernels; spatially binned same kernels; optional small wave grid as an art/interaction alternative; stable-fluids grid only if actual flow is needed.
- **Locations:** `zen-night.ts` water/ripples, `storm.ts` impacts, renderer reflections, contact events; proposed `world/water.ts` and `world/impulses.ts`.
- **Cost:** analytic O(visible receivers × overlapping events), grid O(patch cells × substeps) plus raster/transfer. Pressure iterations, FFT, SPH/FLIP are outside the baseline.
- **Reject:** border seams, expanding energy without forcing, false water events, aliasing normals, obscured contact or a patch that costs more than direct analytic ripples. Fall back to the accepted analytic model, not no water.

---

## 9. EFBL — explicit emission and finite-support bloom ledger

### Separate art change from optimization

Changing whole-scene bloom into explicit emission is an **art redesign**. First approve the new source equation. Then compare full-field and localized evaluation of the **same emission and kernel**.

Let emission `E` be premultiplied linear radiance and finite kernel `K` have support radius `r`:

```text
B = K*E
D_out = dilate(support(E_current-E_previous),r)
```

Include old/current emitter and occluder bounds, transformed filtering support, allocation changes and hidden/revealed regions. To recompute `B` over `D_out`, gather **all** current emission in `dilate(D_out,r)`, including unchanged overlapping emitters. Updating only changed emitters erases neighbors. Blur passes that use a cached intermediate need their own propagated dirty support.

Gaussian kernels are not truly finite. Define a fixed truncation radius and compare against the same truncated reference; choosing a smaller support is a separate quality change. Grain/grade applied in the final compositor need not invalidate emission, but an occlusion/lighting change that affects all emission can legitimately force a full refresh.

Merge a unique physical-pixel tile/rectangle union. Sparse updates need previous/current halo clearing; dense occupancy switches to the full pass at a measured crossover. On a tile-based GPU, many tiny scissor/render-target operations can be worse than one contiguous pass.

### Executed limited evidence

`audit/mobile-reference-models.py` compares full-target and local recomputation using a fixed discrete radius-2 box kernel, zero-extension at image boundaries, 250 cases / **108,000 pixels**: **maximum error 0**. It also finds counterexamples to changed-sources-only recomputation.

This proves the exercised discrete reference-model invariant. It does **not** validate GPU filtering, alpha/occlusion implementation, camera motion, a new Gaussian kernel or mobile performance. Earlier whole-scene bloom timings are historical software-Canvas evidence, not today's measured bottleneck.

- **Controls:** same-emission full-target blur; ledger blur; simple single local halo sprites as an art alternative.
- **Locations:** `render/renderer.ts`, emission packets from scene/actors/FX; proposed bloom ledger.
- **Reject:** trails, missing neighboring energy, per-tile overhead regression or extra full-scene capture/upload. Revert to the correct full-field same-kernel path when dirty coverage is large.

---

## 10. Bounded bakes and resource generations

### Proposed lifecycle

```text
request generation G with {scene,art,backing,capabilities}
  → bake/decode critical static pieces under a stated task budget
  → transfer/upload bounded batches
  → verify all required pieces complete for G
  → atomically publish G
  → release superseded generations/resources
```

Cancel stale work on resize/scene change. Do not publish half an inn or mismatch its shadow/material revision. Retain the old complete generation only within the transition memory budget. Build-time assets reduce runtime work; compressed downloads, decoded bitmaps, CPU copies and GPU textures remain separate ledger entries.

OffscreenCanvas baking is a capability-checked candidate. The fallback yields between bounded main-thread tasks; an idle callback is not a guaranteed frame budget. Full renderer workers additionally require timestamped input/camera/resource ownership and can introduce latency, so they are not the first migration.

- **Controls:** synchronous original bake, staged main-thread bake, worker-capable bake at the same accepted art/resolution.
- **Metrics:** cold interactive/playable time, first fight hitch, peak live resource overlap, cancellation correctness and post-resize stability.
- **Locations:** `zen-night.ts:ensure/resize`, application mount/asset preparation, renderer target allocation.
- **Reject:** larger cold critical path, resource growth, stale generation publication or added first-input delay. A skeleton loading screen is allowed; a frozen unresponsive one is not success.

---

## 11. Comparison protocol and kill list

### Quality lock

Freeze `{gameSHA, artRevision, seedStreams, replay, wall-input trace, viewportCSS, backingPixels, tier, populations, emitters, shadowLights, reflectionPolicy, timePolicy}`. Run correctness repairs before performance comparisons. Turning off a broken effect or lowering counts/resolution is not a fair control.

### Candidate promotion

1. Verify source-level contracts and direct-reference correctness.
2. Produce event-aligned image/motion comparisons at the same accepted art revision.
3. Measure uninstrumented-enough full-engine pacing and the suspected bottleneck on **physical devices**.
4. Include startup, memory, sustained thermal and input behavior.
5. Reject complexity if it loses to a simple correct control—even if a technique's own inner loop looks faster.

### Not in the low-end baseline

- Full 3D rewrite just to obtain shadows/parallax.
- Ten full-screen lighting passes for ten named behaviors.
- Cubemap shadows per lamp, cascaded maps, SSR/SSAO, TAA/depth-of-field stack.
- Dense volumetric cloud raymarch, whole-screen multipass fluid pressure solve or ocean FFT for a small puddle.
- Per-frame full-resolution Canvas capture/upload as the final GPU architecture.
- Production readbacks/`gl.finish` to create flattering timings.
- Deliberately frozen sky/reflections, deleted particles or reduced backing resolution disguised as equal-quality optimization.

**Fallback principle:** use the simple correct current-time/current-geometry path when a proof/cache does not apply. Uncertainty must not be converted into missing work or a false performance claim.
