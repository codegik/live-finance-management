import { RuleFromTransaction } from '@/app/(app)/settings/rules/RuleForms'
import { MerchantLabelButton } from '@/components/MerchantLabelButton'
import { PlanEditor } from '@/components/PlanEditor'
import { RecurringExpenseButton } from '@/components/RecurringExpenseButton'
import { TransactionCategoryPicker } from '@/components/TransactionCategoryPicker'
import { TransactionDetail } from '@/components/TransactionDetail'
import { Card } from '@/components/ui/card'
import { brl, brlSigned, percent } from '@/lib/format'
import { MORE_IS_BETTER } from '@/lib/domain/seed-categories'
import type {
  MonthBucketDetail,
  MonthGroupView,
  MonthRecurringLine,
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

/**
 * One category line: label, its figure, and (when it has a plan) a track and a
 * meta line. A flex row that wraps -- the amount stays glued to the label, and
 * the track and meta each take a full line of their own via basis-full.
 */
const ROW =
  'flex flex-wrap items-baseline gap-x-[0.6rem] gap-y-[0.15rem] px-3 py-[0.6rem] transition-colors hover:bg-surface-2'
/** The clickable summary variant of a row: a pointer and no default marker. The
 *  open tint lives on the <details> itself so the summary and its transactions
 *  read as one connected block, not two separate boxes. */
const ROW_SUMMARY = `${ROW} cursor-pointer list-none [&::-webkit-details-marker]:hidden`
const ROW_NAME = 'min-w-0 flex-[1_1_auto] text-[0.875rem]'
/** The name inside a summary carries the › caret that turns when the row opens. */
const ROW_NAME_CARET = `${ROW_NAME} before:inline-block before:w-[0.85rem] before:text-text-faint before:transition-transform before:content-['›'] group-open:before:rotate-90`
const ROW_AMOUNTS = 'flex-[0_1_auto] whitespace-nowrap text-left font-mono text-[0.875rem] font-medium'
const ROW_META = 'flex basis-full flex-wrap gap-2 text-[0.74rem] text-text-faint'
const TRACK = 'relative mt-[0.15rem] h-1 basis-full overflow-hidden rounded-full bg-surface-3'
const TRACK_PACE = 'absolute -top-0.5 -bottom-0.5 w-[2px] bg-text-dim'
const TRACK_BAR = 'absolute inset-y-0 left-0 rounded-full'

const BAR_CLASS: Record<RowTone, string> = {
  plain: `${TRACK_BAR} bg-accent-blue`,
  good: `${TRACK_BAR} bg-pos`,
  over: `${TRACK_BAR} bg-neg`,
  'pacing-over': `${TRACK_BAR} bg-warn`,
}

const DELTA = 'font-mono font-semibold'
const DELTA_CLASS: Record<RowTone, string> = {
  plain: DELTA,
  good: `${DELTA} text-pos`,
  over: `${DELTA} text-neg`,
  'pacing-over': `${DELTA} text-warn`,
}

/**
 * Clamped at both ends. A refund-heavy month makes net spend negative, and a
 * negative percentage renders as `width: -12%`.
 */
function widthPercent(actualCents: number, plannedCents: number): number {
  if (plannedCents <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((actualCents / plannedCents) * 100)))
}

/**
 * What a category's figure is actually made of.
 *
 * The same native <details> the inbox uses, and for the same reason: the
 * question a household asks of a row is "what IS that?", and answering it in a
 * modal takes them off the screen they were reading. It also costs no
 * JavaScript and survives a re-render with its own state.
 */
/** `2026-10-21` as `21/10`, the same date column a real charge is read down. */
function shortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

/**
 * One projected line: a recurring expense the category is still waiting for
 * this month. It is laid out like a real charge -- its expected date in the
 * left column (the recurrence's day on the month being viewed), the name, and
 * the amount on the right -- so a forecast and a settled charge read down the
 * same columns. What sets it apart is the `previsto` badge where a real charge
 * shows `pendente`, and a pencil to edit or remove the definition behind it.
 * Estimated (variable) amounts say so on the second line.
 */
