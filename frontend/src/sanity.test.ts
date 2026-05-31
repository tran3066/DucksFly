import { describe, it, expect } from 'vitest'

// Step 00.1 sanity suite. Proves the test toolchain itself works: that the `test`
// script actually invokes Vitest, that async tests resolve, and that the jsdom
// DOM environment is live (later pose/webcam code needs both async and the DOM).
// Kept permanently as a cheap smoke test after dependency bumps.
describe('00.1 test runner sanity', () => {
  it('runner executes math', () => {
    expect(1 + 1).toBe(2)
  })

  it('async tests resolve', async () => {
    const v = await Promise.resolve(42)
    expect(v).toBe(42)
  })

  // ADVERSARIAL / edge case: fails loudly if jsdom is not the test environment.
  it('jsdom dom environment present', () => {
    expect(typeof document).not.toBe('undefined')
    const el = document.createElement('div')
    expect(el.tagName).toBe('DIV')
  })
})
