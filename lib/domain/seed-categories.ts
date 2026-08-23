export type SeedCategory = { seedKey: string; name: string }

/**
 * The taxonomy a new household starts with. Flat by design (see spec): a
 * hierarchy would force every Slice 3 budget query to answer "does this roll
 * up?" for no benefit here.
 *
 * `seedKey` is the stable identity. Names are display text the household is
 * free to change; the Pluggy category map targets the key, never the name.
 * Array order is the initial `sort_order`.
 */
export const SEED_CATEGORIES: SeedCategory[] = [
  { seedKey: 'supermarket', name: 'Supermercado' },
  { seedKey: 'restaurants', name: 'Restaurantes' },
  { seedKey: 'delivery', name: 'Delivery' },
  { seedKey: 'transport', name: 'Transporte' },
  { seedKey: 'fuel', name: 'Combustível' },
  { seedKey: 'health', name: 'Saúde' },
  { seedKey: 'pharmacy', name: 'Farmácia' },
  { seedKey: 'home', name: 'Casa' },
  { seedKey: 'education', name: 'Educação' },
  { seedKey: 'leisure', name: 'Lazer' },
  { seedKey: 'clothing', name: 'Vestuário' },
  { seedKey: 'subscriptions', name: 'Assinaturas' },
  { seedKey: 'car-maintenance', name: 'Manutenção de carro' },
  { seedKey: 'pets', name: 'Pets' },
  { seedKey: 'other', name: 'Outros' },
]
