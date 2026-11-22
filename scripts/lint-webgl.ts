/** ES 3.00 portability gate. No browser/driver needed. `--compile` also
 * exports the exact programs and runs the native validator if installed. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { parse } from '@shaderfrog/glsl-parser/index.js'
import { BRIDGE_PROGRAMS } from '../src/gpu/bridge-programs'
import { SKY_BAKE_VERT } from '../src/gpu/context'
import { MOON_FRAG, STARS_FRAG } from '../src/gpu/sky'
import { SACRUniformBuffer } from '../src/graphics/sacr/SACRPacker'

const PROGRAMS = { ...BRIDGE_PROGRAMS, moonBake: [SKY_BAKE_VERT, MOON_FRAG], starBake: [SKY_BAKE_VERT, STARS_FRAG] } as const
const forbidden = /\b(?:unpackUnorm4x8|packUnorm4x8|imageLoad|imageStore|atomicOr|uintBitsToFloat)\b/g
const clean = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, part => part.replace(/[^\r\n]/g, ' '))
const squeeze = (s: string) => clean(s).replace(/\s+/g, '')
const hasMain = /\bvoid\s+main\s*\(/
const extensions = new Set(['.vert', '.frag', '.glsl', '.vs', '.fs'])
const ignored = new Set(['node_modules', '.git', '.cache', '.arena', '.next', '.next-build', '.next-preview', 'out', 'dist', 'build', '.venv'])

function* walk(dir: string): Iterable<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ignored.has(entry.name)) continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (entry.isFile()) yield p
  }
}

type Ast = { type: string; [prop: string]: unknown; location?: { start: { line: number } } }
function eachAst(value: unknown, visit: (node: Ast) => void) {
  if (value === null || typeof value !== 'object') return
  if ('type' in value && typeof value.type === 'string') visit(value as Ast)
  for (const child of Object.values(value)) eachAst(child, visit)
}
const ident = (x: unknown) => (x as { identifier?: string } | null)?.identifier
const node = (x: unknown) => x as Ast | undefined

/** Prove dynamic brackets are *array* subscripts, including temporaries and
 * function parameters. Vector lanes (including derived UBO vec4s) must use
 * .xyzw or a literal. The conservative rule is the same on iOS and desktop. */
function lintIndices(ast: ReturnType<typeof parse>, label: string, errors: string[]): void {
  const dims = new Map<string, Set<number>>()
  eachAst(ast.program, n => {
    if (!['declaration', 'parameter_declaration', 'quantified_identifier'].includes(n.type)) return
    const name = ident(n.identifier)
    if (!name) return
    const arity = Array.isArray(n.quantifier) ? n.quantifier.length : 0
    const used = dims.get(name) ?? new Set()
    used.add(arity); dims.set(name, used)
  })
  const chain = (n: Ast | undefined): Ast[] => !n ? [] : n.type === 'postfix' ? [...chain(node(n.expression)), ...chain(node(n.postfix))] : [n]
  eachAst(ast.program, n => {
    const expr = node(n.expression)
    if (n.type !== 'postfix' || !expr || ['quantifier', 'field_selection', 'literal'].includes(expr.type)) return
    const name = expr.type === 'identifier' ? ident(expr) : undefined
    const found = name && dims.get(name)
    let arity = found && found.size === 1 ? [...found][0] : 0
    for (const postfix of chain(node(n.postfix))) {
      if (postfix.type === 'field_selection') { arity = 0; continue }
      if (postfix.type !== 'quantifier') continue
      if (arity > 0) { arity--; continue }
      if (!['int_constant', 'uint_constant'].includes(node(postfix.expression)?.type ?? '')) {
        errors.push(`${label}:${postfix.location?.start.line ?? '?'}: dynamic vector-lane indexing; use a fixed lane or selector`)
      }
    }
  })
}

