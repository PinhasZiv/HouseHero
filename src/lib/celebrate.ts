// A tiny imperative confetti burst, used to make completing a task or
// approving a reward feel like a small win rather than a form submission.
//
// This is deliberately DOM-imperative rather than a React component: the
// button that triggers it usually sits on a TaskCard that gets unmounted the
// moment the underlying task moves from "due" to "done" (a different list,
// so React tears the old instance down rather than animating it in place).
// A burst anchored to document.body outlives that remount and always
// finishes playing.

const PARTICLE_COLORS = ['#5b4fc4', '#e8c06a', '#6fcf97', '#ef8354', '#56ccf2']
const PARTICLE_COUNT = 10

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** A burst of small particles flying outward from (x, y), then fading. */
export function burstConfetti(x: number, y: number): void {
  if (prefersReducedMotion()) return

  const container = document.createElement('div')
  container.className = 'confetti-burst'
  container.style.left = `${x}px`
  container.style.top = `${y}px`

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const piece = document.createElement('span')
    piece.className = 'confetti-piece'
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + Math.random() * 0.4
    const distance = 34 + Math.random() * 26
    piece.style.setProperty('--dx', `${Math.cos(angle) * distance}px`)
    piece.style.setProperty('--dy', `${Math.sin(angle) * distance}px`)
    piece.style.setProperty('--rot', `${Math.round(Math.random() * 360)}deg`)
    piece.style.background = PARTICLE_COLORS[i % PARTICLE_COLORS.length]
    container.appendChild(piece)
  }

  document.body.appendChild(container)
  window.setTimeout(() => container.remove(), 700)
}

/** A "+N" label that floats up from (x, y) and fades - the score-attack feel. */
export function floatScore(x: number, y: number, amount: number): void {
  if (prefersReducedMotion()) return

  const label = document.createElement('span')
  label.className = 'score-float'
  label.style.left = `${x}px`
  label.style.top = `${y}px`
  label.textContent = `+${amount}`

  document.body.appendChild(label)
  window.setTimeout(() => label.remove(), 900)
}

/** Fires both effects from a click/tap position - the common case. */
export function celebrateAt(x: number, y: number, points?: number): void {
  burstConfetti(x, y)
  if (points) floatScore(x, y, points)
}

/**
 * A small red shake-and-fade "✕" at (x, y) - the opposite of celebrateAt.
 * Used whenever an action did not actually succeed (the request failed) or
 * whose outcome is itself a "no" (rejecting someone's request), so the
 * screen never shows a confetti burst for something that didn't happen.
 */
export function failAt(x: number, y: number): void {
  if (prefersReducedMotion()) return

  const mark = document.createElement('span')
  mark.className = 'fail-mark'
  mark.style.left = `${x}px`
  mark.style.top = `${y}px`
  mark.textContent = '✕'

  document.body.appendChild(mark)
  window.setTimeout(() => mark.remove(), 600)
}
