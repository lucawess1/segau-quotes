import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type Package = {
  id: number
  package_code: string
  product_set: string
  brand: string
  battery_kwh: number | null
  panel_count: number | null
  system_size_kw: number | null
  battery_inverter: string | null
  battery_model: string | null
  pv_inverter: string | null
  panel_model: string | null
  specs: Record<string, any> | null
  inverter_phase: string | null
  inverter_paralleled: boolean | null
}

export type PriceVariant = {
  package_id: number
  territory: 'Metro' | 'Regional'
  zone: number
  finance_term: 'Cash' | '60m' | '84m'
  price_before_stc: number
  stc_discount: number
  price_after_stc: number
  fortnightly_repay: number | null
}

export type Extra = {
  id: number
  ref_code: string
  category: string
  name: string
  charge_type: 'Flat Fee' | 'Per Panel' | 'Variable' | 'QUOTED'
  unit_price: number
}