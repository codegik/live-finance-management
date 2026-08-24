// Finds each credit card's real closing day by matching a fatura total you
// read off the card.
//
// READ-ONLY. It writes nothing, so it is safe against production -- which is
// the point, because production is where the real faturas are. Point
// DATABASE_URL at the database you want to inspect:
//
//   DATABASE_URL=... pnpm exec tsx tools/closing-day.ts 2026-09 1885=22534.04 1915=4714.99
//
// The closing day decides which fatura a purchase lands on, and therefore
// which month the app files it in. Pluggy left it null on both of this
// household's cards, so it has to come from somewhere -- and guessing the same
// day for two different banks files one card's spending a month off.

import { createDb } from '../lib/db/client'
import { accounts, connections, transactions } from '../lib/db/schema'
import { eq } from 'drizzle-orm'
import { billingPeriod } from '../lib/domain/billing'

const [period, ...targets] = process.argv.slice(2)

if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) {
  console.error('Usage: tsx tools/closing-day.ts YYYY-MM <last4>=<total> [<last4>=<total> ...]')
  process.exit(1)
}

const wanted = new Map<string, number>()
for (const t of targets) {
  const [last4, amount] = t.split('=')
  wanted.set(last4, Math.round(Number(amount) * 100))
}

const { db, sql } = createDb(process.env.DATABASE_URL!)

try {
  const rows = await db
    .select({
      last4: accounts.last4,
      name: accounts.name,
      type: accounts.type,
      dueDay: accounts.dueDay,
      dueDayOverride: accounts.dueDayOverride,
      closingDay: accounts.closingDay,
      closingDayOverride: accounts.closingDayOverride,
      date: transactions.date,
      amountCents: transactions.amountCents,
      budgetRole: transactions.budgetRole,
      installmentNumber: transactions.installmentNumber,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(connections, eq(accounts.connectionId, connections.id))
    .where(eq(accounts.type, 'CREDIT'))

  const byCard = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = row.last4 ?? row.name
    byCard.set(key, [...(byCard.get(key) ?? []), row])
  }

  for (const [card, cardRows] of byCard) {
    const first = cardRows[0]
    const dueDay = first.dueDayOverride ?? first.dueDay
    const target = wanted.get(card)

    console.log(`\n${card} — ${first.name}`)
    console.log(
      `  vencimento em uso: ${dueDay ?? '—'}` +
        `  ·  fechamento em uso: ${first.closingDayOverride ?? first.closingDay ?? '—'}`,
    )
    if (target === undefined) {
      console.log('  (sem total de fatura informado — pulando)')
      continue
    }

    const scored: { closingDay: number; total: number; diff: number }[] = []
    for (let closingDay = 1; closingDay <= 28; closingDay += 1) {
      // Only SPEND, because that is what every budgeting screen counts.
      // Fees and IOF arrive as TRANSFER and are excluded by design, so a
      // residual gap here is a real signal, not noise to be tuned away.
      const total = cardRows
        .filter((r) => r.budgetRole === 'SPEND')
        .filter(
          (r) =>
            billingPeriod({
              date: r.date,
              accountType: 'CREDIT',
              closingDay,
              dueDay,
              installmentNumber: r.installmentNumber,
            }) === period,
        )
        .reduce((sum, r) => sum + r.amountCents, 0)
      scored.push({ closingDay, total, diff: Math.abs(total - target) })
    }

    scored.sort((a, b) => a.diff - b.diff)
    console.log(`  fatura informada para ${period}: R$ ${(target / 100).toFixed(2)}`)
    console.log('  melhores dias de fechamento:')
    for (const s of scored.slice(0, 3)) {
      console.log(
        `    dia ${String(s.closingDay).padStart(2)} → R$ ${(s.total / 100)
          .toFixed(2)
          .padStart(12)}   diferença R$ ${(s.diff / 100).toFixed(2)}`,
      )
    }
  }
} finally {
  await sql.end()
}
