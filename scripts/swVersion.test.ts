import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CACHE_PLACEHOLDER, buildVersion, stampCacheName } from './swVersion'

const here = import.meta.dirname ?? __dirname

describe('service worker cache versioning', () => {
  it('the source still carries the placeholder the build replaces', () => {
    expect(readFileSync(join(here, '..', 'public', 'sw.js'), 'utf8')).toContain(`const CACHE = ${CACHE_PLACEHOLDER}`)
  })

  it('changes whenever any output file changes, regardless of order', () => {
    const a = buildVersion(['assets/index-aaa.js', 'assets/react-bbb.js'])
    expect(buildVersion(['assets/react-bbb.js', 'assets/index-aaa.js'])).toBe(a)
    expect(buildVersion(['assets/index-ccc.js', 'assets/react-bbb.js'])).not.toBe(a)
  })

  it('stamps the cache name, and refuses if the placeholder is gone', () => {
    expect(stampCacheName("const CACHE = 'househero-v1'", 'abc')).toBe("const CACHE = 'househero-abc'")
    expect(() => stampCacheName("const CACHE = 'other'", 'abc')).toThrow()
  })
})
