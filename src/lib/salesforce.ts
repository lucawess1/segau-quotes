// Mapping from our composed quote figures to the fields Salesforce asks for under
// "Payment Information". Specialists were being handed a single total and having to
// reverse-engineer the per-product split themselves, so the summary panel now shows
// each Salesforce field with the exact value to type in.
//
// Salesforce's own arithmetic is:
//   System total discounted price = Σ(product total prices) − System total STC value − Total value of other rebates
//   Balanced owed                 = System total discounted price − Deposit amount
// Those two are read-only formula fields over there. We leave "other rebates" at nothing and push
// the multi-product combo discount down into the product lines instead (see allocateComboDiscount),
// so the prices a specialist types already read as discounted. `variance` below guards the equation.

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

/**
 * Cash-basis share of the water-filter-with-HWHP combo that comes off the water filter line; the
 * HWHP line absorbs whatever is left (so today's $800 combo splits $500 / $300, and a reconfigured
 * combo still takes $500 off the filter).
 */
const WATER_FILTER_COMBO_SHARE = 500

/**
 * Where an extra goes when the keywords below don't attribute it to a product (and where a
 * sub-cent rounding residual is absorbed). Solar/Battery is the main amount field in Salesforce, so
 * it takes the catch-all even on a quote with no base package — an unrelated switchboard extra on
 * an HWHP-only job reads better there than inflating the HWHP product's own price.
 */
const EXTRAS_CATCH_ALL: SalesforceProductKey = 'solarBattery'

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

/**
 * Spread the multi-product combo discount across the lines that earned it, on the CASH basis
 * (the caller applies the finance uplift, so the split holds its shape on any term):
 *
 *   • water filter + HWHP — $500 off the filter, the remainder off the HWHP
 *   • HWHP, or water filter on its own — half off that line, the other half spread evenly
 *     across every other product line on the quote
 *
 * A share bigger than the line it lands on is clamped, and the shortfall moves to the largest
 * remaining line, so no product is ever quoted below zero.
 */
export function allocateComboDiscount(
  grossCash: Partial<Record<SalesforceProductKey, number>>,
  comboDiscount: number,
): Partial<Record<SalesforceProductKey, number>> {
  const present = PRODUCT_ORDER.filter(k => (grossCash[k] ?? 0) > 0)
  if (comboDiscount <= 0 || present.length === 0) return {}

  const shares = new Map<SalesforceProductKey, number>()
  const spread = (amount: number, keys: SalesforceProductKey[]) => {
    const each = amount / keys.length
    keys.forEach(k => shares.set(k, (shares.get(k) ?? 0) + each))
  }

  const hasHwhp = present.includes('hwhp')
  const hasWaterFilter = present.includes('waterFilter')

  if (hasHwhp && hasWaterFilter) {
    const filterShare = Math.min(WATER_FILTER_COMBO_SHARE, comboDiscount)
    shares.set('waterFilter', filterShare)
    shares.set('hwhp', comboDiscount - filterShare)
  } else {
    const anchor = hasHwhp ? 'hwhp' : hasWaterFilter ? 'waterFilter' : null
    const others = anchor ? present.filter(k => k !== anchor) : []
    if (!anchor || others.length === 0) {
      // Nothing earned a bigger share than anything else — split it evenly.
      spread(comboDiscount, present)
    } else {
      shares.set(anchor, comboDiscount / 2)
      spread(comboDiscount / 2, others)
    }
  }

  // Clamp any share that would take its line negative and move the shortfall to the biggest line.
  let shortfall = 0
  for (const [key, share] of shares) {
    const cap = grossCash[key] ?? 0
    if (share > cap) {
      shortfall += share - cap
      shares.set(key, cap)
    }
  }
  if (shortfall > 0) {
    const headroom = present
      .map(k => ({ k, room: (grossCash[k] ?? 0) - (shares.get(k) ?? 0) }))
      .filter(x => x.room > 0)
      .sort((a, b) => b.room - a.room)[0]
    if (headroom) shares.set(headroom.k, (shares.get(headroom.k) ?? 0) + Math.min(shortfall, headroom.room))
  }

  return Object.fromEntries(shares) as Partial<Record<SalesforceProductKey, number>>
}

/** An extra as it lands on the quote — `amount` is the financed line total, not the unit price. */
export type BreakdownExtra = { category: string; name: string; amount: number }