function RecurringLineItem({
  line,
  period,
  categories,
}: {
  line: MonthRecurringLine
  period: string
  categories: { id: string; name: string }[]
}) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2.5">
      <div className="flex min-w-0 flex-1 basis-full items-baseline gap-x-3 sm:basis-0">
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {shortDate(line.date)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium">
            {line.title}
            <span className="ml-1.5 align-middle rounded-full bg-accent-blue/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-accent-blue">
              previsto
            </span>
          </span>
          {line.estimated ? (
            <span className="block text-xs text-text-faint">estimado pela média</span>
          ) : null}
        </span>
        <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
          {brl(line.amountCents)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <RecurringExpenseButton
          trigger="edit"
          period={period}
          categories={categories}
          merchant={line.pattern}
          defaultTitle={line.title}
          defaultCategoryId={line.categoryId}
          defaultAmountCents={line.estimated ? null : line.amountCents}
          defaultDay={line.dayOfMonth}
          defaultCadence={line.cadence}
          defaultMatchType={line.matchType}
          existing={{ matchType: line.matchType, pattern: line.pattern }}
        />
      </div>
    </li>
  )
}

function RowTransactions({
  transactions,
  transactionCount,
  categories,
  period,
  recurringLines,
  recurringCategoryId,
}: MonthBucketDetail & {
  categories: { id: string; name: string }[]
  /** The month on screen, seeded into any recurrence made from these rows. */
  period: string
  /** Forecast lines to draw under the real charges. Omitted for the buckets
   *  (uncategorized/archived) that no category owns. */
  recurringLines?: MonthRecurringLine[]
  /** The category this list belongs to, so its "add recurring" row seeds it.
   *  Omitted for the buckets, which have no single category. */
  recurringCategoryId?: string
}) {
  const hidden = transactionCount - transactions.length

  return (
    <>
      {/* No bordered panel around the list: the row it opens under already
          frames it, and a second box inside the first is the nesting that made
          this screen read as boxes within boxes. Just hairlines between the
          charges, inset a little so they still read as belonging to the row. */}
      <ul className="flex flex-col divide-y divide-border/60 border-t border-border/60 pb-1 pl-6 pr-3">
        {transactions.map((transaction) => (
          <li
            key={transaction.id}
            className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2.5"
          >
            {/* The row shows what identifies the charge at a glance and opens to
                its full record on tap -- the long account name, the bank, and
                the instalment position are details reached for deliberately,
                not width spent on every row. The full merchant name never
                truncates: it is the one thing here nobody can reconstruct. */}
            <TransactionDetail
              transaction={transaction}
              categoryName={
                categories.find((category) => category.id === transaction.categoryId)?.name ?? null
              }
            />
            {/* One connected action cluster, not loose pills: the category chip,
                the apelido pencil, the "make this a rule" wand, and the "make
                this recurring" repeat glyph belong to the same row and sit
                together. Each fixes or records something about this charge where
                it is read, not on another screen.

                Category is per transaction, not per list: the "Não
                categorizado" and "Categorias arquivadas" buckets are defined by
                NOT matching any drawn row, so their lists have no single
                category to preselect -- null there is the truth, which the
                picker turns into a disabled "A categorizar" placeholder. */}
            <div className="flex items-center gap-1.5">
              <TransactionCategoryPicker
                key={transaction.id}
                transactionId={transaction.id}
                categoryId={transaction.categoryId}
                categories={categories}
                compact
              />
              <MerchantLabelButton
                merchant={transaction.merchantNormalized}
                currentLabel={transaction.label}
              />
              <RuleFromTransaction
                merchant={transaction.merchantNormalized}
                categoryId={transaction.categoryId}
                categories={categories}
              />
              {/* "Make recurring" is offered only on a charge that is not one
                  already: once a real charge fulfils a recurrence, the
                  recurrence is edited on a month where it is still a forecast,
                  not here where it has already happened. An instalment is never
                  offered it -- it is a finite series the connector already dates
                  across its own months, so recurring it would forecast payments
                  that never come. */}
              {transaction.recurring ? null : (
                <RecurringExpenseButton
                  trigger="glyph"
                  period={period}
                  categories={categories}
                  merchant={transaction.merchantNormalized}
                  defaultTitle={transaction.label ?? undefined}
                  defaultCategoryId={transaction.categoryId}
                  defaultAmountCents={transaction.amountCents}
                  defaultDay={Number(transaction.date.slice(8, 10))}
                  disabledReason={
                    transaction.installment
                      ? 'Parcelas não são recorrentes — as próximas já aparecem nos meses seguintes.'
                      : undefined
                  }
                />
              )}
            </div>
          </li>
        ))}
        {(recurringLines ?? []).map((line) => (
          <RecurringLineItem
            key={line.id}
            line={line}
            period={period}
            categories={categories}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Mostrando {transactions.length} de {transactionCount} lançamentos.
        </p>
      ) : null}
      {/* The "+ Adicionar recorrente" entry point, only under a real category
          (a bucket has no single one to file it against). */}
      {recurringCategoryId ? (
        <RecurringExpenseButton
          trigger="add"
          period={period}
          categories={categories}
          defaultCategoryId={recurringCategoryId}
        />
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
  // A row opens when there is something behind its figure to show: real
  // charges, or the recurring bills it is still waiting on this month. A row
  // with only a plan and nothing else stays a closed line.
  const openable = row.transactionCount > 0 || row.recurringLines.length > 0

  return (
    <li>
      {/* A row with nothing behind it is not openable: an empty panel under a
          R$ 0,00 line answers a question nobody asked. */}
      {!openable ? (
        <div className={ROW}>
        <span className={ROW_NAME}>{row.categoryName}</span>
        <span className={ROW_AMOUNTS}>
          {brl(row.actualCents)}
          <PlanEditor categoryId={row.categoryId} period={period} plannedCents={planned} />
        </span>

        {/* An empty track is information: a plan with nothing against it yet. A
            row with NO plan has nothing to be a fraction of, so it draws no
            track at all -- a 0% bar would collapse the two into one picture. */}
        {planned === null ? null : (
          <span className={TRACK}>
            <span
              className={BAR_CLASS[tone]}
              style={{ width: `${widthPercent(row.actualCents, planned)}%` }}
            />
            {/* Where the month is heading, marked only while it is still
                running and only when it lands inside the track. */}
            {stance === 'CURRENT' && row.paceCents > row.actualCents ? (
              <span
                className={TRACK_PACE}
                style={{ left: `${widthPercent(row.paceCents, planned)}%` }}
                title={`Projeção: ${brl(row.paceCents)}`}
              />
            ) : null}
          </span>
        )}

        <span className={ROW_META}>
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
          {/* What the row still expects from its recurring bills this month --
              a forecast, so it reads apart from spent and committed money. */}
          {row.recurringCents > 0 ? (
            <span className="text-accent-blue">previsto {brl(row.recurringCents)}</span>
          ) : null}
          {row.plannedFrom ? <span>plano herdado de {row.plannedFrom}</span> : null}
        </span>
      </div>
      ) : (
        <details className="group open:bg-surface-2">
          <summary className={ROW_SUMMARY}>
            <span className={ROW_NAME_CARET}>{row.categoryName}</span>
            <span className={ROW_AMOUNTS}>
              {brl(row.actualCents)}
              <PlanEditor categoryId={row.categoryId} period={period} plannedCents={planned} />
            </span>

            {/* An empty track is information: a plan with nothing against it yet. A
                row with NO plan has nothing to be a fraction of, so it draws no
                track at all -- a 0% bar would collapse the two into one picture. */}
            {planned === null ? null : (
              <span className={TRACK}>
                <span
                  className={BAR_CLASS[tone]}
                  style={{ width: `${widthPercent(row.actualCents, planned)}%` }}
                />
                {/* Where the month is heading, marked only while it is still
                    running and only when it lands inside the track. */}
                {stance === 'CURRENT' && row.paceCents > row.actualCents ? (
                  <span
                    className={TRACK_PACE}
                    style={{ left: `${widthPercent(row.paceCents, planned)}%` }}
                    title={`Projeção: ${brl(row.paceCents)}`}
                  />
                ) : null}
              </span>
            )}

            <span className={ROW_META}>
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
            period={period}
            recurringLines={row.recurringLines}
            recurringCategoryId={row.categoryId}
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
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border bg-surface-2/40 px-3 py-3">
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
      <ul className="list-none divide-y divide-border">
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
              <div className={ROW}>
                <span className={ROW_NAME}>{item.label}</span>
                <span className={ROW_AMOUNTS}>{brl(item.amountCents)}</span>
              </div>
            ) : (
              <details className="group open:bg-surface-2">
                <summary className={ROW_SUMMARY}>
                  <span className={ROW_NAME_CARET}>{item.label}</span>
                  <span className={ROW_AMOUNTS}>{brl(item.amountCents)}</span>
                </summary>
                <RowTransactions
                  transactions={item.transactions}
                  transactionCount={item.transactionCount}
                  categories={categories}
                  period={period}
                />
              </details>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
