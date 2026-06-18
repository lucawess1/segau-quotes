'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Zap, User, LogOut, Save, X, Check, Info } from 'lucide-react'

const supabase = createClient()

type Profile = {
  id: string
  email: string
  role: 'specialist' | 'admin'
  full_name: string | null
  teams: string[]
}

type Battery = { id: number; code: string; brand: string; kwh: number; model: string | null; cost: number; active: boolean }
type Inverter = { id: number; code: string; brand: string; phase: string; model: string | null; cost: number; gateway_cost: number; emergency_backstop_cost: number; active: boolean }
type PV = { id: number; code: string; panel_model: string; panel_count: number; system_size_kw: number; cost: number; active: boolean }
type SolarStc = { system_size_kw: number; year: number; stc_value: number }
type BatteryStc = { battery_kwh: number; year: number; stc_value: number }
type BuilderCosts = { product_set: string; product_overhead: number; other_overhead: number; solar_base_install: number; solar_install_per_panel: number; battery_base_install: number; battery_install_per_kwh_over: number }
type BuilderConfig = { margin_min_pct: number; margin_max_pct: number; margin_default_pct: number; double_storey_per_panel: number; tile_per_panel: number; two_stage_cost: number; vic_ces_cost: number; regional_cost: number }
type SavedQuote = { id: string; quote_number: string; customer_name: string | null; user_id: string | null; created_at: string | null; total_price: number | null; builder_margin_pct: number | null }

const AU_STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const
type AuState = typeof AU_STATES[number]
const PRODUCT_SETS = ['Solar and Battery', 'Battery Only', 'Solar Only'] as const
type ProductSet = typeof PRODUCT_SETS[number]
const BATTERY_KWH_THRESHOLD_BASE = 15

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n)
}

