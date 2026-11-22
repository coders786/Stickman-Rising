// Only for an invisible draft. Ordinary combat still submits one complete
// frame per draw. Each boundary gives input, layout and composition a turn.
export const OPENING_PAINT_SLICE_MS = 6

export function finishPaint<T>(steps: Generator<void, T>): T {
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}

export function advancePaint(steps: Generator<void>, ms = OPENING_PAINT_SLICE_MS, clock = () => performance.now()): boolean {
  const end = clock() + ms
  do {
    if (steps.next().done) return true
  } while (clock() < end)
  return false
}
