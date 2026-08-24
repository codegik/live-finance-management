/**
 * The shape of a household year, as figures rather than as rows.
 *
 * Kept apart from the writer so the numbers can be read and argued with on
 * their own. They are modelled on the spreadsheet this app replaces: a fixed
 * salary with occasional extra income, a small monthly pension contribution,
 * a large housing instalment, and variable spending that actually varies.
 */

/** One spending or earning habit, and what it costs in a month. */
export type DemoLine = {
  /** The category this lands on, by its stable seed key. */
  seedKey: string
  /** Median centavos per month. 0 means the line is occasional only. */
  medianCents: number
  /** How far a month may swing from the median, as a fraction. */
  spread: number
  /** Roughly how many separate purchases make up a month of this line. */
  perMonth: number
  account: 'CARD' | 'BANK'
  /**
   * The Pluggy category string stamped on the row, so the demo exercises the
   * real categorisation path (lib/domain/pluggy-categories.ts) rather than
   * assigning ids behind its back. Null where Pluggy has no string for the
   * line -- investments, chiefly -- and the row is assigned directly.
   */
  pluggyCategory: string | null
  /** Descriptors to draw from, so the ledger reads like a real statement. */
  merchants: string[]
}

export const DEMO_INCOME: DemoLine[] = [
  {
    seedKey: 'income-salary',
    medianCents: 49_550_00,
    spread: 0.04,
    perMonth: 1,
    account: 'BANK',
    pluggyCategory: 'Salary',
    merchants: ['SALARIO MENSAL'],
  },
  {
    // The sheet's "Extra" row: nothing most months, then a large one.
    seedKey: 'income-extra',
    medianCents: 0,
    spread: 0,
    perMonth: 0,
    account: 'BANK',
    pluggyCategory: null,
    merchants: ['PLR', 'BONUS ANUAL', 'VENDA EQUIPAMENTO'],
  },
]

export const DEMO_INVESTMENTS: DemoLine[] = [
  {
    seedKey: 'invest-pension',
    medianCents: 300_00,
    spread: 0,
    perMonth: 1,
    account: 'BANK',
    pluggyCategory: null,
    merchants: ['PREVIDENCIA PRIVADA'],
  },
  {
    seedKey: 'invest-emergency',
    medianCents: 0,
    spread: 0,
    perMonth: 0,
    account: 'BANK',
    pluggyCategory: null,
    merchants: ['APLICACAO RESERVA'],
  },
  {
    seedKey: 'invest-portfolio',
    medianCents: 0,
    spread: 0,
    perMonth: 0,
    account: 'BANK',
    pluggyCategory: null,
    merchants: ['APLICACAO CARTEIRA'],
  },
]

export const DEMO_FIXED: DemoLine[] = [
  {
    seedKey: 'home',
    medianCents: 6_900_00,
    spread: 0,
    perMonth: 1,
    account: 'BANK',
    pluggyCategory: 'Rent',
    merchants: ['PARCELA CASA'],
  },
  {
    seedKey: 'home',
    medianCents: 1_200_00,
    spread: 0.18,
    perMonth: 3,
    account: 'BANK',
    pluggyCategory: 'Housing',
    merchants: ['CEMIG ENERGIA', 'COPASA AGUA', 'VIVO FIBRA'],
  },
  {
    seedKey: 'education',
    medianCents: 1_045_00,
    spread: 0.1,
    perMonth: 2,
    account: 'CARD',
    pluggyCategory: 'School',
    merchants: ['ESCOLA INFANTIL', 'INGLES KUMON'],
  },
  {
    seedKey: 'subscriptions',
    medianCents: 258_00,
    spread: 0.25,
    perMonth: 4,
    account: 'CARD',
    pluggyCategory: 'Digital services',
    merchants: ['NETFLIX.COM', 'SPOTIFY', 'ICLOUD', 'AMAZON PRIME'],
  },
]

