import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'

/**
 * What this covers, and what it honestly does not.
 *
 * Both settings screens shipped with every form written as
 * `<form action={someAction as unknown as (formData: FormData) => void}>`.
 * React calls a bare form action with FormData as its ONLY argument, so a
 * `(prevState, formData)` action ran with prevState = FormData and
 * formData = undefined and threw a TypeError on the first `formData.get(...)`.
 * Every submit on both screens crashed, and every SettingsState the actions
 * returned was discarded because nothing rendered it.
 *
 * Calling the actions directly -- which is what the rest of this suite does,
 * and which is correct for testing their behaviour -- structurally cannot see
 * that: the tests pass the two arguments the action declares. The defect lived
 * in the wiring between the page and the action, and only there.
 *
 * A full render would not catch it either: a bad `<form action>` renders fine
 * and only fails on submit, which needs a browser this suite does not have.
 * So this checks the wiring itself, at the source level: the actions keep the
 * `(prev, formData)` signature, the pages hand no action to a form directly,
 * and the forms live in 'use client' modules that route them through
 * useActionState and render the state back. It is a structural check, not a
 * behavioural one, and it would fail the moment the cast came back.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

const PAGES = [
  'app/(app)/settings/categories/page.tsx',
  'app/(app)/settings/rules/page.tsx',
]

const CLIENT_FORMS: { path: string; actions: string[] }[] = [
  {
    path: 'app/(app)/settings/categories/CategoryForms.tsx',
    actions: ['createCategoryAction', 'renameCategoryAction', 'archiveCategoryAction'],
  },
  {
    path: 'app/(app)/settings/rules/RuleForms.tsx',
    actions: ['createRuleAction', 'deleteRuleAction'],
  },
]

it.each(PAGES)('%s hands no action straight to a bare form', (page) => {
  const source = read(page)

  // The cast that silenced the type error which was correctly reporting the
  // bug. Its absence is the point.
  expect(source).not.toContain('as unknown as')
  expect(source).not.toMatch(/formData: FormData\) => void/)
  // A server component must not render a <form action={...}> at all here:
  // every form on these screens takes a (prev, formData) action.
  expect(source).not.toMatch(/<form\b/)
})

it.each(CLIENT_FORMS.map((f) => f.path))('%s is a client module', (path) => {
  const source = read(path)
  const firstStatement = source.split('\n').find((line) => line.trim() !== '')

  expect(firstStatement?.trim()).toBe("'use client'")
  expect(source).toContain("from 'react'")
  expect(source).toContain('useActionState')
})

it.each(CLIENT_FORMS)('$path routes every action through useActionState', ({ path, actions }) => {
  const source = read(path)

  for (const action of actions) {
    expect(source).toContain(`useActionState(${action},`)
    // and never as a bare form action
    expect(source).not.toContain(`action={${action}}`)
  }

  // The error and the "N transactions recategorized" message are rendered,
  // not computed and thrown away.
  expect(source).toContain('state.error')
  expect(source).toContain('state.message')
})

it.each(CLIENT_FORMS.map((f) => f.path))('%s is the form source for its page', (path) => {
  const page = PAGES.find((p) => dirname(p) === dirname(path))!
  const componentModule = `./${path.split('/').pop()!.replace(/\.tsx$/, '')}`

  expect(read(page)).toContain(`from '${componentModule}'`)
})

it('keeps the (prevState, formData) signature the client forms depend on', async () => {
  vi.mock('@/lib/auth/session', () => ({
    requireSession: async () => ({ householdId: '', userId: '' }),
    toSignInOrThrow: () => {
      throw new Error('UNAUTHENTICATED')
    },
  }))
  vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

  const categories = await import('@/app/(app)/settings/categories/actions')
  const rules = await import('@/app/(app)/settings/rules/actions')
  const everyAction = [
    categories.createCategoryAction,
    categories.renameCategoryAction,
    categories.archiveCategoryAction,
    rules.createRuleAction,
    rules.deleteRuleAction,
  ]

  // Two declared parameters is what makes a bare <form action> wrong: React
  // would supply only the first.
  for (const action of everyAction) expect(action).toHaveLength(2)
})
