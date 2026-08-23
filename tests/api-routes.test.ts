import { beforeEach, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/auth/config'

// The three session-guarded routes are exercised as real handlers here. Only
// the session lookup is faked -- requireSession() reads a JWT cookie that no
// integration test can mint -- so everything downstream (zod, drizzle,
// Pluggy over MSW, the guard's 401 mapping) is the production code path.
const state = vi.hoisted(() => ({ session: null as SessionUser | null }))

vi.mock('@/lib/auth/session', () => ({
  requireSession: async () => {
    if (!state.session) throw new Error('UNAUTHENTICATED')
    return state.session
  },
}))

import { POST as connectionsPost } from '@/app/api/connections/route'
import { POST as invitesPost } from '@/app/api/household/invites/route'
import { POST as connectTokenPost } from '@/app/api/pluggy/connect-token/route'
import { hashPassword } from '@/lib/auth/password'
import { listConnections } from '@/lib/db/connections'
import { createHousehold } from '@/lib/db/households'
import { connections } from '@/lib/db/schema'
import { getLedgerView } from '@/lib/views/ledger'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { startPluggyServer } from './helpers/pluggy-server'

const server = startPluggyServer()

beforeEach(async () => {
  useTestEnv()
  state.session = null
  await resetDb()
})

async function signedIn(name = 'Klassmann', email = 'inacio@example.com') {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name,
    owner: { email, name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  state.session = { id: userId, email, name: 'Inacio', householdId }
  return { db, householdId, userId }
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// --- 401s: a logged-out caller is not a server error -------------------------

it('answers an unauthenticated POST /api/connections with 401, not 500', async () => {
  const response = await connectionsPost(
    jsonRequest('https://app.test/api/connections', { itemId: 'item-nubank-1' }),
  )

  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' })
})

it('answers an unauthenticated POST /api/pluggy/connect-token with 401, not 500', async () => {
  const response = await connectTokenPost(
    jsonRequest('https://app.test/api/pluggy/connect-token', {}),
  )

  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' })
})

it('answers an unauthenticated POST /api/household/invites with 401, not 500', async () => {
  const response = await invitesPost(
    jsonRequest('https://app.test/api/household/invites', {
      email: 'wife@example.com',
      name: 'Wife',
    }),
  )

  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' })
})

// --- the happy paths, through the real handlers ------------------------------

it('mints a connect token for a signed-in caller', async () => {
  await signedIn()

  const response = await connectTokenPost(
    jsonRequest('https://app.test/api/pluggy/connect-token', {}),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ accessToken: 'connect-token-abc' })
})

it('mints an update-mode token for an item in the caller session household', async () => {
  const { db, householdId, userId } = await signedIn()
  await db.insert(connections).values({
    householdId,
    ownerUserId: userId,
    pluggyItemId: 'item-nubank-1',
    institution: 'Nubank',
    status: 'LOGIN_ERROR',
  })

  const response = await connectTokenPost(
    jsonRequest('https://app.test/api/pluggy/connect-token', { itemId: 'item-nubank-1' }),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ accessToken: 'connect-token-abc' })
})

it('refuses an update-mode token for another household item', async () => {
  // Without this the item id is the only thing standing between a signed-in
  // user and a token that reopens someone else's bank connection.
  const { db } = await signedIn()
  const other = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  await db.insert(connections).values({
    householdId: other.householdId,
    ownerUserId: other.userId,
    pluggyItemId: 'item-theirs-1',
    institution: 'Itau',
    status: 'UPDATED',
  })

  const response = await connectTokenPost(
    jsonRequest('https://app.test/api/pluggy/connect-token', { itemId: 'item-theirs-1' }),
  )

  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'UNKNOWN_CONNECTION' })
})

it('still mints a plain token when no item is named', async () => {
  await signedIn()

  const response = await connectTokenPost(
    jsonRequest('https://app.test/api/pluggy/connect-token', {}),
  )

  expect(response.status).toBe(200)
})

it('creates an invite for the caller household', async () => {
  const { db, householdId } = await signedIn()

  const response = await invitesPost(
    jsonRequest('https://app.test/api/household/invites', {
      email: 'wife@example.com',
      name: 'Wife',
    }),
  )
  const body = await response.json()

  expect(response.status).toBe(201)
  expect(body.inviteUrl).toMatch(/^\/join\/.+/)

  const { householdInvites } = await import('@/lib/db/schema')
  const [invite] = await db.select().from(householdInvites)
  expect(invite.householdId).toBe(householdId)
})

it('rejects a malformed invite body', async () => {
  await signedIn()

  const response = await invitesPost(
    jsonRequest('https://app.test/api/household/invites', { email: 'not-an-email' }),
  )

  expect(response.status).toBe(400)
})

it('rejects a malformed connections body', async () => {
  await signedIn()

  const response = await connectionsPost(jsonRequest('https://app.test/api/connections', {}))

  expect(response.status).toBe(400)
})

// --- I2: connecting a card must leave the ledger current ---------------------

it('leaves the ledger populated right after POST /api/connections', async () => {
  const { db, householdId } = await signedIn()

  const response = await connectionsPost(
    jsonRequest('https://app.test/api/connections', { itemId: 'item-nubank-1' }),
  )
  const body = await response.json()

  expect(response.status).toBe(201)

  // Attaching without syncing left the user looking at an empty ledger and a
  // stale banner until a webhook or the 03:00 cron fired -- up to ~24 hours.
  const view = await getLedgerView(db, householdId)
  expect(view.days).not.toHaveLength(0)
  expect(view.health.allFresh).toBe(true)
  expect(body.synced).toBe(true)
})

it('still keeps the connection when the first sync fails, and says so', async () => {
  const { db, householdId } = await signedIn()

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/v2/transactions', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  )

  const response = await connectionsPost(
    jsonRequest('https://app.test/api/connections', { itemId: 'item-nubank-1' }),
  )
  const body = await response.json()

  // The connection row is worth keeping -- reconcileAll will pick it up -- so
  // a failed first sync must not fail the connect. It must not be silent
  // either: the response says synced:false and the ledger reports itself
  // stale rather than showing a healthy-looking empty list.
  expect(response.status).toBe(201)
  expect(body.synced).toBe(false)
  expect(await listConnections(db, householdId)).toHaveLength(1)

  const view = await getLedgerView(db, householdId)
  expect(view.health.allFresh).toBe(false)
})

// --- I1 at the route boundary ------------------------------------------------

it('answers 409 when the posted itemId belongs to another household', async () => {
  const { db, householdId: ownerHousehold } = await signedIn('Klassmann', 'inacio@example.com')
  await connectionsPost(
    jsonRequest('https://app.test/api/connections', { itemId: 'item-nubank-1' }),
  )

  const other = await createHousehold(db, {
    name: 'Other',
    owner: { email: 'other@example.com', name: 'Other', passwordHash: await hashPassword('pw') },
  })
  state.session = {
    id: other.userId,
    email: 'other@example.com',
    name: 'Other',
    householdId: other.householdId,
  }

  const response = await connectionsPost(
    jsonRequest('https://app.test/api/connections', { itemId: 'item-nubank-1' }),
  )

  expect(response.status).toBe(409)
  expect(await listConnections(db, other.householdId)).toHaveLength(0)
  expect(await listConnections(db, ownerHousehold)).toHaveLength(1)
})
