/* advance window.__qaAnat to the phase whose name starts with `name`,
 * then resolve. Usage: agent-browser eval "advanceTo('sprintA')" */
window.advanceTo = async (name) => {
  const A = window.__qaAnat
  let guard = 0
  while (!A.done && !A.phase.startsWith(name + ':') && guard < 15) {
    await A.next()
    guard++
  }
  return A.phase
}
