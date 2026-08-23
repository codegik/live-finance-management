import { eq, sql as raw } from 'drizzle-orm'
import { beforeEach, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/reconcile/route'
import * as alertsEvaluate from '@/lib/alerts/evaluate'
import { hashPassword } from '@/lib/auth/password'
import { setBudget } from '@/lib/db/budgets'
import { listCategories } from '@/lib/db/categories'
import { createHousehold } from '@/lib/db/households'
import { connections, transactions } from '@/lib/db/schema'
import { listTransactions } from '@/lib/db/transactions'
import { saoPauloPeriod, saoPauloToday } from '@/lib/domain/dates'
import { SEED_CATEGORIES } from '@/lib/domain/seed-categories'
import { createPluggyClient } from '@/lib/pluggy/client'
import { attachConnection } from '@/lib/sync/connect'
import { reconcileAll } from '@/lib/sync/reconcile'
import { getInboxView } from '@/lib/views/inbox'
import { resetDb, testDb, useTestEnv } from './helpers/db'
import { createRecordingMailer } from './helpers/mailer'
import { startPluggyServer } from './helpers/pluggy-server'
import { insertTransaction, seedAccount } from './helpers/transactions'

// Spied rather than stubbed: the real evaluateAndNotify still runs (this
// stays an integration test), but the spy lets tests below assert HOW MANY
// TIMES it was called -- something the mail count alone cannot prove, since
// evaluateAndNotify is idempotent per (householdId, categoryId, threshold,
// period). If a future edit moved the alert call into the per-connection
// loop, the second connection's call would just no-op against the
// already-fired threshold: `sent` would still have length 1 and a
// mail-count-only assertion would not catch the regression.
vi.mock('@/lib/alerts/evaluate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/alerts/evaluate')>()
  return {
    ...actual,
    evaluateAndNotify: vi.fn(actual.evaluateAndNotify),
  }
})

const server = startPluggyServer()

beforeEach(async () => {
  useTestEnv()
  await resetDb()
  vi.mocked(alertsEvaluate.evaluateAndNotify).mockClear()
})

function pluggy() {
  return createPluggyClient({
    apiUrl: 'https://api.pluggy.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  })
}

/** For the cases that are not about alerts and simply must compile. */
function noopMailer() {
  return createRecordingMailer().mailer
}

async function seed() {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  const { connectionId } = await attachConnection(db, pluggy(), {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })
  return { db, householdId, userId, connectionId }
}

function cronRequest(authorization: string | null) {
  return new Request('https://app.test/api/cron/reconcile', {
    method: 'GET',
    headers: authorization ? { authorization } : {},
  })
}

it('syncs every connection and records when it last succeeded', async () => {
  const { db, householdId } = await seed()

  const result = await reconcileAll(db, pluggy(), { mailer: noopMailer() })

  expect(result.failed).toHaveLength(0)
  expect(result.succeeded).toHaveLength(1)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)

  const [connection] = await db.select().from(connections)
  expect(connection.lastSyncedAt).not.toBeNull()
})

it('keeps reconciling connections that come after a failed one', async () => {
  // The broken connection is created FIRST and the healthy one SECOND, so
  // with reconcileAll's deterministic createdAt ordering the broken one is
  // processed first. This proves the loop keeps going past a failure --
  // a `catch { failed.push(id); break }` regression would leave the
  // healthy connection (which comes after) unsynced.
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  await db.insert(connections).values({
    householdId,
    ownerUserId: userId,
    pluggyItemId: 'item-broken',
    institution: 'Broken Bank',
    status: 'UPDATED',
  })
  await attachConnection(db, pluggy(), {
    householdId,
    ownerUserId: userId,
    itemId: 'item-nubank-1',
  })

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/items/item-broken', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  )

  const result = await reconcileAll(db, pluggy(), { mailer: noopMailer() })

  expect(result.failed).toHaveLength(1)
  expect(result.succeeded).toHaveLength(1)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
})

it('leaves existing data in place when a connection fails', async () => {
  const { db, householdId } = await seed()
  await reconcileAll(db, pluggy(), { mailer: noopMailer() })
  const before = await listTransactions(db, householdId)

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/v2/transactions', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  )
  await reconcileAll(db, pluggy(), { mailer: noopMailer() })

  expect(await listTransactions(db, householdId)).toHaveLength(before.length)
})

it('rejects a cron request with a missing secret and does no work', async () => {
  const { db, householdId } = await seed()

  const response = await GET(cronRequest(null))

  expect(response.status).toBe(401)
  expect(await listTransactions(db, householdId)).toHaveLength(0)
})

it('rejects a cron request with a wrong secret and does no work', async () => {
  const { db, householdId } = await seed()

  const response = await GET(cronRequest('Bearer wrong-secret-value-1234'))

  expect(response.status).toBe(401)
  expect(await listTransactions(db, householdId)).toHaveLength(0)
})

it('runs the real reconcile through the route on a valid secret', async () => {
  const { db, householdId } = await seed()

  const response = await GET(cronRequest('Bearer cron-secret-value-1234'))
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.succeeded).toHaveLength(1)
  expect(body.failed).toHaveLength(0)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
})

