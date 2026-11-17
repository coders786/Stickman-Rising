/** STICKMAN RISING — scripts/lint-boundaries.mjs
 * ARCHITECTURE AS A GATE, NOT A COMMENT.
 * ----------------------------------------------------------------------------
 * Three rules from docs/master/05 that a reviewer would otherwise have to
 * remember on every diff:
 *
 *  1. ONLY THE LEDGER CREATES OFFSCREEN CANVASES. `render/ledger.ts` and the
 *     sky-vault cache are the two allowed sites; everything else must ask. The
 *     measured cost of ignoring this is 30.3 MB resident and 37 untracked
 *     surfaces (12 §4).
 *  2. `src/gpu/**` NEVER IMPORTS GAME ENTITIES. The baker is a leaf: it may
 *     read a profile, never a Player. This is what keeps the "GPU is a baker"
 *     decision (D3) from quietly becoming "the GPU layer knows about combat".
 *  3. NO `Math.random` IN DETERMINISTIC MODULES. World/render/animation code
 *     must be a pure function of the seed, or a run cannot be replayed and a
 *     bug cannot be reproduced. `game.ts` (run seeding) and `debug/` are the
 *     documented exceptions.
 *
 * Usage: node scripts/lint-boundaries.mjs   (exit 1 on any violation)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

/** A BASELINE, not a rubber stamp. The rules above describe the target
 *  architecture; the repo is mid-migration (37 untracked canvases in
 *  `background.ts`, sound-variation randomness in `audio.ts`). The baseline
 *  freezes today's debt PER FILE so the gate fails on anything NEW while the
 *  migration lands in steps — the alternative, switching the gate off until the
 *  migration is done, is how architecture rules die.
 *  Regenerate deliberately: node scripts/lint-boundaries.mjs --write-baseline */
const BASELINE_PATH = 'scripts/boundaries-baseline.json'
const WRITE = process.argv.includes('--write-baseline')

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(p)
  }
  return out
}

const violations = []
const push = (file, line, rule, what) => violations.push({ file, line, rule, what })
const keyOf = (v) => `${v.file.replace(/\\/g, '/')}|${v.rule}`

/* rule 1 — canvas creation */
const CANVAS_OK = ['render/ledger.ts', 'render/bhst.ts']
for (const f of walk('src/game')) {
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (!line.includes("createElement('canvas')")) return
    if (CANVAS_OK.some((ok) => f.endsWith(ok.replace('/', sep)))) return
    // A file that receives a factory is fine; a file that BUILDS one is the
    // thing we are counting, and the ledger's own doc says why.
    push(f, i + 1, 'canvas-ownership', "createElement('canvas') outside the ledger")
  })
}

/* rule 2 — the GPU layer is a leaf */
for (const f of walk('src/gpu')) {
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    const m = line.match(/from\s+['"]([^'"]+)['"]/)
    if (!m) return
    const target = m[1]
    if (target.includes('entities/') || target.includes('combat/')) {
      push(f, i + 1, 'gpu-leaf', `gpu imports ${target}`)
    }
  })
}

/* rule 3 — determinism */
const RANDOM_OK = ['world/profile.ts', 'gpu/sky.ts', 'core/utils.ts']
for (const f of walk('src/game')) {
  if (f.includes(`${sep}debug${sep}`)) continue
  if (RANDOM_OK.some((ok) => f.endsWith(ok.replace('/', sep)))) continue
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
    if (!/Math\.random\(\)/.test(line)) return
    // The run seed is the one place randomness is permitted: it is the INPUT
    // to determinism, not a violation of it.
    if (f.endsWith('game.ts')) return
    push(f, i + 1, 'determinism', 'Math.random() in a seeded module')
  })
}

/* rule 4 — the draw path may not build colour strings */
for (const f of [...walk('src/game/entities'), ...walk('src/game/fx')]) {
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (/`rgba\(\d+,\d+,\d+,\$\{/.test(line)) {
      push(f, i + 1, 'allocation-free-draw', 'template rgba() — use rgbaConst()')
    }
  })
}

/* --------------------------- baseline compare --------------------------- */
const counts = new Map()
for (const v of violations) counts.set(keyOf(v), (counts.get(keyOf(v)) ?? 0) + 1)

if (WRITE) {
  const serialised = Object.fromEntries([...counts.entries()].sort())
  writeFileSync(BASELINE_PATH, JSON.stringify(serialised, null, 2) + '\n')
  console.log(`boundaries: baseline written (${counts.size} entries)`)
  process.exit(0)
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {}
const fresh = []
for (const v of violations) {
  const allowed = baseline[keyOf(v)] ?? 0
  if ((counts.get(keyOf(v)) ?? 0) > allowed) fresh.push(v)
}
if (fresh.length === 0) {
  const known = violations.length
  console.log(`boundaries: clean (${known} known, 0 new)`)
  process.exit(0)
}
violations.length = 0
violations.push(...fresh)
const byRule = new Map()
for (const v of violations) {
  if (!byRule.has(v.rule)) byRule.set(v.rule, [])
  byRule.get(v.rule).push(v)
}
for (const [rule, list] of byRule) {
  console.log(`\n${rule}: ${list.length}`)
  for (const v of list.slice(0, 25)) console.log(`  ${v.file}:${v.line}  ${v.what}`)
  if (list.length > 25) console.log(`  … ${list.length - 25} more`)
}
console.log(`\n${violations.length} boundary violation(s)`)
process.exit(1)
