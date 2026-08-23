import {
  bigint,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const households = pgTable('household', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable(
  'user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_email_unique').on(t.email),
    index('user_household_idx').on(t.householdId),
  ],
)

export type User = typeof users.$inferSelect

export const householdInvites = pgTable('household_invite', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const connectionStatus = pgEnum('connection_status', [
  'UPDATED',
  'UPDATING',
  'LOGIN_ERROR',
  'WAITING_USER_INPUT',
  'OUTDATED',
])

export const accountType = pgEnum('account_type', ['CREDIT', 'BANK'])

export const categorySourceEnum = pgEnum('category_source', ['PLUGGY', 'RULE', 'MANUAL'])

export const ruleMatchTypeEnum = pgEnum('rule_match_type', ['EXACT', 'CONTAINS'])

export const connections = pgTable(
  'connection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    pluggyItemId: text('pluggy_item_id').notNull(),
    institution: text('institution').notNull(),
    status: connectionStatus('status').notNull().default('UPDATING'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('connection_item_unique').on(t.pluggyItemId)],
)

export const accounts = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    pluggyAccountId: text('pluggy_account_id').notNull(),
    type: accountType('type').notNull(),
    name: text('name').notNull(),
    last4: text('last4'),
    dueDay: integer('due_day'),
    closingDay: integer('closing_day'),
    creditLimitCents: bigint('credit_limit_cents', { mode: 'number' }),
  },
  (t) => [uniqueIndex('account_pluggy_unique').on(t.pluggyAccountId)],
)

export type Connection = typeof connections.$inferSelect
export type Account = typeof accounts.$inferSelect

export const categories = pgTable(
  'category',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Null for household-created categories. Postgres treats NULLs as
    // distinct in a unique index, so many null-keyed rows coexist happily.
    seedKey: text('seed_key'),
    sortOrder: integer('sort_order').notNull().default(0),
    // Categories archive rather than delete: Slice 3 stores budgets per
    // category per month, and a hard delete would strand historical spend.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('category_seed_key_unique').on(t.householdId, t.seedKey),
    index('category_household_idx').on(t.householdId, t.sortOrder),
  ],
)

export const merchantRules = pgTable(
  'merchant_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    matchType: ruleMatchTypeEnum('match_type').notNull(),
    // Stored already normalized, so matching is symmetrical with the
    // transaction side and needs no normalization at query time.
    pattern: text('pattern').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    // Lower wins. Inbox-created EXACT rules default to 100, hand-written
    // CONTAINS rules to 200, so specific beats broad unless reordered.
    priority: integer('priority').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('merchant_rule_household_idx').on(t.householdId, t.priority),
    uniqueIndex('merchant_rule_unique').on(t.householdId, t.matchType, t.pattern),
  ],
)

export type Category = typeof categories.$inferSelect
export type MerchantRule = typeof merchantRules.$inferSelect

export const transactions = pgTable(
  'transaction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    pluggyTransactionId: text('pluggy_transaction_id').notNull(),
    date: date('date').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    description: text('description').notNull(),
    merchantRaw: text('merchant_raw'),
    pluggyCategory: text('pluggy_category'),
    merchantNormalized: text('merchant_normalized'),
    categoryId: uuid('category_id').references(() => categories.id),
    categorySource: categorySourceEnum('category_source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('transaction_pluggy_unique').on(t.pluggyTransactionId),
    index('transaction_account_date_idx').on(t.accountId, t.date),
    // Slice 3 aggregates spend with GROUP BY category_id; this is that index.
    index('transaction_category_idx').on(t.categoryId),
    index('transaction_merchant_idx').on(t.merchantNormalized),
  ],
)

export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
