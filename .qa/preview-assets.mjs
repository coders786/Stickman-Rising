// Measure response bodies as sent over HTTP, rather than source-tree sizes.
// SR_QA_HOST tests preview-style Host/Origin headers. Pass a preview-boot JSON
// trace as an argument to include dynamically loaded scripts through Engage-ready.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

const root = new URL(process.env.SR_QA_URL || 'http://127.0.0.1:3000/')
const host = process.env.SR_QA_HOST
const request = url => new Promise((resolve, reject) => {
  const transport = url.protocol === 'https:' ? https : http
  const req = transport.get(url, {
    headers: { 'accept-encoding': 'br, gzip', ...(host && { host, origin: `https://${host}`, 'sec-fetch-site': 'same-origin' }) },
  }, res => {
    const chunks = []
    res.on('data', chunk => chunks.push(chunk)).on('error', reject).on('end', () => {
      try {
        const body = Buffer.concat(chunks)
        const encoding = res.headers['content-encoding'] || 'identity'
        const decoded = encoding === 'gzip' ? gunzipSync(body) : encoding === 'br' ? brotliDecompressSync(body) : body
        resolve({ url: url.pathname, status: res.statusCode, encoding, bytes: body.length,
          decodedBytes: decoded.length, cache: res.headers['cache-control'], type: res.headers['content-type'],
          links: res.headers.link ?? '', text: decoded })
      } catch (error) { reject(error) }
    })
  })
  req.on('error', reject).setTimeout(20_000, () => req.destroy(new Error(`Timed out: ${url.pathname}`)))
})
const { text, links, ...html } = await request(root)
assert.equal(html.status, 200)
assert.match(html.type, /text\/html/)
const shellPaths = [...new Set([
  ...[...text.toString('utf8').matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+\.(?:js|css|woff2))(?:\?[^"#]+)?"/g)].map(m => m[1]),
  ...[...links.matchAll(/<(\/_next\/static\/[^>?#]+\.(?:js|css|woff2))(?:\?[^>]+)?>/g)].map(m => m[1]),
])]
assert.ok(shellPaths.some(path => path.endsWith('.js')), 'no startup JS found')
const trace = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')).timing.resources : []
const observed = new Set(trace.map(e => e.path))
const lazyPaths = [...observed].filter(path => !shellPaths.includes(path) && /^\/_next\/static\/[^?#]+\.(js|css|woff2)$/.test(path))
const files = await Promise.all([...shellPaths, ...lazyPaths].map(async path => {
  const { text: _text, links: _links, ...file } = await request(new URL(path, root))
  assert.equal(file.status, 200, path)
  const type = path.endsWith('.js') ? /javascript/ : path.endsWith('.css') ? /text\/css/ : /woff2/
  assert.match(file.type, type, path)
  if (process.env.SR_QA_REQUIRE_IMMUTABLE) assert.match(file.cache, /immutable/, path)
  return { ...file, stage: lazyPaths.includes(path) ? 'deferred' : 'shell' }
}))
const total = group => ({ requests: group.length, bytes: group.reduce((n, f) => n + f.bytes, 0),
  decodedBytes: group.reduce((n, f) => n + f.decodedBytes, 0) })
const totals = groups => Object.fromEntries(['js', 'css', 'woff2'].map(ext => [ext, total(groups.filter(f => f.url.endsWith('.' + ext)))]))
console.log(JSON.stringify({ html, shell: totals(files.filter(f => f.stage === 'shell')),
  throughReady: trace.length ? totals(files.filter(f => observed.has(f.url))) : null, files }, null, 2))