function lintLayout(s: string, label: string, errors: string[]) {
  if (!s.includes('SACR_v40_UBO')) return
  const match = s.match(/layout\s*\(\s*std140\s*\)\s*uniform\s+SACR_v40_UBO\s*\{([^}]*)\}\s*;/)
  const members = match?.[1].split(';').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean)
  const expected = [['uvec4', 'u_ColBins', 40, 0], ['uvec4', 'u_PrimPool', 64, 160],
    ['uvec4', 'u_ArchProfile', 32, 416], ['vec4', 'u_FootAO', 16, 544], ['uvec4', 'u_ShadowBins', 40, 608],
    ['vec4', 'u_DynamicBlockers', 24, 768], ['vec4', 'u_Supports', 8, 864]] as const
  const cpuOffsets = [SACRUniformBuffer.OFF_COLBINS, SACRUniformBuffer.OFF_PRIMPOOL, SACRUniformBuffer.OFF_ARCHPROFILE, SACRUniformBuffer.OFF_FOOTAO,
    SACRUniformBuffer.OFF_SHADOWBINS, SACRUniformBuffer.OFF_BLOCKERS, SACRUniformBuffer.OFF_SUPPORTS]
  let bytes = 0
  if (members?.length !== expected.length || expected.some(([type, name, count, offset], i) => {
    const valid = !!members[i].match(new RegExp(`^${type} ${name}\\s*\\[\\s*${count}\\s*\\]$`)) && bytes === offset * 4 && cpuOffsets[i] === offset
    bytes += count * 16
    return !valid
  }) || bytes !== 3584 || SACRUniformBuffer.BYTE_LENGTH !== bytes) {
    errors.push(`${label}: SACR_v40_UBO must be std140, 3584 bytes, offsets 0/640/1664/2176/2432/3072/3456`)
  }
}

export function lintShader(source: string, label: string, stage: 'vertex' | 'fragment' | 'either' = 'either'): string[] {
  const errors: string[] = [], s = clean(source)
  if (!/^\s*#version\s+300\s+es\s*(?:\r?\n|$)/.test(s) || (s.match(/^\s*#version\b/gm)?.length ?? 0) !== 1) {
    errors.push(`${label}: first directive must be #version 300 es (exactly once)`)
  }
  for (const m of s.matchAll(forbidden)) errors.push(`${label}: forbidden WebGL2 op ${m[0]}`)
  lintLayout(s, label, errors)
  if (!hasMain.test(s)) errors.push(`${label}: complete shader must define main`)
  try { lintIndices(parse(source, { stage, quiet: true, includeLocation: true, grammarSource: label }), label, errors) }
  catch (error) { errors.push(`${label}: ${String(error)}`) }
  return errors
}

