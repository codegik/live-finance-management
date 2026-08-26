import { ArrowRight } from 'lucide-react'
import { requireSession, toSignInOrThrow } from '@/lib/auth/session'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listCategories } from '@/lib/db/categories'
import { getDb } from '@/lib/db/client'
import { type ConnectionDetail, listConnectionDetails } from '@/lib/db/connections'
import { listRules } from '@/lib/db/rules'
import { CreateRuleForm, DeleteRuleForm } from './RuleForms'

export const dynamic = 'force-dynamic'

/**
 * The picker names each bank by its account(s), not by `institution`: that
 * column holds Pluggy's connector label ("MeuPluggy" for every sandbox item),
 * which does not tell one bank from another. The account name is the real
 * bank/account name the household recognizes. Institution is only a fallback
 * for a connection with no accounts yet, and a short id fragment breaks any
 * remaining tie so every option stays distinct.
 */
function bankOptions(connections: ConnectionDetail[]): { id: string; label: string }[] {
  const seen = new Set<string>()
  return connections.map((c) => {
    const names = c.accounts.map((a) => a.name).join(', ')
    let label = names || c.institution
    if (seen.has(label)) label = `${label} (${c.id.slice(0, 4)})`
    seen.add(label)
    return { id: c.id, label }
  })
}

export default async function RulesSettingsPage() {
  const session = await requireSession().catch(toSignInOrThrow)
  const db = getDb()
  const [rules, categories, connections] = await Promise.all([
    listRules(db, session.householdId),
    listCategories(db, session.householdId),
    listConnectionDetails(db, session.householdId),
  ])

  const options = bankOptions(connections)
  // The rule list shows the same friendly bank label the picker offers, keyed
  // by connection id, so a rule reads with the bank the household recognizes
  // rather than the raw "MeuPluggy" connector name stored on it.
  const bankLabelById = new Map(options.map((o) => [o.id, o.label]))

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Regras</h1>
        <p className="text-sm text-muted-foreground">
          Uma regra decide a categoria de um estabelecimento, hoje e no histórico.
        </p>
      </header>

      {/* The inbox only ever writes EXACT rules. This form is the only way a
          CONTAINS rule -- the thing that unifies branch variants of one
          merchant -- can be created. */}
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Nova regra</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateRuleForm
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            connections={options}
          />
        </CardContent>
      </Card>

      {rules.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">
          Nenhuma regra ainda. Categorize um estabelecimento em “A categorizar” para criar uma.
        </p>
      ) : (
        <Card className="rounded-xl">
          <CardContent className="pt-5">
            <ul className="flex flex-col divide-y divide-border">
              {rules.map((rule) => {
                const bankLabel = rule.connectionId ? bankLabelById.get(rule.connectionId) : null
                return (
                  <li
                    key={rule.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="outline">
                        {rule.matchType === 'EXACT' ? 'é' : 'contém'}
                      </Badge>
                      <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-foreground">
                        {rule.pattern}
                      </code>
                      {bankLabel ? <Badge variant="secondary">{bankLabel}</Badge> : null}
                      <ArrowRight className="size-3.5 text-text-faint" />
                      <span className="font-medium">{rule.categoryName}</span>
                    </div>
                    <DeleteRuleForm ruleId={rule.id} />
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
