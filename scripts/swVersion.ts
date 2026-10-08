import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

// The service worker keeps one cache, and drops every other one when a new
// version activates. With a fixed cache name nothing was ever dropped: each
// deploy's hashed bundles piled up next to the last one's. This stamps the
// cache name with a hash of the build's own output, so a deploy changes
// sw.js (which is what makes the browser install the new worker at all) and
// the old cache goes with the old version.

export const CACHE_PLACEHOLDER = "'househero-v1'"

/** A short, stable hash of the build's output file names - which themselves
 *  carry content hashes, so any change to the app changes this. */
export function buildVersion(fileNames: string[]): string {
  return createHash('sha256').update([...fileNames].sort().join('\n')).digest('hex').slice(0, 10)
}

export function stampCacheName(source: string, version: string): string {
  if (!source.includes(CACHE_PLACEHOLDER)) throw new Error(`sw.js no longer contains ${CACHE_PLACEHOLDER}`)
  return source.replace(CACHE_PLACEHOLDER, `'househero-${version}'`)
}

export function swVersionPlugin(): Plugin {
  let outDir = 'dist'
  let fileNames: string[] = []
  return {
    name: 'househero-sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    generateBundle(_options, bundle) {
      fileNames = Object.keys(bundle)
    },
    // Last, so the public folder (where sw.js comes from) is already copied.
    closeBundle() {
      const path = join(outDir, 'sw.js')
      writeFileSync(path, stampCacheName(readFileSync(path, 'utf8'), buildVersion(fileNames)))
    },
  }
}