export function rgb9MipErrors(source: string, label: string): string[] {
  const s = clean(source)
  return /\b(?:RGB9_E5|UNSIGNED_INT_5_9_9_9_REV|uploadStratumB)\b/.test(s) && /\bgenerateMipmap\s*\(/.test(s)
    ? [`${label}: RGB9_E5 path must upload explicit levels, not generateMipmap`] : []
}

function includesParts(whole: string, pieces: string[]): boolean {
  let i = 0
  for (const part of pieces) {
    const offset = whole.indexOf(part, i)
    if (offset === -1) return false
    i = offset + part.length
  }
  return true
}

export function lintWebGL(): { errors: string[]; stages: number; standalone: number; embedded: number } {
  const errors: string[] = [], seen = new Map<string, string>()
  let standalone = 0, embedded = 0
  for (const [name, [vs, fs]] of Object.entries(PROGRAMS)) for (const [ext, src] of [['vert', vs], ['frag', fs]] as const) {
    if (seen.has(src)) continue
    const label = `${name}.${ext}`
    errors.push(...lintShader(src, label, ext === 'vert' ? 'vertex' : 'fragment'))
    seen.set(src, squeeze(src))
  }
  if (![BRIDGE_PROGRAMS.masterRoad, BRIDGE_PROGRAMS.mobileRoad].every(([, src]) => src.includes('SACR_v40_UBO'))) errors.push('Both live SACR road programs must use the validated std140 block')
  for (const file of walk('.')) {
    const ext = extname(file)
    if (extensions.has(ext)) {
      standalone++
      errors.push(...lintShader(readFileSync(file, 'utf8'), file, ext === '.vert' || ext === '.vs' ? 'vertex' : ext === '.frag' || ext === '.fs' ? 'fragment' : 'either'))
    } else if (/^(src|public|shaders)[/\\]/.test(file) && /\.[cm]?[jt]sx?$/.test(file)) {
      const source = readFileSync(file, 'utf8')
      errors.push(...rgb9MipErrors(source, file))
      const fileAst = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      function visit(n: ts.Node) {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
          const raw = ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map(s => s.literal.text)] : [n.text]
          const text = clean(raw.join(' '))
          if (hasMain.test(text) || /#version\s+\d+|\blayout\s*\(\s*std140\s*\)|\bprecision\s+(lowp|mediump|highp)|\buniform\s+(?:sampler\w*|[iu]?vec[234]|float|int)\s/.test(text)) {
            embedded++
            const line = fileAst.getLineAndCharacterOfPosition(n.getStart()).line + 1
            const label = `${file}:${line}`
            const parts = raw.map(squeeze).filter(Boolean)
            if (![...seen.values()].some(s => includesParts(s, parts))) {
              if (hasMain.test(text) && raw.length === 1) errors.push(...lintShader(raw[0], label))
              else errors.push(`${label}: GLSL snippet not accounted for by a versioned live shader; register the assembled source`)
            }
          }
        }
        ts.forEachChild(n, visit)
      }
      visit(fileAst)
    }
  }
  return { errors, stages: seen.size, standalone, embedded }
}

function offlineCompile(requireCompiler: boolean): boolean {
  const folder = resolve('out/sacr-shaders')
  mkdirSync(folder, { recursive: true })
  const pairs = Object.entries(PROGRAMS).map(([name, [vert, frag]]) => {
    const files = [join(folder, `${name}.vert`), join(folder, `${name}.frag`)]
    writeFileSync(files[0], vert); writeFileSync(files[1], frag)
    return files
  })
  const version = spawnSync('glslangValidator', ['--version'], { encoding: 'utf8' })
  if (version.error && (version.error as NodeJS.ErrnoException).code === 'ENOENT') {
    console.log('SKIPPED: glslangValidator binary absent')
    const naga = spawnSync('naga', ['--version'], { encoding: 'utf8' })
    if (naga.error && (naga.error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('SKIPPED: naga binary absent')
      if (requireCompiler) console.error('Offline shader validation requires a native compiler (install glslang-tools).')
      return !requireCompiler
    }
    if (naga.status !== 0) { console.error(naga.error ?? naga.stderr); return false }
    for (const p of pairs.flat()) if (spawnSync('naga', [p], { stdio: 'inherit' }).status !== 0) return false
    console.log(`naga: validated ${pairs.length * 2} stages (no program link)`)
    return true
  }
  if (version.status !== 0) { console.error(version.error ?? version.stderr); return false }
  // Native ES semantics. -G would *generate SPIR-V* and requires ES 3.10+;
  // bumping versions to satisfy that switch would test different shaders.
  for (const files of pairs) if (spawnSync('glslangValidator', ['-l', ...files], { stdio: 'inherit' }).status !== 0) return false
  console.log(`glslangValidator: validated and linked ${pairs.length} exact ES 3.00 programs`)
  return true
}

function main(): void {
  const r = lintWebGL()
  if (r.errors.length) { console.error(r.errors.join('\n')); process.exitCode = 1; return }
  console.log(`webgl lint: ${r.stages} unique ES 3.00 stages, ${r.embedded} embedded snippets, ${r.standalone} standalone; SACR std140 3584 bytes (0/640/1664/2176/2432/3072/3456)`)
  if (process.argv.includes('--compile') && !offlineCompile(process.argv.includes('--require-compiler'))) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
