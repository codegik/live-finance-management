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

export const budgetRoleEnum = pgEnum('budget_role', ['SPEND', 'TRANSFER', 'INCOME'])

/**
 * The block a category belongs to on the household's month view.
 *
 * The four blocks are the ones the household already keeps by hand. The group
 * also decides which budget role a category's actuals are read from: RECEITA
 * reads INCOME rows, every other group reads SPEND. See lib/views/month.ts.
 */
export const categoryGroupEnum = pgEnum('category_group', [
  'RECEITA',
  'INVESTIMENTO',
  'DESPESA_FIXA',
  'DESPESA_VARIAVEL',
])

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
    // Pluggy's value stays in due_day / closing_day and is rewritten freely by
    // every sync. A household override lives here, so an edit can never be
    // clobbered and the sync path needs no knowledge that overrides exist.
    dueDayOverride: integer('due_day_override'),
    closingDayOverride: integer('closing_day_override'),
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
    // Which block of the month view this category is totalled under. Defaults
    // to variable spending for the same reason budget_role defaults to SPEND:
    // an unclassified row stays where the household will see it.
    group: categoryGroupEnum('group').notNull().default('DESPESA_VARIAVEL'),
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

export const budgets = pgTable(
  'budget',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    // Always the first of the month. A date rather than 'YYYY-MM' text so it
    // sorts and ranges without string parsing.
    periodMonth: date('period_month').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('budget_period_unique').on(t.householdId, t.categoryId, t.periodMonth),
    index('budget_household_idx').on(t.householdId, t.periodMonth),
  ],
)

export type Budget = typeof budgets.$inferSelect

/**
 * One row per threshold already notified, per category, per month. Its only
 * purpose is dedupe: written after a successful send, deleted when the
 * crossing stops being true. See lib/domain/alerts.ts for the rule.
 *
 * Deliberately stores no copy of the spend or budget that caused it. Every
 * decision is recomputed from the live rows, so a snapshot here could only
 * ever be a second version of the truth that disagrees with the first.
 */
export const alertStates = pgTable(
  'alert_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** Always the first of the month, as in `budget`. */
    periodMonth: date('period_month').notNull(),
    /** A percent -- 80 or 100. An integer rather than an enum so a future
     * 50% costs no migration. */
    threshold: integer('threshold').notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('alert_state_unique').on(t.householdId, t.categoryId, t.periodMonth, t.threshold),
    index('alert_state_household_idx').on(t.householdId, t.periodMonth),
  ],
)

export type AlertState = typeof alertStates.$inferSelect

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
    // What this row is, for budgeting: spending, money moving between the
    // household's own accounts, or money arriving. Only SPEND counts against
    // a budget. See lib/domain/budget-role.ts.
    budgetRole: budgetRoleEnum('budget_role').notNull().default('SPEND'),
    // Parsed from the descriptor at ingest. Both set or both null. A row with
    // these is money already committed, which is what pace and the forward
    // view are built on.
    installmentNumber: integer('installment_number'),
    installmentTotal: integer('installment_total'),
    // The month the household actually pays this, which is the month it
    // budgets it in. For a card purchase that is the month its fatura falls
    // due, not the month it was bought -- see lib/domain/billing.ts. Always a
    // first-of-month date. Nullable because it is derived: a row the refresh
    // pass has not reached yet falls back to its own month, which is what the
    // app did before this column existed.
    budgetMonth: date('budget_month'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('transaction_pluggy_unique').on(t.pluggyTransactionId),
    index('transaction_account_date_idx').on(t.accountId, t.date),
    // Slice 3 aggregates spend with GROUP BY category_id; this is that index.
    index('transaction_category_idx').on(t.categoryId),
    index('transaction_merchant_idx').on(t.merchantNormalized),
    // Month-range scans are the dashboard's access pattern, and the Slice 1
    // indexes are keyed on account first, so they do not serve it.
    index('transaction_date_idx').on(t.date),
    // Every budgeting screen now ranges on the paying month rather than the
    // purchase date, so that is the column those scans need.
    index('transaction_budget_month_idx').on(t.budgetMonth),
  ],
)

export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
