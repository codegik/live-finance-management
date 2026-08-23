import { eq } from 'drizzle-orm'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, it } from 'vitest'
import { POST } from '@/app/api/webhooks/pluggy/route'
import { hashPassword } from '@/lib/auth/password'
import { setBudget } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { accounts, connections, transactions } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { saoPauloPeriod, saoPauloToday } from '@/lib/domain/dates'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'
import { insertTransaction } from './helpers/transactions'

const sentMail: { subject: string; to: string[] }[] = []

const server = startPluggyServer([
  http.post('https://api.resend.com/emails', async ({ request }) => {
    sentMail.push((await request.json()) as { subject: string; to: string[] })
    return HttpResponse.json({ id: 'msg-1' })
  }),
])

beforeEach(async () => {
  useTestEnv()
  await resetDb()
  sentMail.length = 0
})

async function seedConnection() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const pluggy = createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
  await attachConnection(db, pluggy, {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })
  return { db, householdId }
}

function webhookRequest(token: string, body: unknown) {
  return new Request(`https://app.test/api/webhooks/pluggy?token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

it('syncs the item on a valid webhook', async () => {
  const { db, householdId } = await seedConnection()

  const response = await POST(
    webhookRequest('webhook-token-value-1234', {
      event: 'item/updated',
      itemId: 'item-nubank-1',
    }),
  )

  expect(response.status).toBe(200)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
})

it('rejects a webhook with a wrong token and syncs nothing', async () => {
  const { db, householdId } = await seedConnection()

  const response = await POST(
    webhookRequest('wrong-token', { event: 'item/updated', itemId: 'item-nubank-1' }),
  )

  expect(response.status).toBe(401)
  expect(await listTransactions(db, householdId)).toHaveLength(0)
})

it('acknowledges an unknown item without failing', async () => {
  await seedConnection()

  const response = await POST(
    webhookRequest('webhook-token-value-1234', {
      event: 'item/updated',
      itemId: 'item-not-ours',
    }),
  )

  expect(response.status).toBe(202)
})

it('rejects a malformed body', async () => {
  await seedConnection()

  const response = await POST(webhookRequest('webhook-token-value-1234', { nope: true }))

  expect(response.status).toBe(400)
})

it('mails the household when the synced item crosses a budget threshold', async () => {
  const { db, householdId } = await seedConnection()
  const now = new Date()
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(eq(connections.householdId, householdId))
    .limit(1)
  const supermarket = (await listCategories(db, householdId)).find(
    (c) => c.name === 'Supermercado',
  )!
  // Seeded into today's month, and MANUAL so the sync's recategorize pass
  // leaves it alone.
  const txId = await insertTransaction(db, account.id, {
    description: 'ZAFFARI',
    amountCents: 90_000,
    date: saoPauloToday(now),
  })
  await db
    .update(transactions)
    .set({ categoryId: supermarket.id, categorySource: 'MANUAL' })
    .where(eq(transactions.id, txId))
  await setBudget(db, householdId, {
    categoryId: supermarket.id,
    period: saoPauloPeriod(now),
    amountCents: 100_000,
  })

  const response = await POST(
    webhookRequest('webhook-token-value-1234', {
      event: 'item/updated',
      itemId: 'item-nubank-1',
    }),
  )

  expect(response.status).toBe(200)
  expect(sentMail).toHaveLength(1)
  // Not an exact subject: the fixture's own transactions may add spend to the
  // same category and turn an 80% crossing into a 100% one. What is being
  // proved here is the wiring, not the wording.
  expect(sentMail[0].subject).toContain('Supermercado')
  expect(sentMail[0].to).toEqual(['inacio@example.com'])
})

it('still returns 200 and lands the sync when Resend is down', async () => {
  // lib/sync/dispatch.ts wraps evaluateAndNotify in a try/catch. Without it,
  // a Resend outage would 500 this webhook and Pluggy would retry the whole
  // sync over a mail that was never the point. startPluggyServer's own
  // afterEach(() => server.resetHandlers()) cleans up this override.
  const { db, householdId } = await seedConnection()
  const now = new Date()
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(eq(connections.householdId, householdId))
    .limit(1)
  const supermarket = (await listCategories(db, householdId)).find(
    (c) => c.name === 'Supermercado',
  )!
  const txId = await insertTransaction(db, account.id, {
    description: 'ZAFFARI',
    amountCents: 90_000,
    date: saoPauloToday(now),
  })
  await db
    .update(transactions)
    .set({ categoryId: supermarket.id, categorySource: 'MANUAL' })
    .where(eq(transactions.id, txId))
  await setBudget(db, householdId, {
    categoryId: supermarket.id,
    period: saoPauloPeriod(now),
    amountCents: 100_000,
  })
  server.use(
    http.post('https://api.resend.com/emails', () => new HttpResponse(null, { status: 500 })),
  )

  const response = await POST(
    webhookRequest('webhook-token-value-1234', {
      event: 'item/updated',
      itemId: 'item-nubank-1',
    }),
  )

  expect(response.status).toBe(200)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
})
