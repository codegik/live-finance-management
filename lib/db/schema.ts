import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const households = pgTable('household', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
