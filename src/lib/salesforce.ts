// Mapping from our composed quote figures to the fields Salesforce asks for under
// "Payment Information". Specialists were being handed a single total and having to
// reverse-engineer the per-product split themselves, so the summary panel now shows
// each Salesforce field with the exact value to type in.
//
// Salesforce's own arithmetic is:
//   System total discounted price = Σ(product total prices) − System total STC value − Total value of other rebates
//   Balanced owed                 = System total discounted price − Deposit amount
// Those two are read-only formula fields over there, so everything we surface has to make
// that first equation hold against our own `total`. `variance` below is the guard.

export type SalesforceProductKey = 'solarBattery' | 'hwhp' | 'hvacSplit' | 'ducted' | 'waterFilter'

/** Field labels exactly as they read in Salesforce, so specialists can pattern-match down the form. */
export const SALESFORCE_FIELD_LABELS: Record<SalesforceProductKey, string> = {
  solarBattery: 'Solar/Battery total price',
  hwhp: 'HWHP total price',
  hvacSplit: 'HVAC Split System Total Price',
  ducted: 'Ducted System Total Price',
  waterFilter: 'Water Filter Total Price',
}

/** Order Salesforce lists them in, and the priority used to pick the line extras fall back to. */
const PRODUCT_ORDER: SalesforceProductKey[] = ['solarBattery', 'hwhp', 'hvacSplit', 'ducted', 'waterFilter']

// Extras carry a free-text category (and name), not a product foreign key, so attribution is by
// keyword. Order matters: "Ducted HVAC …" must land on `ducted` before the generic HVAC rule sees
// it, and the water-filter rule runs before the hot-water one so "Water Filter" isn't read as HWHP.
const EXTRA_ATTRIBUTION: { key: SalesforceProductKey; pattern: RegExp }[] = [
  { key: 'waterFilter', pattern: /water\s*filt|filtration|cartridge/i },
  { key: 'hwhp', pattern: /hwhp|heat\s*pump|hot\s*water/i },
  { key: 'ducted', pattern: /ducted/i },
  { key: 'hvacSplit', pattern: /hvac|split\s*system|air\s*con|aircon/i },
]

/** Which Salesforce product line an extra belongs to, or null when nothing matches. */
export function attributeExtra(category: string, name: string): SalesforceProductKey | null {
  const haystack = `${category} ${name}`
  return EXTRA_ATTRIBUTION.find(r => r.pattern.test(haystack))?.key ?? null
}

/** An extra as it lands on the quote — `amount` is the financed line total, not the unit price. */
export type BreakdownExtra = { category: string; name: string; amount: number }

export type BreakdownInput = {
  financeTerm: string
  /**
   * Gross price per product on the selected finance term, BEFORE STC and before extras.
   * Absent or 0 means the product isn't on this quote. Each page composes these from its own
   * discount model (standard / inbound / ASC) before handing them over.
   */
  products: Partial<Record<SalesforceProductKey, number>>
  extras: BreakdownExtra[]
  /** Combo and other rebates, as a positive number, on the selected finance term. */
  otherRebates: number
  /** The real STC value — never finance-uplifted, because Salesforce reports it as a rebate. */
  stcTotal: number
  /** Our after-STC total, i.e. Salesforce's "System total discounted price". */
  total: number
}

export type BreakdownRow = {
  key: SalesforceProductKey
  label: string
  /** Product price plus any extras attributed to it. This is the number to type into Salesforce. */
  amount: number
  extrasAmount: number
  extrasNames: string[]
}

export type SalesforceBreakdown = {
  paymentType: 'Cash' | 'BNPL'
  rows: BreakdownRow[]
  otherRebates: number
  stcTotal: number
  discountedPrice: number
  /**
   * How far the product lines are from reconciling with the quote total. Sub-cent rounding is
   * absorbed into the primary line and reported as 0; anything larger is a real disagreement
   * (e.g. the after-STC clamp kicking in) and the UI warns rather than quietly showing wrong numbers.
   */
  variance: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildSalesforceBreakdown(input: BreakdownInput): SalesforceBreakdown {
  const { products, extras, otherRebates, stcTotal, total, financeTerm } = input

  const present = PRODUCT_ORDER.filter(k => (products[k] ?? 0) > 0)
  // Extras-only quotes still need somewhere to put the money; Solar/Battery is the catch-all.
  const primary = present[0] ?? 'solarBattery'

  const buckets = new Map<SalesforceProductKey, { amount: number; extrasAmount: number; extrasNames: string[] }>()
  for (const key of present) {
    buckets.set(key, { amount: products[key] ?? 0, extrasAmount: 0, extrasNames: [] })
  }
  if (!buckets.has(primary)) buckets.set(primary, { amount: 0, extrasAmount: 0, extrasNames: [] })

  for (const extra of extras) {
    const matched = attributeExtra(extra.category, extra.name)
    // An extra can key to a product that isn't on this quote (an HWHP kit on a solar-only job) —
    // in that case it belongs to the primary line rather than conjuring an empty Salesforce field.
    const key = matched && buckets.has(matched) ? matched : primary
    const bucket = buckets.get(key)!
    bucket.amount += extra.amount
    bucket.extrasAmount += extra.amount
    bucket.extrasNames.push(extra.name)
  }

  const rows: BreakdownRow[] = PRODUCT_ORDER.filter(k => buckets.has(k)).map(key => {
    const b = buckets.get(key)!
    return {
      key,
      label: SALESFORCE_FIELD_LABELS[key],
      amount: round2(b.amount),
      extrasAmount: round2(b.extrasAmount),
      extrasNames: b.extrasNames,
    }
  })

  // Salesforce recomputes the discounted price from these lines, so they have to add up to ours.
  const expected = total + stcTotal + otherRebates
  const rawVariance = rows.reduce((s, r) => s + r.amount, 0) - expected
  if (Math.abs(rawVariance) < 0.05) {
    const primaryRow = rows.find(r => r.key === primary) ?? rows[0]
    if (primaryRow) primaryRow.amount = round2(primaryRow.amount - rawVariance)
  }

  return {
    paymentType: financeTerm === 'Cash' ? 'Cash' : 'BNPL',
    rows: rows.filter(r => r.amount !== 0),
    otherRebates: round2(otherRebates),
    stcTotal: round2(stcTotal),
    discountedPrice: round2(total),
    variance: Math.abs(rawVariance) < 0.05 ? 0 : round2(rawVariance),
  }
}
