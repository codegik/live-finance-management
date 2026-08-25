import type { categoryGroupEnum } from '@/lib/db/schema'

/** The block a category is totalled under on the month view. */
export type CategoryGroup = (typeof categoryGroupEnum.enumValues)[number]

export type SeedCategory = { seedKey: string; name: string; group: CategoryGroup }

/**
 * The order the blocks are drawn in, and the only place that order is
 * decided. It follows the sheet the household already keeps: what came in,
 * what was set aside, what was always going to be spent, what was chosen.
 *
 * TRANSFER is deliberately absent: it is not a block on the sheet. Its
 * categories hold money that was already counted where it was spent -- a
 * credit-card invoice payment, an own-account transfer -- so drawing it as a
 * block would either double-count it or invite the household to budget for it.
 * It exists only so a row can be filed OUT of every total while staying in the
 * ledger. See GROUP_BUDGET_ROLE and lib/views/month.ts.
 */
export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  'RECEITA',
  'INVESTIMENTO',
  'DESPESA_FIXA',
  'DESPESA_VARIAVEL',
]

export const CATEGORY_GROUP_LABELS: Record<CategoryGroup, string> = {
  RECEITA: 'Receita',
  INVESTIMENTO: 'Investimento',
  DESPESA_FIXA: 'Despesas fixas',
  DESPESA_VARIAVEL: 'Despesas variáveis',
  TRANSFER: 'Pagamentos de cartão',
}

/**
 * Which budget role a group's actuals are read from.
 *
 * RECEITA is the whole reason this mapping exists. Money arriving is stored
 * with `budget_role = 'INCOME'` and is excluded from every spend query by
 * design -- so a Receita category read from SPEND rows would always total
 * zero. See lib/views/month.ts, which also flips the sign: centavos are
 * positive for money out (lib/domain/money.ts), so income lands negative and
 * would otherwise render as -R$ 49.550,00.
 */
export const GROUP_BUDGET_ROLE: Record<CategoryGroup, 'SPEND' | 'INCOME' | 'TRANSFER'> = {
  RECEITA: 'INCOME',
  INVESTIMENTO: 'SPEND',
  DESPESA_FIXA: 'SPEND',
  DESPESA_VARIAVEL: 'SPEND',
  // A category the household files a fatura payment under. Its role is
  // TRANSFER, which every spend and income query excludes by design, so the
  // row leaves the totals the moment it is filed here -- while staying visible
  // in the ledger like any other. See lib/domain/budget-role.ts.
  TRANSFER: 'TRANSFER',
}

/**
 * Whether exceeding the plan is good news for this block.
 *
 * Earning more than planned and setting aside more than planned are wins;
 * spending more than planned is not. Without this every block would paint
 * "over" in red, and a household that beat its income target would open the
 * app to a screen full of alarm.
 */
export const MORE_IS_BETTER: Record<CategoryGroup, boolean> = {
  RECEITA: true,
  INVESTIMENTO: true,
  DESPESA_FIXA: false,
  DESPESA_VARIAVEL: false,
  // Never read: TRANSFER is not a drawn block, so no row in it reaches the
  // over/under paint. Present only to satisfy the exhaustive Record.
  TRANSFER: false,
}

/**
 * The multiplier that turns stored centavos into "bigger means more".
 *
 * Money out is stored positive and money in negative (lib/domain/money.ts),
 * so a Receita row read raw would render as -R$ 49.550,00. Every view flips
 * it through this one function rather than open-coding the sign, so the month
 * screen and the year grid cannot disagree about which way income points.
 */
export function actualSign(group: CategoryGroup): 1 | -1 {
  return GROUP_BUDGET_ROLE[group] === 'INCOME' ? -1 : 1
}

/**
 * Stored centavos as the household reads them: positive for more.
 *
 * The zero guard is not pedantry. `-0` is a real JavaScript value, `0 * -1`
 * produces it, and Intl formats it as "-R$ 0,00" -- so a household with no
 * income yet was told, on the headline figure of the screen, that it had
 * earned minus nothing.
 */
export function toActualCents(cents: number, group: CategoryGroup): number {
  const signed = cents * actualSign(group)
  return signed === 0 ? 0 : signed
}

/**
 * The taxonomy a new household starts with. Flat by design (see spec): a
 * hierarchy would force every Slice 3 budget query to answer "does this roll
 * up?" for no benefit here. `group` is a label for totalling, not a parent --
 * no query rolls a group up into another group.
 *
 * `seedKey` is the stable identity. Names are display text the household is
 * free to change; the Pluggy category map targets the key, never the name.
 * Array order is the initial `sort_order`.
 *
 * The Receita and Investimento keys are also created for pre-existing
 * households by drizzle/0011_category_group.sql. Adding a key here alone does
 * NOT reach a household that already exists -- seedCategories runs at setup.
 */
export const SEED_CATEGORIES: SeedCategory[] = [
  { seedKey: 'supermarket', name: 'Supermercado', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'restaurants', name: 'Restaurantes', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'delivery', name: 'Delivery', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'transport', name: 'Transporte', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'fuel', name: 'Combustível', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'health', name: 'Saúde', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'pharmacy', name: 'Farmácia', group: 'DESPESA_VARIAVEL' },
  // Housing is the household's largest fixed line -- rent, the parcela, the
  // utilities. Fixed, not variable.
  { seedKey: 'home', name: 'Casa', group: 'DESPESA_FIXA' },
  { seedKey: 'education', name: 'Educação', group: 'DESPESA_FIXA' },
  { seedKey: 'leisure', name: 'Lazer', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'clothing', name: 'Vestuário', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'subscriptions', name: 'Assinaturas', group: 'DESPESA_FIXA' },
  { seedKey: 'car-maintenance', name: 'Manutenção de carro', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'pets', name: 'Pets', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'other', name: 'Outros', group: 'DESPESA_VARIAVEL' },
  { seedKey: 'income-salary', name: 'Salário', group: 'RECEITA' },
  { seedKey: 'income-extra', name: 'Renda extra', group: 'RECEITA' },
  { seedKey: 'invest-portfolio', name: 'Carteira de investimento', group: 'INVESTIMENTO' },
  { seedKey: 'invest-pension', name: 'Previdência', group: 'INVESTIMENTO' },
  { seedKey: 'invest-emergency', name: 'Reserva de emergência', group: 'INVESTIMENTO' },
  // Not a spend line: a credit-card invoice paid from the checking account,
  // which the card's own purchases already account for. Filing a payment here
  // is how the household excludes it from Despesas without hiding it from the
  // ledger, and it works for a card Pluggy never linked -- the payment still
  // shows on the bank account. See lib/domain/budget-role.ts.
  { seedKey: 'card-payment', name: 'Pagamento de cartão', group: 'TRANSFER' },
]
