import { PlanEditor } from '@/components/PlanEditor'
import { TransactionCategoryPicker } from '@/components/TransactionCategoryPicker'
import { Card } from '@/components/ui/card'
import { brl, brlSigned, percent } from '@/lib/format'
import { MORE_IS_BETTER } from '@/lib/domain/seed-categories'
import type {
  MonthBucketDetail,
  MonthGroupView,
  MonthRow,
  MonthStance,
} from '@/lib/views/month'

/**
 * A line in a block that is not a category: uncategorized spend, spend on
 * archived categories, income on no Receita category. It carries its own rows
 * so it opens like a category row does -- a figure of R$ 73.753,78 that cannot
 * be interrogated is the one number on the screen nobody can act on.
 */
export type MonthExtra = MonthBucketDetail & {
  label: string
  amountCents: number
}

/** A small coloured dot per block, so the four sheets are told apart at a
 *  glance -- the same intent as the old coloured titles. */
const DOT_CLASS: Record<string, string> = {
  RECEITA: 'bg-pos',
  INVESTIMENTO: 'bg-accent-blue',
  DESPESA_FIXA: 'bg-warn',
  DESPESA_VARIAVEL: 'bg-neg',
}

export type RowTone = 'plain' | 'good' | 'over' | 'pacing-over'

/**
 * How a row reads against its plan. Exported so the four outcomes and their
 * precedence can be tested without rendering: a row already over its plan must
 * never be repainted as a forecast, and a row in a block where MORE_IS_BETTER
 * must never be painted as a failure for beating it.
 *
 * `stance` matters because a forecast is only meaningful while the month is
 * still running. Pacing a closed month would warn about spending that
 * provably never happened.
 */
export function rowTone(row: MonthRow, stance: MonthStance): RowTone {
  if (row.plannedCents === null) return 'plain'

  if (MORE_IS_BETTER[row.group]) {
    return row.actualCents >= row.plannedCents ? 'good' : 'plain'
  }

  if (row.actualCents > row.plannedCents) return 'over'
  // A row already over and a row merely forecast to go over are different
  // problems and must not look the same.
  if (stance === 'CURRENT' && row.paceCents > row.plannedCents) return 'pacing-over'
  return 'plain'
}

const BAR_CLASS: Record<RowTone, string> = {
  plain: 'track__bar',
  good: 'track__bar track__bar--pos',
  over: 'track__bar track__bar--over',
  'pacing-over': 'track__bar track__bar--pacing-over',
}

const DELTA_CLASS: Record<RowTone, string> = {
  plain: 'row__delta',
  good: 'row__delta row__delta--under',
  over: 'row__delta row__delta--over',
  'pacing-over': 'row__delta row__delta--pace',
}

/**
 * Clamped at both ends. A refund-heavy month makes net spend negative, and a
 * negative percentage renders as `width: -12%`.
 */
function widthPercent(actualCents: number, plannedCents: number): number {
  if (plannedCents <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((actualCents / plannedCents) * 100)))
}

/** `2026-08-17` as `17/08`, which is how a statement is read. */
function shortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

/**
 * What a category's figure is actually made of.
 *
 * The same native <details> the inbox uses, and for the same reason: the
 * question a household asks of a row is "what IS that?", and answering it in a
 * modal takes them off the screen they were reading. It also costs no
 * JavaScript and survives a re-render with its own state.
 */
