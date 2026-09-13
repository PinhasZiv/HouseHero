import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Supabase SQL Editor truncates a pasted query at exactly 20,000
// characters, and says nothing about it. What you get instead is a parse error
// from wherever the cut landed - typically "unterminated dollar-quoted string",
// pointing at a line that is perfectly correct.
//
// This test is here because that failure is invisible from the code: the file
// is valid SQL, the tests pass, and it only breaks in someone else's browser
// during setup. So the length is asserted rather than trusted. Every migration
// file is checked, not just the first one - migrate.yml applies each one
// separately, and each is also meant to be pasted into the SQL Editor by hand
// on its own, so each has to fit alone. This is also why the schema is split
// across three files (0001/0002/0003) rather than one: HouseHero's schema
// (tasks with two recurrence modes and three end conditions, plus rewards and
// redemptions) does not fit in one file under this budget.

const HARD_LIMIT = 20_000
const BUDGET = 19_000

const here = import.meta.dirname ?? __dirname
const sqlFiles = readdirSync(here).filter((name) => name.endsWith('.sql')).sort()
const initMigration = readFileSync(join(here, '0001_init.sql'), 'utf8')
const config = readFileSync(join(here, '..', '..', 'src', 'config.ts'), 'utf8')

describe.each(sqlFiles)('%s fits in the Supabase SQL editor', (name) => {
  const contents = readFileSync(join(here, name), 'utf8')

  it(`is under ${BUDGET.toLocaleString()} characters`, () => {
    const headroom = BUDGET - contents.length
    expect(
      contents.length,
      `${name} is ${contents.length.toLocaleString()} characters, ` +
        `${(-headroom).toLocaleString()} over the ${BUDGET.toLocaleString()} budget. ` +
        `Supabase silently truncates a pasted query at ${HARD_LIMIT.toLocaleString()} ` +
        `characters, so this has to come down - trim comments, or split the ` +
        `script further and update SETUP.md to say so.`,
    ).toBeLessThan(BUDGET)
  })

  it('measures characters, not bytes - the limit counts characters', () => {
    // Hebrew comments are two bytes per character in UTF-8, so a byte count
    // would understate the headroom, not overstate it.
    expect(Buffer.byteLength(contents, 'utf8')).toBeGreaterThanOrEqual(contents.length)
  })
})

describe('required migration files are present in order', () => {
  it('has exactly the four parts, in filename order', () => {
    expect(sqlFiles).toEqual([
      '0001_init.sql',
      '0002_tasks.sql',
      '0003_rewards.sql',
      '0004_shared_completions.sql',
    ])
  })
})

describe('0001_init.sql - the one-time setup values', () => {
  it('never carries a real project ref or VAPID key - only the placeholders', () => {
    // This is the file both a person pastes into the Supabase SQL Editor by
    // hand AND the one .github/workflows/migrate.yml runs automatically
    // against the live database. The repo is public, so committing a real
    // value here - even once, even reverted in a later commit - leaks it into
    // git history permanently. The automated workflow injects the real values
    // from repository secrets into a scratch copy at run time; the file
    // itself must never see them.
    const message =
      'This file must only ever contain PASTE_PROJECT_REF_HERE and ' +
      'PASTE_VAPID_PRIVATE_KEY_HERE as literal text - never a real value. ' +
      'The repo is public: a committed secret leaks into git history ' +
      'permanently, even after being reverted. Real values belong only in ' +
      'GitHub repository secrets (SUPABASE_PROJECT_REF, VAPID_PRIVATE_KEY), ' +
      'which .github/workflows/migrate.yml substitutes at run time. If a ' +
      'real value was committed, rotate it - reverting the file is not ' +
      'enough.'
    expect(initMigration, message).toContain('PASTE_PROJECT_REF_HERE')
    expect(initMigration, message).toContain('PASTE_VAPID_PRIVATE_KEY_HERE')
  })

  it('keeps the guard that catches an unfilled placeholder', () => {
    expect(initMigration).toContain("like 'PASTE_%'")
  })

  it('holds the same VAPID public key the app subscribes with', () => {
    // The two halves of the VAPID key pair live apart: the public half is
    // committed twice - here, and in src/config.ts, which is what the browser
    // subscribes with - while the private half only ever reaches the database
    // from a repository secret. Nothing at run time compares them, and a
    // mismatch does not fail anywhere visible: the push service simply
    // rejects every notification, because the JWT is signed by one key and
    // advertises another. So the two committed copies are compared here
    // instead.
    const inConfig = config.match(/'(B[A-Za-z0-9_-]{80,})'/)?.[1]
    const inMigration = initMigration.match(/'(B[A-Za-z0-9_-]{80,})'/)?.[1]
    expect(inConfig, 'no VAPID public key found in src/config.ts').toBeTruthy()
    expect(inMigration, 'no VAPID public key found in 0001_init.sql').toBeTruthy()
    expect(
      inMigration,
      'The VAPID public key in supabase/migrations/0001_init.sql does not ' +
        'match the one in src/config.ts. Both copies must be the public half ' +
        'of the same key pair - and of the pair whose private half is in the ' +
        'VAPID_PRIVATE_KEY repository secret - or every push notification is ' +
        'rejected. Rotating a key means changing all three together.',
    ).toBe(inConfig)
  })

  it('updates both halves of the key pair together on a re-run', () => {
    // "on conflict do update" is the path taken on every run after the first,
    // which is the only path a rotation ever takes. Leaving the public key out
    // of that list is silent: a fresh database is fine, an existing one keeps
    // the old public key next to the new private one.
    const clause = initMigration.slice(initMigration.indexOf('on conflict (id) do update set'))
    expect(
      clause,
      'The app_config upsert must set vapid_public_key in its "on conflict ' +
        'do update" list. Without it, a key rotation only reaches an existing ' +
        'database halfway and every notification is rejected.',
    ).toMatch(/vapid_public_key\s*=\s*excluded\.vapid_public_key/)
  })
})
