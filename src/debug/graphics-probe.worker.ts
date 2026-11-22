import { driverProbeSteps } from './graphics-driver-probes'

// This context and all readbacks belong solely to the diagnostic worker.
// Yield between steps, including parallel-shader completion polls. A null
// result asks the UI to use its sliced fallback if worker WebGL is denied.
const steps = driverProbeSteps()
function advance(): void {
  try {
    const next = steps.next()
    if (!next.done) { setTimeout(advance, 0); return }
    self.postMessage(next.value.errors.includes('WebGL2 not available in this browser') ? null : next.value)
  } catch {
    steps.return(undefined as never)
    self.postMessage(null)
  }
}
advance()
