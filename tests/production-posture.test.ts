import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { localAutoLogin } from '@/lib/demo/autologin'
import { assertLocalDatabase } from '@/lib/demo/seed'

/**
 * The local-development conveniences, checked from the outside.
 *
 * Two of them would be serious in production: ./seed.sh creates an account
 * with a password published in this repository, and LOCAL_AUTOLOGIN signs a
 * visitor in without one. Both are gated in code and both are tested there --
 * this file is about the layers around that code, which no unit test sees:
 * what ships in the image, and what a committed example file switches on.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

it('keeps the seeding and demo entry points out of the production image', () => {
  const ignored = read('.dockerignore')
    .split('\n')
    .map((line) => line.trim())

  // seed.ts creates owner@localhost with a password that is public in seed.sh.
  expect(ignored).toContain('seed.sh')
  expect(ignored).toContain('seed.ts')
  // demo.ts writes invented salaries and invented spending.
  expect(ignored).toContain('demo.ts')
})

it('never runs the test suite while building the image', () => {
  // The suite runs once, in ./deploy.sh and ./promote.sh, before `fly deploy`
  // is ever called. Running it again inside the build would need Docker inside
  // Docker for its Postgres, and would slow every deploy for no new signal.
  const steps = read('Dockerfile')
    .split('\n')
    .filter((line) => /^\s*(RUN|CMD|ENTRYPOINT)\b/.test(line) || /^\s+\S/.test(line))
    .join('\n')
  expect(steps).not.toMatch(/vitest|test\.sh|pnpm (run )?test\b|npm (run )?test\b/)

  // Nor through a lifecycle hook the build's `pnpm install` / `pnpm build`
  // would trigger on its own.
  const scripts: Record<string, string> = JSON.parse(read('package.json')).scripts
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prebuild', 'build', 'postbuild']) {
    expect(scripts[hook] ?? '', hook).not.toMatch(/vitest|test\.sh|\btest\b/)
  }
})

it('keeps the tests and the delivery scripts that run them out of the image', () => {
  const ignored = read('.dockerignore')
    .split('\n')
    .map((line) => line.trim())

  expect(ignored).toContain('tests')
  expect(ignored).toContain('test.sh')
  expect(ignored).toContain('deploy.sh')
  expect(ignored).toContain('promote.sh')
})

it('never ships an example env file that switches auto-login on', () => {
  const example = read('.env.example')

  // Present as documentation is fine; enabled is not. .env.example is
  // committed, so anything live in it is live for anyone who copies it.
  for (const line of example.split('\n')) {
    expect(line.trim().startsWith('LOCAL_AUTOLOGIN=')).toBe(false)
  }
})

it('builds the runtime image with NODE_ENV=production', () => {
  // The first of the two independent gates. Losing it would leave only the
  // database-host check standing.
  expect(read('Dockerfile')).toMatch(/ENV NODE_ENV=production/)
})

it('deploys without ever invoking a seeding command', () => {
  // Everything that runs on a Fly deploy: the scripts, the app configs (whose
  // release_command runs before traffic), and the reconcile machine setup.
  for (const file of [
    'deploy.sh',
    'promote.sh',
    'fly/web.toml',
    'fly/web.staging.toml',
    'fly/reconcile.lib.sh',
  ]) {
    const content = read(file)
    expect(content, file).not.toMatch(/seed/i)
    expect(content, file).not.toMatch(/demo/i)
  }
})

/**
 * Belt and braces on the two gates themselves: each must be sufficient alone,
 * so losing one to a misconfigured deploy still leaves the other.
 */
it('shuts auto-login off on NODE_ENV alone, even with a local database', () => {
  expect(
    localAutoLogin({
      NODE_ENV: 'production',
      LOCAL_AUTOLOGIN: 'true',
      DATABASE_URL: 'postgres://u:p@localhost:5432/finance',
    }),
  ).toBeNull()
})

it('shuts auto-login off on the database host alone, even with NODE_ENV unset', () => {
  // The deploy that forgets NODE_ENV is exactly the deploy that would other-
  // wise be wide open.
  expect(
    localAutoLogin({
      LOCAL_AUTOLOGIN: 'true',
      DATABASE_URL: 'postgres://u:p@db.railway.internal:5432/finance',
    }),
  ).toBeNull()
})

it('refuses to generate demo data against a deployed database on either gate', () => {
  expect(() =>
    assertLocalDatabase('postgres://u:p@db.railway.internal:5432/finance', 'development'),
  ).toThrow(/DEMO_REFUSED/)
  expect(() =>
    assertLocalDatabase('postgres://u:p@localhost:5432/finance', 'production'),
  ).toThrow(/DEMO_REFUSED/)
})
