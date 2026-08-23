import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import type { AlertCrossing } from '@/lib/domain/alerts'
import { renderAlertEmail } from '@/lib/email/render'
import { createMailer } from '@/lib/email/resend'

type SentMail = { from: string; to: string[]; subject: string; text: string }

const sent: SentMail[] = []
let failWith: number | null = null

const server = setupServer(
  http.post('https://api.resend.com/emails', async ({ request }) => {
    if (failWith) return new HttpResponse('rate limited', { status: failWith })
    if (request.headers.get('authorization') !== 'Bearer re_test_key') {
      return new HttpResponse('unauthorized', { status: 401 })
    }
    sent.push((await request.json()) as SentMail)
    return HttpResponse.json({ id: 'msg-1' })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  sent.length = 0
  failWith = null
})
afterAll(() => server.close())

function crossing(over: Partial<AlertCrossing> = {}): AlertCrossing {
  return {
    categoryId: 'cat-1',
    categoryName: 'Supermercado',
    threshold: 100,
    spentCents: 124_000,
    budgetCents: 120_000,
    ...over,
  }
}

it('names the category in the subject when one category crossed', () => {
  const { subject, text } = renderAlertEmail([crossing()], '2026-08')

  expect(subject).toBe('Supermercado is at 100% of its budget')
  expect(text).toContain('August 2026')
  // pt-BR currency formatting puts a NON-BREAKING space (U+00A0) after R$.
  // Spelling it explicitly is what stops this asserting against correct code.
  expect(text).toContain('Supermercado — R$\u00a01.240,00 of R$\u00a01.200,00 (103%)')
})

it('still names the category when it crossed both thresholds at once', () => {
  // Two crossings, one category: "2 categories" would be a lie.
  const { subject } = renderAlertEmail(
    [crossing(), crossing({ threshold: 80 })],
    '2026-08',
  )

  expect(subject).toBe('Supermercado is at 100% of its budget')
})

it('counts distinct categories when several crossed', () => {
  const { subject, text } = renderAlertEmail(
    [crossing(), crossing({ categoryId: 'cat-2', categoryName: 'Restaurantes', threshold: 80 })],
    '2026-08',
  )

  expect(subject).toBe('2 categories crossed a budget threshold')
  expect(text).toContain('Supermercado')
  expect(text).toContain('Restaurantes')
})

it('rounds the reported percentage down, so 99.9% never reads as 100%', () => {
  const { text } = renderAlertEmail(
    [crossing({ threshold: 80, spentCents: 119_999, budgetCents: 120_000 })],
    '2026-08',
  )

  expect(text).toContain('(99%)')
})

it('posts the message to Resend', async () => {
  const mailer = createMailer({ apiKey: 're_test_key', from: 'alerts@example.com' })

  await mailer.send({ to: ['a@example.com', 'b@example.com'], subject: 'Hi', text: 'Body' })

  expect(sent).toEqual([
    {
      from: 'alerts@example.com',
      to: ['a@example.com', 'b@example.com'],
      subject: 'Hi',
      text: 'Body',
    },
  ])
})

it('throws when Resend rejects the message, so the caller can leave it armed', async () => {
  failWith = 500
  const mailer = createMailer({ apiKey: 're_test_key', from: 'alerts@example.com' })

  await expect(
    mailer.send({ to: ['a@example.com'], subject: 'Hi', text: 'Body' }),
  ).rejects.toThrow(/RESEND_FAILED:500/)
})

it('sends nothing at all when there is no recipient', async () => {
  const mailer = createMailer({ apiKey: 're_test_key', from: 'alerts@example.com' })

  await mailer.send({ to: [], subject: 'Hi', text: 'Body' })

  expect(sent).toEqual([])
})
