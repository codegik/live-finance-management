import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

/**
 * ./deploy.sh (staging) and ./promote.sh (production) ship only when the test
 * suite passes. Checked by running the real scripts in a throwaway repo, with `fly`, `curl` and
 * ./test.sh replaced by stubs: `fly` records every call, so "nothing was
 * deployed" is observed, not inferred from reading the script.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sandboxes: string[] = []

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function executable(path: string, body: string) {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(path, 0o755)
}

function runScript(
  script: 'deploy.sh' | 'promote.sh',
  { testsExit, answer = '' }: { testsExit: number; answer?: string },
) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-gate-'))
  sandboxes.push(dir)
  const bin = join(dir, 'bin')
  const flyLog = join(dir, 'fly-calls.log')
  mkdirSync(bin)
  mkdirSync(join(dir, 'repo', 'fly'), { recursive: true })
  const repo = join(dir, 'repo')

  copyFileSync(join(root, script), join(repo, script))
  executable(join(repo, 'test.sh'), `echo "stub suite ran"\nexit ${testsExit}`)
  writeFileSync(join(repo, 'fly', 'reconcile.lib.sh'), 'ensure_reconcile_machine() { :; }\n')
  executable(join(bin, 'fly'), `echo "$*" >> "${flyLog}"`)
  executable(join(bin, 'jq'), ':')
  executable(join(bin, 'curl'), 'printf 200')
  // The script refuses a dirty tree, so the sandbox is a clean commit. The
  // call log lives outside the repo so writing it cannot dirty anything.
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo })
  git('init', '-q')
  git('add', '.')
  git('commit', '-qm', 'release candidate')

  const run = spawnSync('bash', [script], {
    cwd: repo,
    input: answer,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    flyCalls: existsSync(flyLog) ? readFileSync(flyLog, 'utf8') : '',
  }
}

it('stops before the prompt and deploys nothing when the tests fail', () => {
  const run = runScript('promote.sh', { testsExit: 1, answer: 'y\n' })
  expect(run.stdout).toContain('stub suite ran')
  expect(run.status).not.toBe(0)
  expect(run.stderr).toContain('tests failed')
  // Never asked, even though the answer would have been yes.
  expect(run.stdout).not.toContain('Proceed to production?')
  expect(run.flyCalls).toBe('')
})

it('runs the tests before asking, and still honours a "no" after they pass', () => {
  const run = runScript('promote.sh', { testsExit: 0, answer: 'n\n' })
  expect(run.stdout.indexOf('stub suite ran')).toBeGreaterThanOrEqual(0)
  expect(run.stdout.indexOf('stub suite ran')).toBeLessThan(run.stdout.indexOf('About to PROMOTE'))
  expect(run.stdout).toContain('Aborted.')
  expect(run.status).not.toBe(0)
  expect(run.flyCalls).toBe('')
})

it('deploys to production once the tests pass and the promotion is confirmed', () => {
  const run = runScript('promote.sh', { testsExit: 0, answer: 'y\n' })
  expect(run.status, run.stderr).toBe(0)
  expect(run.flyCalls).toContain('deploy . -c fly/web.toml')
})

it('deploys nothing to staging when the tests fail', () => {
  const run = runScript('deploy.sh', { testsExit: 1 })
  expect(run.stdout).toContain('stub suite ran')
  expect(run.status).not.toBe(0)
  expect(run.stderr).toContain('tests failed')
  expect(run.flyCalls).toBe('')
})

it('deploys to staging once the tests pass', () => {
  const run = runScript('deploy.sh', { testsExit: 0 })
  expect(run.status, run.stderr).toBe(0)
  expect(run.stdout.indexOf('stub suite ran')).toBeLessThan(run.stdout.indexOf('Web → '))
  expect(run.flyCalls).toContain('deploy . -c fly/web.staging.toml')
})
