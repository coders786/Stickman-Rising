import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { BakeContext, bakeOnceDeferred } from '../src/gpu/context'

/** The bake context and fence lifecycle, without depending on local GPU speed. */
function fakeGL(t: TestContext, renderer: string, onPoll = () => {}) {
  const calls: string[] = []
  const TIMEOUT_EXPIRED = 3
  const gl = {
    RENDERER: 0, MAX_TEXTURE_SIZE: 1,
    ALREADY_SIGNALED: 1, CONDITION_SATISFIED: 2, TIMEOUT_EXPIRED,
    getExtension: (name: string) => name === 'WEBGL_lose_context'
      ? { loseContext: () => { calls.push('lose') } } : null,
    getParameter: (param: number) => param === 0 ? renderer : 4096,
    createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
    readPixels: () => { calls.push('pack') },
    fenceSync: () => ({}), flush: () => {},
    clientWaitSync: () => { calls.push('poll'); onPoll(); return TIMEOUT_EXPIRED },
    getBufferSubData: () => { assert.fail('unready pixels must never be downloaded') },
    deleteSync: () => { calls.push('delete fence') },
    deleteBuffer: () => { calls.push('delete buffer') },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({
      getContext: (_kind: string, attributes: WebGLContextAttributes) => {
        calls.push(attributes.failIfMajorPerformanceCaveat ? 'interactive context' : 'context')
        return gl
      },
      addEventListener: () => {}, removeEventListener: () => {},
    }) },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  })
  return { calls, gl }
}

const noTarget = (): HTMLCanvasElement => assert.fail('a pending or refused GPU bake must not allocate output')

test('interactive bakes reject software WebGL before submitting a shader', async t => {
  const { calls } = fakeGL(t, 'ANGLE (SwiftShader)')
  const out: { error?: string } = {}
  const signal = new AbortController().signal
  const baked = await bakeOnceDeferred(4, 4, '', [], signal, out, noTarget, performance.now() + 5_000)
  assert.equal(baked, null)
  assert.equal(out.error, 'software WebGL')
  assert.deepEqual(calls, ['interactive context', 'lose'])
  // The shared budget can also prevent a second plate's context acquisition.
  assert.equal(await bakeOnceDeferred(4, 4, '', [], signal, out, noTarget, performance.now()), null)
  assert.equal(out.error, 'sky bake budget exceeded')
  assert.deepEqual(calls, ['interactive context', 'lose'])
})

for (const cancel of [false, true]) {
  test(`pending WebGL readback releases all scratch on ${cancel ? 'cancellation' : 'budget expiry'}`, async t => {
    let now = 0
    t.mock.method(performance, 'now', () => now)
    const deadline = 48
    const { calls, gl } = fakeGL(t, 'Test hardware', () => { now = deadline })
    const ctx = new BakeContext(true)
    // Stand in for the submitted framebuffer; the actual async pack/fence
    // path runs, with no GL driver involved on CI.
    Object.defineProperty(ctx, 'draw', { value: () => ({ gl, W: 4, H: 4, release: () => calls.push('release draw') }) })
    const abort = new AbortController(), out: { error?: string } = {}
    try {
      const pending = ctx.bakeDeferred(4, 4, '', [], abort.signal, out, noTarget, deadline)
      if (cancel) abort.abort()
      assert.equal(await pending, null)
      assert.equal(out.error, cancel ? 'cancelled' : 'sky bake budget exceeded')
    } finally { ctx.dispose() }
    assert.deepEqual(calls, ['interactive context', 'pack', ...(!cancel ? ['poll'] : []), 'delete fence', 'delete buffer', 'release draw', 'lose'])
  })
}