export const DEMO_VARIABLE: DemoLine[] = [
  {
    seedKey: 'supermarket',
    medianCents: 3_468_00,
    spread: 0.3,
    perMonth: 9,
    account: 'CARD',
    pluggyCategory: 'Groceries',
    merchants: ['ZAFFARI', 'CARREFOUR', 'ASSAI ATACADISTA', 'HORTIFRUTI'],
  },
  {
    seedKey: 'restaurants',
    medianCents: 2_160_00,
    spread: 0.35,
    perMonth: 8,
    account: 'CARD',
    pluggyCategory: 'Eating out',
    merchants: ['OUTBACK', 'COCO BAMBU', 'PADARIA BELLA', 'CAFE CULTURA'],
  },
  {
    seedKey: 'delivery',
    medianCents: 420_00,
    spread: 0.5,
    perMonth: 4,
    account: 'CARD',
    pluggyCategory: 'Food delivery',
    merchants: ['IFOOD', 'RAPPI'],
  },
  {
    seedKey: 'transport',
    medianCents: 380_00,
    spread: 0.45,
    perMonth: 7,
    account: 'CARD',
    pluggyCategory: 'Taxi and ride-hailing',
    merchants: ['UBER', '99 TAXI'],
  },
  {
    seedKey: 'fuel',
    medianCents: 1_129_00,
    spread: 0.25,
    perMonth: 3,
    account: 'CARD',
    pluggyCategory: 'Gas stations',
    merchants: ['POSTO IPIRANGA', 'SHELL SELECT'],
  },
  {
    seedKey: 'health',
    medianCents: 900_00,
    spread: 0.3,
    perMonth: 2,
    account: 'CARD',
    pluggyCategory: 'Healthcare',
    merchants: ['PLANO DE SAUDE', 'CLINICA ODONTO'],
  },
  {
    seedKey: 'pharmacy',
    medianCents: 544_00,
    spread: 0.6,
    perMonth: 3,
    account: 'CARD',
    pluggyCategory: 'Pharmacy',
    merchants: ['DROGASIL', 'PANVEL', 'RAIA'],
  },
  {
    seedKey: 'leisure',
    medianCents: 1_637_00,
    spread: 0.7,
    perMonth: 4,
    account: 'CARD',
    pluggyCategory: 'Leisure',
    merchants: ['CINEMARK', 'DECOLAR VIAGENS', 'INGRESSO.COM', 'AIRBNB'],
  },
  {
    seedKey: 'clothing',
    medianCents: 319_00,
    spread: 0.8,
    perMonth: 2,
    account: 'CARD',
    pluggyCategory: 'Clothing',
    merchants: ['RENNER', 'ZARA', 'CENTAURO'],
  },
  {
    seedKey: 'pets',
    medianCents: 180_00,
    spread: 0.5,
    perMonth: 2,
    account: 'CARD',
    pluggyCategory: 'Pet supplies and vet',
    merchants: ['PETZ', 'CLINICA VET AMIGO'],
  },
  {
    seedKey: 'other',
    medianCents: 1_668_00,
    spread: 0.4,
    perMonth: 5,
    account: 'CARD',
    pluggyCategory: 'Shopping',
    merchants: ['AMAZON.COM.BR', 'MERCADO LIVRE', 'LEROY MERLIN'],
  },
]

/**
 * Descriptors deliberately left uncategorizable, so /inbox has real work in
 * it. Every string here is absent from PLUGGY_CATEGORY_TO_SEED_KEY, which is
 * exactly what sends a row to the inbox in production.
 */
export const DEMO_UNCATEGORIZED = [
  'PAG*JOAODASILVA',
  'MP *LOJADOCENTRO',
  'PICPAY *SERVICOS',
  'COPA ECOM ROW I PANAMAPAN',
]

/**
 * An instalment plan: money already committed to months that have not
 * happened yet.
 *
 * Without at least one of these, "Comprometido" is empty and the pace
 * calculation has nothing to exercise -- and both exist precisely to handle
 * this case, so a demo without them hides the two features hardest to get
 * right.
 */
export const DEMO_INSTALMENTS = [
  {
    seedKey: 'car-maintenance',
    merchant: 'AUTO MECANICA BOA',
    pluggyCategory: 'Vehicle maintenance',
    totalCents: 11_470_90,
    count: 10,
    /** Months back from the current one that instalment 1 was charged. */
    startedMonthsAgo: 4,
  },
  {
    seedKey: 'other',
    merchant: 'FAST SHOP NOTEBOOK',
    pluggyCategory: 'Electronics',
    totalCents: 7_200_00,
    count: 12,
    startedMonthsAgo: 7,
  },
]

/**
 * Extra income, by how many months back from the current one it landed, so
 * the Receita block is not a flat line and the year grid has something to
 * compare across columns.
 */
export const DEMO_EXTRA_INCOME: { monthsAgo: number; cents: number; merchant: string }[] = [
  { monthsAgo: 1, cents: 12_000_00, merchant: 'BONUS ANUAL' },
  { monthsAgo: 2, cents: 27_000_00, merchant: 'PLR' },
  { monthsAgo: 8, cents: 5_000_00, merchant: 'VENDA EQUIPAMENTO' },
  { monthsAgo: 14, cents: 18_000_00, merchant: 'PLR' },
]

/** Lump investments, same idea: an occasional large transfer, not a trickle. */
export const DEMO_LUMP_INVESTMENTS: {
  monthsAgo: number
  seedKey: string
  cents: number
  merchant: string
}[] = [
  { monthsAgo: 0, seedKey: 'invest-emergency', cents: 5_000_00, merchant: 'APLICACAO RESERVA' },
  { monthsAgo: 1, seedKey: 'invest-portfolio', cents: 3_000_00, merchant: 'APLICACAO CARTEIRA' },
  { monthsAgo: 2, seedKey: 'invest-emergency', cents: 17_000_00, merchant: 'APLICACAO RESERVA' },
  { monthsAgo: 5, seedKey: 'invest-emergency', cents: 5_000_00, merchant: 'APLICACAO RESERVA' },
  { monthsAgo: 9, seedKey: 'invest-portfolio', cents: 9_000_00, merchant: 'APLICACAO CARTEIRA' },
]