function RowTransactions({
  transactions,
  transactionCount,
  categories,
}: MonthBucketDetail & {
  categories: { id: string; name: string }[]
}) {
  const hidden = transactionCount - transactions.length

  return (
    <>
      <ul className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border bg-surface-2">
        {transactions.map((transaction) => (
          <li
            key={transaction.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
          >
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {shortDate(transaction.date)}
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <div className="truncate text-sm">{transaction.description}</div>
              <div className="truncate text-xs text-text-faint">
                {transaction.accountName}
                {transaction.last4 ? ` ···· ${transaction.last4}` : null}
                {/* Which instalment of which, because "R$ 1.147,09" repeated
                    across ten months is otherwise unexplainable. */}
                {transaction.installment ? ` · parcela ${transaction.installment}` : null}
              </div>
            </div>
            <span className="font-mono text-xs tabular-nums">{brl(transaction.amountCents)}</span>
            {/* Fixing it here, where the mistake is visible. Sending someone
                to another screen to correct one charge is how a wrong category
                stays wrong.

                Per transaction, not per list. Under a category row the two are
                the same value by construction, but the "Não categorizado" and
                "Categorias arquivadas" buckets are defined by NOT matching any
                drawn row, so their lists have no single category to preselect:
                null there is the truth, and the picker turns it into a
                disabled "A categorizar" placeholder. Preselecting whatever
                sorts first instead would show an unfiled charge as already
                filed -- and one careless click would then file it there. */}
            <TransactionCategoryPicker
              key={transaction.id}
              transactionId={transaction.id}
              categoryId={transaction.categoryId}
              categories={categories}
            />
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Mostrando {transactions.length} de {transactionCount} lançamentos.
        </p>
      ) : null}
    </>
  )
}

function Row({
  row,
  stance,
  period,
  categories,
}: {
  row: MonthRow
  stance: MonthStance
  period: string
  categories: { id: string; name: string }[]
}) {
  const tone = rowTone(row, stance)
  const planned = row.plannedCents
  const delta = planned === null ? null : row.actualCents - planned

  return (
    <li>
      {/* A row with nothing behind it is not openable: an empty panel under a
          R$ 0,00 line answers a question nobody asked. */}
      {row.transactionCount === 0 ? (
        <div className="row">
        <span className="row__name">{row.categoryName}</span>
        <span className="row__amounts">
          {brl(row.actualCents)}
          <PlanEditor categoryId={row.categoryId} period={period} plannedCents={planned} />
        </span>

        {/* An empty track is information: a plan with nothing against it yet. A
            row with NO plan has nothing to be a fraction of, so it draws no
            track at all -- a 0% bar would collapse the two into one picture. */}
        {planned === null ? null : (
          <span className="track">
            <span
              className={BAR_CLASS[tone]}
              style={{ width: `${widthPercent(row.actualCents, planned)}%` }}
            />
            {/* Where the month is heading, marked only while it is still
                running and only when it lands inside the track. */}
            {stance === 'CURRENT' && row.paceCents > row.actualCents ? (
              <span
                className="track__pace"
                style={{ left: `${widthPercent(row.paceCents, planned)}%` }}
                title={`Projeção: ${brl(row.paceCents)}`}
              />
            ) : null}
          </span>
        )}

        <span className="row__meta">
          {delta !== null && delta !== 0 ? (
            <span className={DELTA_CLASS[tone]}>{brlSigned(delta)}</span>
          ) : null}
          {stance === 'CURRENT' && planned !== null && row.paceCents !== row.actualCents ? (
            <span>projeção {brl(row.paceCents)}</span>
          ) : null}
          {/* "Committed" answers "how much of this month is already spoken
              for", which is a question about spending. On a Receita row it read
              as if a salary had been pre-spent, and on an investment as if a
              transfer were an obligation. */}
          {!MORE_IS_BETTER[row.group] && row.committedCents > 0 ? (
            <span>{brl(row.committedCents)} já comprometido</span>
          ) : null}
          {row.plannedFrom ? <span>plano herdado de {row.plannedFrom}</span> : null}
        </span>
      </div>
      ) : (
        <details className="row-detail">
          <summary className="row">
            <span className="row__name">{row.categoryName}</span>
            <span className="row__amounts">
              {brl(row.actualCents)}
              <PlanEditor categoryId={row.categoryId} period={period} plannedCents={planned} />
            </span>

            {/* An empty track is information: a plan with nothing against it yet. A
                row with NO plan has nothing to be a fraction of, so it draws no
                track at all -- a 0% bar would collapse the two into one picture. */}
            {planned === null ? null : (
              <span className="track">
                <span
                  className={BAR_CLASS[tone]}
                  style={{ width: `${widthPercent(row.actualCents, planned)}%` }}
                />
                {/* Where the month is heading, marked only while it is still
                    running and only when it lands inside the track. */}
                {stance === 'CURRENT' && row.paceCents > row.actualCents ? (
                  <span
                    className="track__pace"
                    style={{ left: `${widthPercent(row.paceCents, planned)}%` }}
                    title={`Projeção: ${brl(row.paceCents)}`}
                  />
                ) : null}
              </span>
            )}

            <span className="row__meta">
              {delta !== null && delta !== 0 ? (
                <span className={DELTA_CLASS[tone]}>{brlSigned(delta)}</span>
              ) : null}
              {stance === 'CURRENT' && planned !== null && row.paceCents !== row.actualCents ? (
                <span>projeção {brl(row.paceCents)}</span>
              ) : null}
              {/* "Committed" answers "how much of this month is already spoken
                  for", which is a question about spending. On a Receita row it read
                  as if a salary had been pre-spent, and on an investment as if a
                  transfer were an obligation. */}
              {!MORE_IS_BETTER[row.group] && row.committedCents > 0 ? (
                <span>{brl(row.committedCents)} já comprometido</span>
              ) : null}
              {row.plannedFrom ? <span>plano herdado de {row.plannedFrom}</span> : null}
            </span>
        </summary>
          <RowTransactions
            transactions={row.transactions}
            transactionCount={row.transactionCount}
            categories={categories}
          />
        </details>
      )}
    </li>
  )
}

/**
 * One block of the household's sheet -- Receita, Investimento, Despesas fixas,
 * Despesas variáveis -- with its own subtotal, the way the spreadsheet has
 * always had one.
 *
 * `extra` carries money that belongs to this block's total but has no category
 * to sit on: uncategorized spend, and spend on categories since archived. It
 * is passed in rather than hidden, because a block whose rows do not add up to
 * its own header is a block nobody can reconcile.
 */
export function MonthBlock({
  group,
  stance,
  period,
  categories,
  extra,
}: {
  group: MonthGroupView
  stance: MonthStance
  period: string
  categories: { id: string; name: string }[]
  extra?: MonthExtra[]
}) {
  const extras = (extra ?? []).filter((item) => item.amountCents !== 0)
  const total = group.actualCents + extras.reduce((sum, item) => sum + item.amountCents, 0)

  if (group.rows.length === 0 && extras.length === 0) return null

  return (
    <Card className="overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border bg-surface-2/40 px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span
            className={`size-2 rounded-full ${DOT_CLASS[group.group] ?? 'bg-muted-foreground'}`}
            aria-hidden="true"
          />
          {group.label}
        </h2>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums">{brl(total)}</span>
          {group.plannedCents > 0 ? (
            <span className="text-xs text-muted-foreground">
              de {brl(group.plannedCents)} · {percent(total / group.plannedCents)}
            </span>
          ) : null}
        </div>
      </header>
      <ul className="block__rows px-4 py-2">
        {group.rows.map((row) => (
          <Row
            key={row.categoryId}
            row={row}
            stance={stance}
            period={period}
            categories={categories}
          />
        ))}
        {extras.map((item) => (
          <li key={item.label}>
            {/* Same rule as a category row: nothing behind the figure means
                nothing to open. A bucket can hold an amount with no rows to
                show when the money is a residual the detail query cannot
                name -- an empty panel under it would answer a question nobody
                asked. No track and no plan: none of these buckets is a
                category, so there is nothing to budget them against. */}
            {item.transactionCount === 0 ? (
              <div className="row">
                <span className="row__name">{item.label}</span>
                <span className="row__amounts">{brl(item.amountCents)}</span>
              </div>
            ) : (
              <details className="row-detail">
                <summary className="row">
                  <span className="row__name">{item.label}</span>
                  <span className="row__amounts">{brl(item.amountCents)}</span>
                </summary>
                <RowTransactions
                  transactions={item.transactions}
                  transactionCount={item.transactionCount}
                  categories={categories}
                />
              </details>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