function generateQuoteNumber(): string {
  const now = new Date()
  const pad = (x: number, n = 2) => String(x).padStart(n, '0')
  return `Q-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export default function BuilderQuoteBuilder() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [batteries, setBatteries] = useState<Battery[]>([])
  const [inverters, setInverters] = useState<Inverter[]>([])
  const [pvs, setPvs] = useState<PV[]>([])
  const [solarStcs, setSolarStcs] = useState<SolarStc[]>([])
  const [batteryStcs, setBatteryStcs] = useState<BatteryStc[]>([])
  const [costsByProductSet, setCostsByProductSet] = useState<Map<string, BuilderCosts>>(new Map())
  const [config, setConfig] = useState<BuilderConfig>({
    margin_min_pct: 15, margin_max_pct: 35, margin_default_pct: 20,
    double_storey_per_panel: 50, tile_per_panel: 50,
    two_stage_cost: 250, vic_ces_cost: 250, regional_cost: 500,
  })

  const currentYear = new Date().getFullYear()

  const [productSet, setProductSet] = useState<ProductSet>('Solar and Battery')
  const [batteryId, setBatteryId] = useState<number | null>(null)
  const [inverterId, setInverterId] = useState<number | null>(null)
  const [pvId, setPvId] = useState<number | null>(null)
  const [state, setState] = useState<AuState>('VIC')
  const [year, setYear] = useState<number>(currentYear)
  const [isParalleled, setIsParalleled] = useState(false)
  const [isDoubleStorey, setIsDoubleStorey] = useState(false)
  const [isTile, setIsTile] = useState(true)  // tile is default ON
  const [isTwoStage, setIsTwoStage] = useState(false)
  const [isRegional, setIsRegional] = useState(false)
  const [hasGateway, setHasGateway] = useState(false)
  const [hasEmergencyBackstop, setHasEmergencyBackstop] = useState(false)
  const [marginPct, setMarginPct] = useState<number>(20)

  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveNickname, setSaveNickname] = useState('')
  const [saveCustomerName, setSaveCustomerName] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedConfirmation, setSavedConfirmation] = useState<string | null>(null)
  const [recentQuotes, setRecentQuotes] = useState<SavedQuote[]>([])

  useEffect(() => {
    loadProfile()
    loadConfig()
    loadRecentQuotes()
  }, [])

  useEffect(() => {
    if (!profile) return
    if (!profile.teams?.includes('builder') && profile.role !== 'admin') return
    supabase.from('builder_batteries').select('*').eq('active', true).then(({ data }) => { if (data) setBatteries(data as Battery[]) })
    supabase.from('builder_inverters').select('*').eq('active', true).then(({ data }) => { if (data) setInverters(data as Inverter[]) })
    supabase.from('builder_pv').select('*').eq('active', true).then(({ data }) => { if (data) setPvs(data as PV[]) })
    supabase.from('builder_solar_stc').select('*').then(({ data }) => { if (data) setSolarStcs(data as SolarStc[]) })
    supabase.from('builder_battery_stc').select('*').then(({ data }) => { if (data) setBatteryStcs(data as BatteryStc[]) })
    supabase.from('builder_costs').select('*').then(({ data }) => {
      if (data) {
        const map = new Map<string, BuilderCosts>()
        for (const c of data as BuilderCosts[]) map.set(c.product_set, c)
        setCostsByProductSet(map)
      }
    })
  }, [profile])

  useEffect(() => {
    if (profile && !profile.teams?.includes('builder') && profile.role !== 'admin') {
      window.location.href = '/'
    }
  }, [profile])

  useEffect(() => { setMarginPct(config.margin_default_pct) }, [config.margin_default_pct])

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { window.location.href = '/login'; return }
    const { data } = await supabase.from('profiles').select('id, email, role, full_name, teams').eq('id', user.id).single()
    if (data) setProfile(data as Profile)
  }

  const loadConfig = async () => {
    const { data } = await supabase.from('builder_config').select('*').eq('id', 1).single()
    if (data) setConfig(data)
  }

  const loadRecentQuotes = async () => {
    const { data } = await supabase.from('quotes')
      .select('id, quote_number, customer_name, user_id, created_at, total_price, builder_margin_pct')
      .eq('is_builder_pricing', true)
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setRecentQuotes(data as SavedQuote[])
  }

  const includesBattery = productSet === 'Solar and Battery' || productSet === 'Battery Only'
  const includesSolar = productSet === 'Solar and Battery' || productSet === 'Solar Only'

  // Year picker: decimal years (2026, 2026.5, 2027, 2027.5, 2028, 2028.5) when battery is involved
  // Integer years only (2026, 2027, 2028) for Solar Only since solar STC is per whole year
  const yearOptions = useMemo(() => {
    const base = [currentYear, currentYear + 1, currentYear + 2]
    if (!includesBattery) return base
    return base.flatMap(y => [y, y + 0.5])
  }, [currentYear, includesBattery])

  // If product type changes to Solar Only while a .5 year is selected, snap down to the integer year
  useEffect(() => {
    if (!includesBattery && !Number.isInteger(year)) {
      setYear(Math.floor(year))
    }
  }, [includesBattery, year])

  // Auto-tick Emergency backstop when state is VIC (user can still untick it)
  // Only triggers when state CHANGES to VIC, not on every render — so user can untick after
  useEffect(() => {
    if (state === 'VIC') setHasEmergencyBackstop(true)
  }, [state])

  const selectedBattery = useMemo(() => batteries.find(b => b.id === batteryId) || null, [batteries, batteryId])
  const selectedInverter = useMemo(() => inverters.find(i => i.id === inverterId) || null, [inverters, inverterId])
  const selectedPv = useMemo(() => pvs.find(p => p.id === pvId) || null, [pvs, pvId])

  useEffect(() => {
    if (includesBattery && batteries.length > 0 && !selectedBattery) setBatteryId(batteries[0].id)
    if (!includesBattery) setBatteryId(null)
  }, [includesBattery, batteries, selectedBattery])

  useEffect(() => {
    if (includesBattery && inverters.length > 0 && !selectedInverter) setInverterId(inverters[0].id)
    if (!includesBattery) setInverterId(null)
  }, [includesBattery, inverters, selectedInverter])

  useEffect(() => {
    if (includesSolar && pvs.length > 0 && !selectedPv) setPvId(pvs[0].id)
    if (!includesSolar) setPvId(null)
  }, [includesSolar, pvs, selectedPv])

  // Battery > 30 kWh must be paralleled
  useEffect(() => {
    if (selectedBattery && selectedBattery.kwh > 30) setIsParalleled(true)
  }, [selectedBattery])

  const isParalleledLocked = selectedBattery ? selectedBattery.kwh > 30 : false
  const productCosts: BuilderCosts | null = costsByProductSet.get(productSet) ?? null

  const batteryCost = includesBattery && selectedBattery ? selectedBattery.cost : 0
  const inverterCost = includesBattery && selectedInverter ? selectedInverter.cost : 0
  const pvCost = includesSolar && selectedPv ? selectedPv.cost : 0
  const componentCost = batteryCost + inverterCost + pvCost

  const overheadCost = productCosts ? (productCosts.product_overhead + productCosts.other_overhead) : 0

  const parallelMultiplier = isParalleled ? 2 : 1
  const batteryKwhThreshold = BATTERY_KWH_THRESHOLD_BASE * parallelMultiplier

  const solarInstall = useMemo(() => {
    if (!includesSolar || !selectedPv || !productCosts) return 0
    return productCosts.solar_base_install + selectedPv.panel_count * productCosts.solar_install_per_panel
  }, [includesSolar, selectedPv, productCosts])

  const batteryInstall = useMemo(() => {
    if (!includesBattery || !selectedBattery || !productCosts) return 0
    const base = productCosts.battery_base_install * parallelMultiplier
    const overThreshold = Math.max(0, selectedBattery.kwh - batteryKwhThreshold)
    const variable = overThreshold * productCosts.battery_install_per_kwh_over
    return base + variable
  }, [includesBattery, selectedBattery, productCosts, parallelMultiplier, batteryKwhThreshold])

  const panelCount = includesSolar && selectedPv ? selectedPv.panel_count : 0
  const adderDoubleStorey = isDoubleStorey ? panelCount * config.double_storey_per_panel : 0
  const adderTile = isTile && includesSolar ? panelCount * config.tile_per_panel : 0
  const adderTwoStage = isTwoStage ? config.two_stage_cost : 0
  const adderRegional = isRegional ? config.regional_cost : 0
  const adderGateway = hasGateway && includesBattery && selectedInverter ? selectedInverter.gateway_cost : 0
  const adderEmergencyBackstop = hasEmergencyBackstop && includesBattery && selectedInverter ? selectedInverter.emergency_backstop_cost : 0
  const adderVic = state === 'VIC' ? config.vic_ces_cost : 0
  const totalAdders = adderDoubleStorey + adderTile + adderTwoStage + adderRegional + adderGateway + adderEmergencyBackstop + adderVic

  const totalCost = componentCost + overheadCost + solarInstall + batteryInstall + totalAdders
  const revenue = totalCost > 0 && marginPct < 100 ? totalCost / (1 - marginPct / 100) : 0

  const solarStc = useMemo(() => {
    if (!includesSolar || !selectedPv) return 0
    // Solar STC is keyed by integer year only (no half-year solar STC values exist).
    // If user picked 2027.5, use 2027 for the solar lookup.
    const solarYear = Math.floor(year)
    const entry = solarStcs.find(s => s.system_size_kw === selectedPv.system_size_kw && s.year === solarYear)
    return entry?.stc_value ?? 0
  }, [includesSolar, selectedPv, solarStcs, year])

  const batteryStc = useMemo(() => {
    if (!includesBattery || !selectedBattery) return 0
    // Battery STC can be a half-year (e.g. 2027.5) so we use the exact year.
    const entry = batteryStcs.find(s => s.battery_kwh === selectedBattery.kwh && s.year === year)
    return entry?.stc_value ?? 0
  }, [includesBattery, selectedBattery, batteryStcs, year])

  const totalStc = solarStc + batteryStc
  // PRICING MODEL:
  // - Builder needs revenue_ex_GST = total_cost / (1 - margin%) to hit their margin target
  // - GST (10%) is applied to that revenue to get the inc-GST headline price
  // - STC is subtracted from the inc-GST price as a flat dollar rebate
  // Formula: customer_RRP = (revenue_ex_GST × 1.1) − total_STC
  // As STC decreases over the years, customer RRP increases. Builder margin stays the same.
  const GST_MULTIPLIER = 1.1
  const revenueIncGst = revenue * GST_MULTIPLIER
  const priceAfter = Math.max(0, revenueIncGst - totalStc)   // what customer pays (incl GST, STC subtracted as flat $)
  const priceBefore = revenueIncGst                          // headline before-STC (incl GST)

  const availableBrands = useMemo(() => Array.from(new Set(batteries.map(b => b.brand))), [batteries])
  const availableInverters = useMemo(() => {
    if (!includesBattery || !selectedBattery || availableBrands.length <= 1) return inverters
    return inverters.filter(i => i.brand === selectedBattery.brand)
  }, [includesBattery, selectedBattery, inverters, availableBrands])

  useEffect(() => {
    if (includesBattery && availableInverters.length > 0 && selectedInverter &&
        !availableInverters.some(i => i.id === selectedInverter.id)) {
      setInverterId(availableInverters[0].id)
    }
  }, [includesBattery, availableInverters, selectedInverter])

  const saveQuote = async () => {
    if (!profile) return
    setSaving(true)
    const quoteNumber = generateQuoteNumber()
    const { data, error } = await supabase.from('quotes').insert({
      quote_number: quoteNumber,
      nickname: saveNickname.trim() || null,
      customer_name: saveCustomerName.trim() || null,
      user_id: profile.id,
      package_id: null,
      product_set: productSet,
      brand: includesBattery && selectedBattery ? selectedBattery.brand : null,
      battery_kwh: includesBattery && selectedBattery ? selectedBattery.kwh : null,
      panel_count: includesSolar && selectedPv ? selectedPv.panel_count : null,
      inverter_phase: includesBattery && selectedInverter ? selectedInverter.phase : null,
      inverter_paralleled: includesBattery ? isParalleled : null,
      territory: isRegional ? 'Regional' : 'Metro',
      zone: 4,
      finance_term: 'Cash',
      base_price: priceBefore,
      stc_discount: totalStc,
      extras_total: 0,
      total_price: priceAfter,
      status: 'draft',
      is_builder_pricing: true,
      builder_margin_pct: marginPct,
      builder_year: year,
      builder_options: {
        state, is_paralleled: isParalleled,
        double_storey: isDoubleStorey, tile: isTile, two_stage: isTwoStage, regional: isRegional, gateway: hasGateway, emergency_backstop: hasEmergencyBackstop,
        selected: {
          battery_id: batteryId, battery_code: selectedBattery?.code,
          inverter_id: inverterId, inverter_code: selectedInverter?.code,
          pv_id: pvId, pv_code: selectedPv?.code,
        },
        breakdown: {
          components: componentCost, overhead: overheadCost,
          solar_install: solarInstall, battery_install: batteryInstall,
          adders: totalAdders, total_cost: totalCost, revenue: revenue,
          solar_stc: solarStc, battery_stc: batteryStc,
        },
      },
    }).select('quote_number').single()
    setSaving(false)
    if (error) { console.error(error); return }
    setShowSaveDialog(false)
    setSaveNickname('')
    setSaveCustomerName('')
    setSavedConfirmation(data.quote_number)
    setTimeout(() => setSavedConfirmation(null), 4000)
    loadRecentQuotes()
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  if (!profile) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
  }

  const canShowPrice = (includesBattery ? !!selectedBattery && !!selectedInverter : true) && (includesSolar ? !!selectedPv : true)

  return (
    <div className="min-h-screen bg-indigo-50/30 dark:bg-indigo-950/10">
      <div className="h-1.5 bg-indigo-500 dark:bg-indigo-600 w-full" />
      <main className="max-w-5xl mx-auto p-3 md:p-6 pb-24 md:pb-6">
        <div className="mb-4 px-4 py-3 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 border-2 border-indigo-300 dark:border-indigo-700 flex items-center gap-2.5">
          <div className="bg-indigo-500 dark:bg-indigo-600 rounded-full p-1 flex-shrink-0">
            <Info className="w-3.5 h-3.5 text-white" />
          </div>
          <p className="text-sm text-indigo-900 dark:text-indigo-200 flex-1">
            <span className="font-semibold">BUILDER UPGRADE PRICING</span>
            <span className="hidden sm:inline"> — cost + margin pricing for upgrade calls.</span>
            <a href="/" className="ml-2 underline font-medium hover:no-underline">Switch to standard</a>
          </p>
        </div>

        <header className="flex items-center justify-between pb-3 mb-4 md:mb-5 border-b-2 border-indigo-300 dark:border-indigo-700 gap-2">
          <div className="flex items-center gap-2 md:gap-2.5 min-w-0">
            <Zap className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
            <div className="min-w-0 flex items-center gap-2">
              <p className="font-medium text-sm md:text-[15px] truncate">SEG Pricing Builder</p>
              <span className="text-[10px] uppercase tracking-wider font-bold bg-indigo-500 dark:bg-indigo-600 text-white px-2 py-0.5 rounded">Builder</span>
            </div>
          </div>
          <div className="flex items-center gap-1 md:gap-3 flex-shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 max-w-[120px] md:max-w-none">
              <User className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">
                {profile?.full_name?.split(' ')[0] || profile?.email?.split('@')[0] || '…'}
                {profile?.role === 'admin' && (
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">Admin</span>
                )}
              </span>
            </div>
            <button onClick={signOut} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1.5 md:px-2 md:py-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded" aria-label="Sign out">
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Sign out</span>
            </button>
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-4 md:gap-5">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 md:p-5">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">1. System</p>
            <div className="space-y-3.5">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Product type</label>
                <select value={productSet} onChange={e => setProductSet(e.target.value as ProductSet)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500">
                  {PRODUCT_SETS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              {includesBattery && (
                <>
                  <ComponentSelector label="Battery" value={batteryId} onChange={setBatteryId}
                    options={batteries.map(b => ({ id: b.id, label: `${b.brand} ${b.kwh} kWh — ${b.model || b.code}`, cost: b.cost }))}
                    emptyHint="No batteries configured" />
                  <ComponentSelector label="Inverter" value={inverterId} onChange={setInverterId}
                    options={availableInverters.map(i => ({ id: i.id, label: `${i.code} (${i.phase})`, cost: i.cost }))}
                    emptyHint="No inverters configured" />
                </>
              )}

              {includesSolar && (
                <ComponentSelector label="PV (size · panel count)" value={pvId} onChange={setPvId}
                  options={pvs.map(p => ({ id: p.id, label: `${p.system_size_kw} kW · ${p.panel_count} panels`, cost: p.cost }))}
                  emptyHint="No PV options configured" />
              )}

              {includesBattery && selectedBattery && (
                <div className="pt-2">
                  <label className={`flex items-center gap-2 ${isParalleledLocked ? 'opacity-60' : 'cursor-pointer'}`}>
                    <input type="checkbox" checked={isParalleled} onChange={e => setIsParalleled(e.target.checked)} disabled={isParalleledLocked} className="w-4 h-4" />
                    <span className="text-sm flex-1">
                      Inverter paralleled (×2)
                      {isParalleledLocked && (<span className="text-xs text-gray-500 dark:text-gray-400 ml-1.5">(required for &gt;30 kWh)</span>)}
                    </span>
                  </label>
                </div>
              )}

              <div className="border-t border-gray-200 dark:border-gray-700 pt-3.5">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">2. Site &amp; timing</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">State</label>
                    <select value={state} onChange={e => setState(e.target.value as AuState)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500">
                      {AU_STATES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Year sold</label>
                    <select value={year} onChange={e => setYear(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500">
                      {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-3.5">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">3. Site options</p>
                <div className="space-y-2">
                  <CheckOption label="Double storey" checked={isDoubleStorey} onChange={setIsDoubleStorey} addCost={adderDoubleStorey} hint={includesSolar ? `${panelCount} panels × ${formatCurrency(config.double_storey_per_panel)}` : 'requires PV'} disabled={!includesSolar} />
                  <CheckOption label="Tile roof" checked={isTile} onChange={setIsTile} addCost={adderTile} hint={includesSolar ? `${panelCount} panels × ${formatCurrency(config.tile_per_panel)}` : 'requires PV'} disabled={!includesSolar} />
                  <CheckOption label="2-stage install" checked={isTwoStage} onChange={setIsTwoStage} addCost={adderTwoStage} />
                  <CheckOption label="Regional install" checked={isRegional} onChange={setIsRegional} addCost={adderRegional} />
                  <CheckOption label="Gateway required" checked={hasGateway} onChange={setHasGateway} addCost={adderGateway} hint={includesBattery && selectedInverter ? '' : 'requires battery'} disabled={!includesBattery || !selectedInverter} />
                  <CheckOption label="Emergency backstop" checked={hasEmergencyBackstop} onChange={setHasEmergencyBackstop} addCost={adderEmergencyBackstop} hint={includesBattery && selectedInverter ? (state === 'VIC' ? 'auto-ticked for VIC' : '') : 'requires battery'} disabled={!includesBattery || !selectedInverter} />
                  {state === 'VIC' && config.vic_ces_cost > 0 && (
                    <div className="flex items-center gap-2 pt-1 text-xs text-gray-500 dark:text-gray-400">
                      <span className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 rounded text-[10px] font-medium">AUTO</span>
                      <span>VIC CES: <span className="text-gray-900 dark:text-gray-100 font-medium">+{formatCurrency(config.vic_ces_cost)}</span></span>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-3.5">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">4. Margin</p>
                <div className="grid grid-cols-5 gap-1">
                  {[15, 20, 25, 30, 35].map(m => (
                    <button key={m} onClick={() => setMarginPct(m)}
                      className={`px-2 py-2 text-sm border rounded-md tabular-nums font-medium ${marginPct === m ? 'bg-indigo-600 dark:bg-indigo-500 text-white border-indigo-600 dark:border-indigo-500' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                      {m}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 md:p-5">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Quote summary</p>
            {!canShowPrice ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic">Select all required components to see pricing.</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm text-gray-700 dark:text-gray-300">Customer price</p>
                  <p className="text-2xl font-medium tabular-nums">{formatCurrency(priceAfter)}</p>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Incl. GST · cash · {marginPct}% margin</p>

                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs space-y-1">
                  <div className="flex justify-between text-gray-500 dark:text-gray-400">
                    <span>Before STC ({year})</span>
                    <span className="tabular-nums">{formatCurrency(priceBefore)}</span>
                  </div>
                  {includesSolar && (
                    <div className="flex justify-between text-gray-500 dark:text-gray-400">
                      <span>Solar STC ({Math.floor(year)})</span>
                      <span className="tabular-nums text-green-700 dark:text-green-400">−{formatCurrency(solarStc)}</span>
                    </div>
                  )}
                  {includesBattery && (
                    <div className="flex justify-between text-gray-500 dark:text-gray-400">
                      <span>Battery STC ({year})</span>
                      <span className="tabular-nums text-green-700 dark:text-green-400">−{formatCurrency(batteryStc)}</span>
                    </div>
                  )}
                </div>

                {totalStc === 0 && (includesSolar || includesBattery) && (
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 italic">No STC values configured for this configuration in {year}.</p>
                )}

                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Component breakdown</p>
                  <div className="text-sm space-y-1">
                    {includesBattery && selectedBattery && (
                      <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Battery</span><span>{selectedBattery.brand} {selectedBattery.kwh} kWh</span></div>
                    )}
                    {includesBattery && selectedInverter && (
                      <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Inverter</span><span>{selectedInverter.code} ({selectedInverter.phase})</span></div>
                    )}
                    {includesSolar && selectedPv && (
                      <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">PV</span><span>{selectedPv.system_size_kw} kW · {selectedPv.panel_count} panels</span></div>
                    )}
                  </div>
                </div>

                {profile?.role === 'admin' && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-[10px] uppercase tracking-wider font-medium text-gray-400 dark:text-gray-500 mb-2">Admin cost breakdown</p>
                    <div className="text-xs space-y-0.5">
                      <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Components</span><span className="tabular-nums">{formatCurrency(componentCost)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Overhead</span><span className="tabular-nums">{formatCurrency(overheadCost)}</span></div>
                      {includesSolar && solarInstall > 0 && (
                        <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Solar install</span><span className="tabular-nums">{formatCurrency(solarInstall)}</span></div>
                      )}
                      {includesBattery && batteryInstall > 0 && (
                        <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Battery install{isParalleled ? ' (×2)' : ''}</span><span className="tabular-nums">{formatCurrency(batteryInstall)}</span></div>
                      )}
                      {totalAdders > 0 && (
                        <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Site adders</span><span className="tabular-nums">{formatCurrency(totalAdders)}</span></div>
                      )}
                      <div className="flex justify-between border-t border-gray-100 dark:border-gray-800 pt-1 mt-1"><span className="text-gray-700 dark:text-gray-300">Total cost</span><span className="tabular-nums font-medium">{formatCurrency(totalCost)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Margin ({marginPct}%)</span><span className="tabular-nums text-indigo-700 dark:text-indigo-400">+{formatCurrency(revenue - totalCost)}</span></div>
                    </div>
                  </div>
                )}

                <button onClick={() => setShowSaveDialog(true)} className="mt-4 hidden md:flex w-full py-2 text-sm border rounded-md items-center justify-center gap-1.5 bg-indigo-600 dark:bg-indigo-500 text-white border-indigo-600 dark:border-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-600">
                  <Save className="w-3.5 h-3.5" /> Save quote
                </button>
                {savedConfirmation && (
                  <div className="mt-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 rounded-md px-2.5 py-1.5 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 flex-shrink-0" />
                    Saved as <code className="font-mono">{savedConfirmation}</code>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-5 md:mt-6">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            {profile?.role === 'admin' ? 'Recent builder quotes (last 20)' : 'Your recent builder quotes (last 20)'}
          </p>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            {recentQuotes.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic p-4 text-center">No saved quotes yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="text-left px-3 py-2 font-normal">Quote</th>
                    <th className="text-left px-3 py-2 font-normal">Customer</th>
                    <th className="text-right px-3 py-2 font-normal">Margin</th>
                    <th className="text-right px-3 py-2 font-normal">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentQuotes.map(q => (
                    <tr key={q.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-2 font-mono text-xs">{q.quote_number}</td>
                      <td className="px-3 py-2">{q.customer_name || <span className="text-gray-400 dark:text-gray-500">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{q.builder_margin_pct ? `${q.builder_margin_pct}%` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{q.total_price ? formatCurrency(q.total_price) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !saving && setShowSaveDialog(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium">Save builder quote</p>
              <button onClick={() => !saving && setShowSaveDialog(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Customer name (optional)</label>
                <input type="text" value={saveCustomerName} onChange={e => setSaveCustomerName(e.target.value)} placeholder="e.g. Jane Smith" className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500" autoFocus />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Nickname / note (optional)</label>
                <input type="text" value={saveNickname} onChange={e => setSaveNickname(e.target.value)} placeholder="e.g. builder X upgrade" className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowSaveDialog(false)} disabled={saving} className="flex-1 py-2.5 md:py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">Cancel</button>
                <button onClick={saveQuote} disabled={saving} className="flex-1 py-2.5 md:py-2 text-sm bg-indigo-600 dark:bg-indigo-500 text-white rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-50">{saving ? 'Saving…' : 'Save quote'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 md:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-3 py-2.5 flex items-center gap-3 shadow-lg z-40">
        <div className="flex-1 min-w-0">
          {canShowPrice ? (
            <>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">Customer price (incl. GST) · {marginPct}% margin</p>
              <p className="text-lg font-medium leading-tight tabular-nums">{formatCurrency(priceAfter)}</p>
            </>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">Select components</p>
          )}
        </div>
        <button onClick={() => setShowSaveDialog(true)} disabled={!canShowPrice} className="px-4 py-2.5 bg-indigo-600 dark:bg-indigo-500 text-white rounded-md text-sm font-medium disabled:opacity-40 flex items-center gap-1.5 min-h-[44px]">
          <Save className="w-4 h-4" />
          Save
        </button>
      </div>
    </div>
  )
}

function ComponentSelector({ label, value, onChange, options, emptyHint }: {
  label: string
  value: number | null
  onChange: (id: number) => void
  options: { id: number; label: string; cost: number }[]
  emptyHint: string
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{label}</label>
      <div className="flex items-center gap-2">
        <select value={value ?? ''} onChange={e => onChange(Number(e.target.value))} disabled={options.length === 0}
          className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500">
          {options.length === 0 ? <option>{emptyHint}</option> : options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[70px] text-right tabular-nums">
          {(() => {
            const selected = options.find(o => o.id === value)
            return selected ? formatCurrency(selected.cost) : '—'
          })()}
        </span>
      </div>
    </div>
  )
}

function CheckOption({ label, checked, onChange, addCost, hint, disabled }: {
  label: string
  checked: boolean
  onChange: (b: boolean) => void
  addCost: number
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={e => onChange(e.target.checked)} className="w-4 h-4" />
      <span className="text-sm flex-1">
        {label}
        {hint && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5">({hint})</span>}
      </span>
      {checked && !disabled && addCost > 0 && (
        <span className="text-xs text-indigo-700 dark:text-indigo-400 font-medium tabular-nums">+{formatCurrency(addCost)}</span>
      )}
    </label>
  )
}