it('reports 207 through the route when some connections fail and some succeed', async () => {
  const { db, householdId, userId } = await seed()
  await db.insert(connections).values({
    householdId,
    ownerUserId: userId,
    pluggyItemId: 'item-broken',
    institution: 'Broken Bank',
    status: 'UPDATED',
  })

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/items/item-broken', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  )

  const response = await GET(cronRequest('Bearer cron-secret-value-1234'))
  const body = await response.json()

  // A partial reconcile must never report a clean 200: the run is not healthy,
  // and the household's totals are missing a card.
  expect(response.status).toBe(207)
  expect(body.succeeded).toHaveLength(1)
  expect(body.failed).toHaveLength(1)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
})

it('reports 500 through the route when every connection fails', async () => {
  const db = testDb()
  const { householdId, userId } = await createHousehold(db, {
    name: 'Klassmann',
    owner: { email: 'inacio@example.com', name: 'Inacio', passwordHash: await hashPassword('pw') },
  })
  await db.insert(connections).values({
    householdId,
    ownerUserId: userId,
    pluggyItemId: 'item-broken',
    institution: 'Broken Bank',
    status: 'UPDATED',
  })

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/items/item-broken', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  )

  const response = await GET(cronRequest('Bearer cron-secret-value-1234'))
  const body = await response.json()

  expect(response.status).toBe(500)
  expect(body.succeeded).toHaveLength(0)
  expect(body.failed).toHaveLength(1)
})

it('recategorizes and corrects budget roles for every household after the nightly sync', async () => {
  const { db, householdId, connectionId } = await seed()
  // Every fixture transaction is touched -- and so already recategorized --
  // by its own connection's sync, so a genuinely stale row (the kind an
  // interrupted deploy or a normalizer change would leave behind) has to
  // live somewhere that sync doesn't look: an account Pluggy's mock knows
  // nothing about, standing in for one that has since closed.
  const accountId = await seedAccount(db, connectionId)
  const staleId = await insertTransaction(db, accountId, {
    description: 'ZAFFARI PORTO ALEG *0421',
    pluggyCategory: 'Supermarkets',
  })
  // An invoice payment on the same unreachable account, so nothing but
  // refreshBudgetRoles can put budget_role right on it. This is the shape
  // migration 0009 leaves behind on every pre-existing row: real Pluggy
  // category, budget_role still at its SPEND default.
  const invoiceId = await insertTransaction(db, accountId, {
    description: 'PAGAMENTO FATURA',
    amountCents: -177_174_79,
    pluggyCategory: 'Credit card payment',
  })
  // A row written before any categorization existed: categoryId/source
  // null, exactly what an interrupted deploy or a normalizer change would
  // leave behind.
  await db
    .update(transactions)
    .set({ categoryId: null, categorySource: null, merchantNormalized: null })

  const result = await reconcileAll(db, pluggy(), { mailer: noopMailer() })

  expect(result.failed).toEqual([])
  expect(result.recategorized).toBeGreaterThan(0)
  // Asserted the way `recategorized` is: without it, deleting the
  // refreshBudgetRoles call from reconcileAll leaves the suite green, and
  // that call is the only thing that corrects budget_role on rows the mapper
  // never sees.
  expect(result.rolesCorrected).toBe(1)
  const rows = await listTransactions(db, householdId, { includeExcluded: true })
  expect(rows.find((r) => r.pluggyTransactionId === 'tx-1')!.categoryId).not.toBeNull()
  expect(rows.find((r) => r.id === staleId)!.categoryId).not.toBeNull()
  expect(rows.find((r) => r.id === invoiceId)!.budgetRole).toBe('TRANSFER')
})

// --- the household that predates the categorization migration ----------------

