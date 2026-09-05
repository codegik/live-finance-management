'use client'

import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { accountLabel, brl } from '@/lib/format'
import type { MonthTransaction } from '@/lib/views/month'

/** `2026-08-17` as `17/08`, the way a statement is read down its date column. */
function shortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

/** The same date in full, for the detail sheet where the year is worth stating. */
function fullDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="break-words text-right font-medium">{value}</dd>
    </div>
  )
}

/**
 * A transaction row that reads on a phone and opens to its full record.
 *
 * The row itself carries only what identifies the charge at a glance -- date,
 * full merchant name, the account compressed to `Cartão ···· 1885`, amount.
 * The long marketing account name, the bank, and the instalment position are
 * the details someone reaches for deliberately, so they live behind a tap
 * rather than eating the width the name needs. The full name never truncates:
 * it is the one thing on the row nobody can reconstruct from the rest.
 */
export function TransactionDetail({
  transaction,
  categoryName,
}: {
  transaction: MonthTransaction
  /** Resolved by the caller from the same category list the picker uses. */
  categoryName: string | null
}) {
  const [open, setOpen] = useState(false)

  // Escape closes it, matching every other dismissable surface, and the
  // listener only exists while the sheet is open so it never competes for the
  // key when nothing is up.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const account = accountLabel({
    type: transaction.accountType,
    institution: transaction.institution,
    last4: transaction.last4,
  })
  const fullAccount = `${transaction.accountName}${transaction.last4 ? ` ···· ${transaction.last4}` : ''}`
  // The household's own name when one matches this merchant, the bank descriptor
  // otherwise. The descriptor is never lost: when a label shows, the original
  // still appears in the sheet below as "Descrição original".
  const displayName = transaction.label ?? transaction.description

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Full width on a phone (basis-full) so the merchant name gets the
        // whole row and wraps on word boundaries instead of being crushed into
        // a 50px column beside the amount; the category chip then drops to its
        // own line below. From sm up it shares the row with the chip again.
        // items-baseline keeps the date and amount on the name's first line
        // rather than floating in the middle of a tall, wrapped name.
        // border-0 bg-transparent: this is a raw <button>, and without them the
        // base `button` rule in globals.css paints a filled, bordered slab
        // around every transaction -- the "ugly box". At rest it is just the
        // line; the hover tint is the only chrome.
        className="-mx-1 flex min-w-0 basis-full items-baseline gap-x-3 rounded-md border-0 bg-transparent px-1 py-0.5 text-left transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background sm:flex-1 sm:basis-0"
      >
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {shortDate(transaction.date)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium">
            {displayName}
            {/* Marked, not hidden: a pending charge is real money the bank app
                already shows, so it counts in the figure -- the badge only says
                it may still move before the fatura closes. */}
            {transaction.pending ? (
              <span className="ml-1.5 align-middle rounded-full bg-warn-dim px-1.5 py-0.5 text-[0.65rem] font-medium text-warn">
                pendente
              </span>
            ) : null}
          </span>
          <span className="block text-xs text-text-faint">
            {account}
            {transaction.installment ? ` · parcela ${transaction.installment}` : null}
          </span>
        </span>
        <span className="shrink-0 font-mono text-sm tabular-nums">
          {brl(transaction.amountCents)}
        </span>
      </button>

      {open ? (
        // Bottom sheet on a phone, centred card on a wider screen: the reach on
        // mobile is the thumb, not the middle of the glass.
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Detalhes do lançamento"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-border bg-popover p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="break-words text-base font-semibold leading-snug">
                {displayName}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mb-5 font-mono text-2xl font-semibold tabular-nums">
              {brl(transaction.amountCents)}
            </div>

            <dl className="flex flex-col gap-2.5 text-sm">
              {transaction.pending ? (
                <DetailRow label="Situação" value="Pendente · ainda não fechada na fatura" />
              ) : null}
              {/* Only when a label is replacing it up top -- otherwise the
                  heading already IS the descriptor and repeating it is noise. */}
              {transaction.label ? (
                <DetailRow label="Descrição original" value={transaction.description} />
              ) : null}
              <DetailRow label="Data" value={fullDate(transaction.date)} />
              <DetailRow label="Conta" value={fullAccount} />
              <DetailRow label="Banco" value={transaction.institution} />
              {transaction.installment ? (
                <DetailRow label="Parcela" value={transaction.installment} />
              ) : null}
              <DetailRow label="Categoria" value={categoryName ?? 'A categorizar'} />
            </dl>
          </div>
        </div>
      ) : null}
    </>
  )
}
