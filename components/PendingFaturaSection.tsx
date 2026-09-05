import { Card } from '@/components/ui/card'
import { brl } from '@/lib/format'
import type { PendingFaturaLine } from '@/lib/views/faturas'

/**
 * The "spend on the way" block, shown below the category blocks on the month.
 *
 * When the household informs a fatura total the bank has not published yet (see
 * the Faturas screen), the gap between that figure and the transactions synced
 * so far is real spend that simply has not itemised. It is counted in Despesas
 * so the headline matches the real fatura; this block is where that money is
 * explained -- otherwise the total would climb with no row to point at.
 */
export function PendingFaturaSection({
  totalCents,
  lines,
}: {
  totalCents: number
  lines: PendingFaturaLine[]
}) {
  return (
    <Card className="overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border bg-surface-2/40 px-3 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span className="size-2 rounded-full bg-warn" aria-hidden="true" />
          Lançamentos a caminho
        </h2>
        <span className="font-mono text-sm font-semibold tabular-nums">{brl(totalCents)}</span>
        <p className="basis-full text-xs text-muted-foreground">
          Faturas que você informou e que os lançamentos ainda não detalham por completo. A diferença
          são compras já feitas que vão aparecer nos próximos dias.
        </p>
      </header>
      <ul className="list-none divide-y divide-border">
        {lines.map((line) => (
          <li
            key={line.accountId}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-[0.6rem]"
          >
            <span className="min-w-0 flex-1 text-[0.875rem]">{line.label}</span>
            <span className="font-mono text-[0.875rem] font-medium tabular-nums">
              {brl(line.diffCents)}
            </span>
            <span className="basis-full text-[0.74rem] text-text-faint">
              fatura informada {brl(line.overrideCents)} · sincronizado {brl(line.estimateCents)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