export type BreakdownInput = {
  financeTerm: string
  /** 0.80 for 60m, 0.70 for 84m, 1 for cash — used to put the combo discount on the cash basis. */
  financeMultiplier: number
  /**
   * Gross price per product on the selected finance term, BEFORE STC, before extras and before the
   * combo discount. Absent or 0 means the product isn't on this quote. Each page composes these
   * from its own discount model (standard / inbound / ASC) before handing them over.
   */
  products: Partial<Record<SalesforceProductKey, number>>
  extras: BreakdownExtra[]
  /** Multi-product combo discount on the CASH basis, as a positive number. */
  comboDiscount: number
  /** The real STC value — never finance-uplifted, because Salesforce reports it as a rebate. */
  stcTotal: number
  /** Our after-STC total, i.e. Salesforce's "System total discounted price". */
  total: number
}

export type BreakdownRow = {
  key: SalesforceProductKey
  label: string
  /** Product price plus its extras, less its share of the combo — the number to type into Salesforce. */
  amount: number
  extrasAmount: number
  extrasNames: string[]
}

export type SalesforceBreakdown = {
  paymentType: 'Cash' | 'BNPL'
  rows: BreakdownRow[]
  /** Sum of the product lines — what Salesforce subtracts the STC value from. */
  productsTotal: number
  stcTotal: number
  discountedPrice: number
  /**
   * How far the product lines are from reconciling with the quote total. Sub-cent rounding is
   * absorbed into the Solar/Battery line and reported as 0; anything larger is a real disagreement
   * (e.g. the after-STC clamp kicking in) and the UI warns rather than quietly showing wrong numbers.
   */
  variance: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildSalesforceBreakdown(input: BreakdownInput): SalesforceBreakdown {
  const { products, extras, comboDiscount, stcTotal, total, financeTerm, financeMultiplier } = input

  const present = PRODUCT_ORDER.filter(k => (products[k] ?? 0) > 0)

  // The combo is allocated against cash-basis line values so the $500 water-filter share keeps its
  // meaning on a BNPL term; each share is then uplifted the same way the line itself was.
  const grossCash = Object.fromEntries(present.map(k => [k, (products[k] ?? 0) * financeMultiplier]))
  const allocation = allocateComboDiscount(grossCash, comboDiscount)

  type Bucket = { amount: number; extrasAmount: number; extrasNames: string[] }
  const buckets = new Map<SalesforceProductKey, Bucket>()
  for (const key of present) {
    const combo = (allocation[key] ?? 0) / financeMultiplier
    buckets.set(key, { amount: (products[key] ?? 0) - combo, extrasAmount: 0, extrasNames: [] })
  }
  if (!buckets.has(EXTRAS_CATCH_ALL)) {
    buckets.set(EXTRAS_CATCH_ALL, { amount: 0, extrasAmount: 0, extrasNames: [] })
  }

  for (const extra of extras) {
    const matched = attributeExtra(extra.category, extra.name)
    // An extra can key to a product that isn't on this quote (an HWHP kit on a solar-only job);
    // that goes to the catch-all too rather than conjuring a Salesforce field for a product that
    // isn't being installed.
    const key = matched && buckets.has(matched) ? matched : EXTRAS_CATCH_ALL
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
  const expected = total + stcTotal
  const rawVariance = rows.reduce((s, r) => s + r.amount, 0) - expected
  if (Math.abs(rawVariance) < 0.05) {
    const catchAllRow = rows.find(r => r.key === EXTRAS_CATCH_ALL) ?? rows[0]
    if (catchAllRow) catchAllRow.amount = round2(catchAllRow.amount - rawVariance)
  }

  return {
    paymentType: financeTerm === 'Cash' ? 'Cash' : 'BNPL',
    // A product that's genuinely on the quote stays listed even if the combo discounted it to zero —
    // Salesforce wants a 0 there. Only the synthetic catch-all line (an extras-only quote with no
    // extras) is dropped for being empty.
    rows: rows.filter(r => r.amount !== 0 || present.includes(r.key)),
    productsTotal: round2(rows.reduce((s, r) => s + r.amount, 0)),
    stcTotal: round2(stcTotal),
    discountedPrice: round2(total),
    variance: Math.abs(rawVariance) < 0.05 ? 0 : round2(rawVariance),
  }
}
