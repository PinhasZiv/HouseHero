import { describe, expect, it } from 'vitest'
import { createBackStack, type HistoryLike } from './backStack'

/** A fake session history: a depth counter, with back() delivering its
 *  popstate asynchronously the way a browser does. */
function setup() {
  const queue: (() => void)[] = []
  let depth = 0
  const pops: (() => void)[] = []
  const history: HistoryLike = {
    pushState: () => {
      depth++
    },
    back: () => {
      pops.push(() => {
        depth--
        stack.handlePopState()
      })
    },
  }
  const stack = createBackStack(history, (run) => queue.push(run))
  const flush = () => {
    while (queue.length || pops.length) {
      while (queue.length) queue.shift()!()
      if (pops.length) pops.shift()!()
    }
  }
  /** The person pressing back. */
  const pressBack = () => {
    depth--
    stack.handlePopState()
    flush()
  }
  return { stack, flush, pressBack, depth: () => depth }
}

describe('the back stack', () => {
  it('raises one guard entry while something is open, and drops it when closed from the UI', () => {
    const { stack, flush, depth } = setup()
    const close = stack.register(() => {})
    flush()
    expect(depth()).toBe(1)

    close()
    flush()
    expect(depth()).toBe(0)
  })

  it('back closes the topmost closer only, then re-raises the guard for what is left', () => {
    const { stack, flush, pressBack, depth } = setup()
    const closed: string[] = []
    let closeForm: () => void = () => {}
    let closeConfirm: () => void = () => {}
    closeForm = stack.register(() => {
      closed.push('form')
      closeForm()
    })
    closeConfirm = stack.register(() => {
      closed.push('confirm')
      closeConfirm()
    })
    flush()
    expect(depth()).toBe(1)

    pressBack()
    expect(closed).toEqual(['confirm'])
    expect(depth()).toBe(1)

    pressBack()
    expect(closed).toEqual(['confirm', 'form'])
    expect(depth()).toBe(0)
  })

  it('a close and an open in the same tick never touch history', () => {
    const { stack, flush, depth } = setup()
    const closeEdit = stack.register(() => {})
    flush()
    expect(depth()).toBe(1)

    // The duplicate flow: the edit form closes as the new-task form opens.
    closeEdit()
    stack.register(() => {})
    flush()
    expect(depth()).toBe(1)
  })

  it('an open right after a close-from-UI waits for the pending back, instead of racing it', () => {
    const queue: (() => void)[] = []
    const pops: (() => void)[] = []
    let depth = 0
    const stack = createBackStack(
      { pushState: () => depth++, back: () => pops.push(() => { depth--; stack.handlePopState() }) },
      (run) => queue.push(run),
    )
    const close = stack.register(() => {})
    queue.shift()!()
    close()
    queue.shift()!() // issues back(), popstate not delivered yet
    stack.register(() => {})
    while (queue.length) queue.shift()!()
    expect(depth).toBe(1) // not pushed yet - the back() is still in flight

    pops.shift()!()
    while (queue.length) queue.shift()!()
    expect(depth).toBe(1) // back landed, then the guard went up again
  })

  it('isTop reports only the most recent open closer', () => {
    const { stack } = setup()
    const first = stack.register(() => {})
    const second = stack.register(() => {})
    expect(stack.isTop(second)).toBe(true)
    expect(stack.isTop(first)).toBe(false)
    second()
    expect(stack.isTop(first)).toBe(true)
  })

  it('ignores a popstate when no guard is up - a real navigation, not ours', () => {
    const { stack, pressBack } = setup()
    let called = false
    stack.register(() => {
      called = true
    })
    // No flush: the guard was never pushed.
    pressBack()
    expect(called).toBe(false)
  })
})