/**
 * Raw INSERTs on purpose. createHousehold seeds the taxonomy, which is
 * precisely what the production household does NOT have: 0005 creates the
 * tables and the three nullable columns and inserts nothing, and
 * seedCategories only ever ran from household creation. This reproduces the
 * exact state that migration leaves behind — no category rows at all, and
 * transactions whose merchant_normalized, category_id and category_source are
 * all NULL.
 *
 * The connection's account is deliberately one Pluggy's mock knows nothing
 * about, so syncConnection finds no remote transactions for it and cannot be
 * what fixes these rows. Only the household-wide pass in reconcileAll can.
 */
async function seedPreMigrationHousehold() {
  const db = testDb()

  const [household] = await db.execute<{ id: string }>(
    raw`insert into household (name) values ('Pre-migration') returning id`,
  )
  const [user] = await db.execute<{ id: string }>(
    raw`insert into "user" (household_id, email, name, password_hash)
        values (${household.id}, 'old@example.com', 'Old', 'hash')
        returning id`,
  )
  const [connection] = await db.execute<{ id: string }>(
    raw`insert into connection (household_id, owner_user_id, pluggy_item_id, institution, status)
        values (${household.id}, ${user.id}, 'item-pre-migration', 'Nubank', 'UPDATED')
        returning id`,
  )
  const [account] = await db.execute<{ id: string }>(
    raw`insert into account (connection_id, pluggy_account_id, type, name, last4)
        values (${connection.id}, 'acc-pre-migration', 'CREDIT', 'Cartao', '4321')
        returning id`,
  )

  await db.execute(
    raw`insert into transaction
          (account_id, pluggy_transaction_id, date, amount_cents, description,
           merchant_raw, pluggy_category, merchant_normalized, category_id, category_source)
        values
          (${account.id}, 'tx-old-market', '2026-07-01', 84210, 'ZAFFARI PORTO ALEG *0421',
           null, 'Supermarkets', null, null, null),
          (${account.id}, 'tx-old-fuel', '2026-07-02', 21000, 'POSTO IPIRANGA 1234',
           null, 'Gas stations', null, null, null),
          (${account.id}, 'tx-old-fee', '2026-07-03', 1200, 'TARIFA MENSALIDADE',
           null, 'Fees', null, null, null)`,
  )

  return { db, householdId: household.id }
}

it('seeds the taxonomy for a household that predates the migration', async () => {
  const { db, householdId } = await seedPreMigrationHousehold()
  expect(await listCategories(db, householdId)).toEqual([])

  await reconcileAll(db, pluggy(), { mailer: noopMailer() })

  const seeded = await listCategories(db, householdId)
  expect(seeded.map((c) => c.seedKey)).toEqual(SEED_CATEGORIES.map((c) => c.seedKey))
})

it('backfills merchant_normalized and categories on pre-migration transactions', async () => {
  const { db, householdId } = await seedPreMigrationHousehold()

  const result = await reconcileAll(db, pluggy(), { mailer: noopMailer() })

  expect(result.failed).toEqual([])
  expect(result.recategorized).toBeGreaterThan(0)

  const rows = await listTransactions(db, householdId)
  const byPluggyId = new Map(rows.map((r) => [r.pluggyTransactionId, r]))

  // Every row is normalized, whether or not it could be categorized.
  expect(rows.every((r) => r.merchantNormalized !== null)).toBe(true)
  expect(byPluggyId.get('tx-old-market')!.merchantNormalized).toBe('ZAFFARI PORTO ALEG')
  expect(byPluggyId.get('tx-old-fuel')!.merchantNormalized).toBe('POSTO IPIRANGA')

  // Pluggy-mappable rows land on the freshly seeded categories.
  expect(byPluggyId.get('tx-old-market')!.categoryName).toBe('Supermercado')
  expect(byPluggyId.get('tx-old-market')!.categorySource).toBe('PLUGGY')
  expect(byPluggyId.get('tx-old-fuel')!.categoryName).toBe('Combustível')

  // 'Fees' is deliberately unmapped, so this one stays in the inbox --
  // uncategorized, but NOT unnormalized.
  expect(byPluggyId.get('tx-old-fee')!.categoryId).toBeNull()
  expect(byPluggyId.get('tx-old-fee')!.merchantNormalized).toBe('TARIFA MENSALIDADE')
})

