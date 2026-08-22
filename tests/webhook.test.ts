import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { POST } from '@/app/api/webhooks/pluggy/route'
import { hashPassword } from '@/lib/auth/password'
import { createHousehold } from '@/lib/db/households'
import { listTransactions } from '@/lib/db/transactions'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(async () => {
  useTestEnv()
  await resetDb()
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