it('leaves no giant null-merchant inbox group after reconciling a pre-migration household', async () => {
  // The trap this guards: with merchant_normalized left NULL the whole back
  // catalogue groups under one "no usable merchant" group, whose only offered
  // action stamps every row MANUAL -- which nothing ever revisits.
  const { db, householdId } = await seedPreMigrationHousehold()

  const before = await getInboxView(db, householdId)
  expect(before.groups).toHaveLength(1)
  expect(before.groups[0].merchant).toBeNull()
  expect(before.groups[0].count).toBe(3)
  // And with no categories seeded there is nothing to assign them to.
  expect(before.categories).toEqual([])

  await reconcileAll(db, pluggy(), { mailer: noopMailer() })

  const after = await getInboxView(db, householdId)
  expect(after.groups.every((g) => g.merchant !== null)).toBe(true)
  expect(after.totalCount).toBe(1)
  expect(after.categories).not.toHaveLength(0)
})

/**
 * A category with spend in the current month and a budget it has crossed.
 *
 * The Pluggy fixture is dated whenever it is dated, and reconcileAll here
 * runs against the real clock, so the row that must cross is seeded into
 * today's month explicitly. MANUAL protects it from the recategorize pass
 * that runs before the evaluation.
 */
async function seedCrossing(
  db: ReturnType<typeof testDb>,
  householdId: string,
  connectionId: string,
  now: Date,
): Promise<void> {
  const accountId = await seedAccount(db, connectionId, { pluggyAccountId: 'acc-alerts-1' })
  const supermarket = (await listCategories(db, householdId)).find(
    (c) => c.name === 'Supermercado',
  )!
  const txId = await insertTransaction(db, accountId, {
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
}

it('sends one alert message per reconcile even when the household has two connections', async () => {
  // Evaluation is per household, not per connection. Moved into
  // syncConnection this would mail twice for one crossing -- the failure that
  // only appears once the second card is connected, which is exactly when
  // nobody is looking for it.
  const now = new Date()
  const { db, householdId, userId, connectionId } = await seed()
  await db.insert(connections).values({
    householdId,
    ownerUserId: userId,
    pluggyItemId: 'item-second-1',
    institution: 'Itau',
    status: 'UPDATED',
  })
  await seedCrossing(db, householdId, connectionId, now)
  const { mailer, sent } = createRecordingMailer()

  await reconcileAll(db, pluggy(), { mailer, now })

  expect(sent).toHaveLength(1)
  expect(sent[0].subject).toContain('Supermercado')
  // The mail count alone does not prove this: evaluateAndNotify is
  // idempotent per (householdId, categoryId, threshold, period), so a
  // regression that moved the call into the per-connection loop would still
  // send exactly one mail -- the second connection's call would just see the
  // threshold already fired and no-op. Asserting the call count is what
  // actually distinguishes "evaluated once per household" from "evaluated
  // once per connection, masked by idempotency".
  expect(alertsEvaluate.evaluateAndNotify).toHaveBeenCalledTimes(1)
})

it('still alerts the household when a sibling connection fails', async () => {
  // Distinct from 'keeps reconciling connections that come after a failed
  // one': that test proves the sync loop does not stop, but seeds no budget
  // crossing and asserts no mail. This proves the household-wide alert pass
  // still runs -- and still notifies -- when one of its own connections is
  // the one that failed, which is exactly the shape a second card adds.
  const now = new Date()
  const { db, householdId, userId, connectionId } = await seed()
  await db.insert(connections).values({
    householdId,
    ownerUserId: userId,
    pluggyItemId: 'item-broken',
    institution: 'Broken Bank',
    status: 'UPDATED',
  })
  await seedCrossing(db, householdId, connectionId, now)
  const { mailer, sent } = createRecordingMailer()

  const { http, HttpResponse } = await import('msw')
  server.use(
    http.get('https://api.pluggy.test/items/item-broken', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  )

  const result = await reconcileAll(db, pluggy(), { mailer, now })

  expect(result.failed).toHaveLength(1)
  expect(result.succeeded).toHaveLength(1)
  expect(await listTransactions(db, householdId)).not.toHaveLength(0)
  expect(sent).toHaveLength(1)
  expect(sent[0].subject).toContain('Supermercado')
})

it('reports a reconcile as succeeded even when the alert mail fails', async () => {
  // A Resend outage must not turn a healthy reconcile into a failed run, or
  // the exit code Railway records stops meaning "a card is broken".
  const now = new Date()
  const { db, householdId, connectionId } = await seed()
  await seedCrossing(db, householdId, connectionId, now)
  const { mailer, failNext } = createRecordingMailer()
  failNext()

  const result = await reconcileAll(db, pluggy(), { mailer, now })

  expect(result.failed).toEqual([])
  expect(result.succeeded).toHaveLength(1)
  expect(result.alerted).toBe(0)
})
