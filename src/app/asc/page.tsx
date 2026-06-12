'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Package, PriceVariant, Extra } from '@/lib/supabase'
import { Zap, User, Plus, X, Save, Info, Check, History, LogOut } from 'lucide-react'

// Single Supabase client instance for this module
const supabase = createClient()

type QuoteExtra = Extra & { instanceId: string }

type Profile = {
  id: string
  email: string
  role: 'specialist' | 'admin'
  full_name: string | null
  teams: string[]
}

type Discount = {
  package_id: number
  discount_amount: number
  notes: string | null
}

// Minimal Quote shape used by the recent quotes list (matches the columns we select)
type SavedQuote = {
  id: number
  quote_number: string
  nickname: string | null
  customer_name: string | null
  product_set: string | null
  brand: string | null
  battery_kwh: number | null
  panel_count: number | null
  territory: string | null
  zone: number | null
  finance_term: string | null
  total_price: number | null
  created_at: string | null
}

const HAS_BATTERY = ['Solar and Battery', 'Battery Only', 'Battery Only - Additional', 'Battery and HWHP', 'HWHP, Solar and Battery']
const HAS_SOLAR = ['Solar Only', 'Solar and Battery', 'Solar and HWHP', 'HWHP, Solar and Battery']
const HAS_HWHP = ['HWHP Only', 'Battery and HWHP', 'Solar and HWHP', 'HWHP, Solar and Battery']
const HAS_HVAC = ['HVAC']

const VISIBLE_PRODUCT_SETS = [
  'Solar and Battery',
  'Battery Only',
  'Battery Only - Additional',
  'Solar Only',
  'HWHP Only',
  'Battery and HWHP',
  'Solar and HWHP',
  'HWHP, Solar and Battery',
  'HVAC',
]

export default function QuoteBuilder() {
  const [packages, setPackages] = useState<Package[]>([])
  const [extras, setExtras] = useState<Extra[]>([])
  // 'pending' = waiting for fetch, 'loaded' = data ready, 'error' = fetch timed out / failed
  const [extrasStatus, setExtrasStatus] = useState<'pending' | 'loaded' | 'error'>('pending')
  const [variants, setVariants] = useState<PriceVariant[]>([])

  const [productSet, setProductSet] = useState<string>('Solar and Battery')
  const [brand, setBrand] = useState<string>('ALPHA')
  const [batteryKwh, setBatteryKwh] = useState<number>(10)
  const [panels, setPanels] = useState<number>(15)
  const [hwhpLitres, setHwhpLitres] = useState<number>(280)
  const [hwhpModel, setHwhpModel] = useState<string>('EHPG VM')
  const [hvacType, setHvacType] = useState<string>('Ducted')
  const [hvacKw, setHvacKw] = useState<number>(13)
  const [inverterPhase, setInverterPhase] = useState<string>('1PH')
  const [inverterParalleled, setInverterParalleled] = useState<boolean>(false)
  // 'AC-only' or 'Hybrid' - used to disambiguate ANKER battery inverters
  // (X1-P*** = AC-only, X1-H*** = Hybrid). Default to AC-only since that's most common for Battery Only deals.
  const [inverterType, setInverterType] = useState<'AC-only' | 'Hybrid'>('AC-only')

  const [territory, setTerritory] = useState<'Metro' | 'Regional'>('Metro')
  const [zone, setZone] = useState(3)
  // ASC partner only offers Cash and 60m finance options (no 84m)
  const [financeTerm, setFinanceTerm] = useState<'Cash' | '60m'>('Cash')

  const [selectedExtras, setSelectedExtras] = useState<QuoteExtra[]>([])
  const [showExtraPicker, setShowExtraPicker] = useState(false)

  // Save dialog + recent quotes list
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveNickname, setSaveNickname] = useState('')
  const [saveCustomerName, setSaveCustomerName] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedConfirmation, setSavedConfirmation] = useState<string | null>(null)
  const [recentQuotes, setRecentQuotes] = useState<SavedQuote[]>([])
  const [loadingQuotes, setLoadingQuotes] = useState(true)

  // Pricing request (shown when no package matches the current configuration)
  const [showPricingDialog, setShowPricingDialog] = useState(false)
  const [pricingNotes, setPricingNotes] = useState('')
  const [submittingPricing, setSubmittingPricing] = useState(false)
  const [pricingConfirmation, setPricingConfirmation] = useState(false)

  // Logged-in user's profile (loaded once on mount)
  const [profile, setProfile] = useState<Profile | null>(null)

  // Current pricing version (stamped onto saved quotes for historical lookup)
  const [pricingVersionId, setPricingVersionId] = useState<string | null>(null)

  // Inbound discounts (loaded once on mount; map of package_id -> discount_amount)
  const [discounts, setDiscounts] = useState<Map<number, number>>(new Map())

  const includesBattery = HAS_BATTERY.includes(productSet)
  const includesSolar = HAS_SOLAR.includes(productSet)
  const includesHwhp = HAS_HWHP.includes(productSet)
  const includesHvac = HAS_HVAC.includes(productSet)

  useEffect(() => {
    loadExtrasWithCache()

    supabase.from('price_variants').select('*').then(({ data }) => {
      if (data) setVariants(data)
    })
    supabase.from('discounts').select('*').then(({ data }) => {
      if (data) {
        const map = new Map<number, number>()
        for (const d of data as Discount[]) {
          map.set(d.package_id, d.asc_discount_amount)
        }
        setDiscounts(map)
      }
    })
    loadProfile()
    loadPricingVersion()
    loadRecentQuotes()
  }, [])

  const loadExtrasWithCache = async () => {
    const CACHE_KEY = 'segpb_extras_cache'
    const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_TTL_MS && Array.isArray(parsed.data)) {
          setExtras(parsed.data)
          setExtrasStatus('loaded')
        }
      }
    } catch {}

    const timeoutPromise = new Promise<{ data: null; error: { message: string } }>(resolve =>
      setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), 5000)
    )
    const fetchPromise = supabase.from('extras').select('*').eq('active', true).then(r => ({ data: r.data, error: r.error }))

    const result = await Promise.race([fetchPromise, timeoutPromise])

    if (result.error || !result.data) {
      setExtrasStatus(prev => prev === 'loaded' ? 'loaded' : 'error')
      return
    }

    setExtras(result.data)
    setExtrasStatus('loaded')

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: result.data }))
    } catch {}
  }

  // Load packages once we know the user's role.
  // Specialists see only 'inbound' channel packages; admins see everything.
  useEffect(() => {
    if (!profile) return
    const query = supabase.from('packages').select('*').eq('active', true)
    const filtered = profile.role === 'admin'
      ? query
      : query.contains('channels', ['asc'])
    filtered.then(({ data, error }) => {
      if (error) {
        console.error('Failed to load packages:', error)
        return
      }
      if (data) setPackages(data)
    })
  }, [profile])

  // Access guard: if profile loads and user isn't on inbound team, kick them back to /
  useEffect(() => {
    if (profile && !profile.teams?.includes('asc') && profile.role !== 'admin') {
      window.location.href = '/'
    }
  }, [profile])

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, full_name, teams')
      .eq('id', user.id)
      .single()
    if (error) {
      console.error('Failed to load profile:', error)
      return
    }
    if (data) setProfile(data as Profile)
  }

  // Load the currently active pricing version so we can stamp it on saved quotes
  const loadPricingVersion = async () => {
    const { data, error } = await supabase
      .from('pricing_versions')
      .select('id')
      .eq('is_current', true)
      .single()
    if (error) {
      console.warn('Could not load current pricing version:', error)
      return
    }
    if (data) setPricingVersionId(data.id)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const loadRecentQuotes = async () => {
    setLoadingQuotes(true)
    // RLS handles the filtering: specialists get only their own quotes, admins get all.
    // We just fetch — the database returns what the user is allowed to see.
    const { data, error } = await supabase
      .from('quotes')
      .select('id, quote_number, nickname, customer_name, product_set, brand, battery_kwh, panel_count, territory, zone, finance_term, total_price, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) console.error('Failed to load recent quotes:', error)
    if (data) setRecentQuotes(data as SavedQuote[])
    setLoadingQuotes(false)
  }

  const setPackages_ = useMemo(
    () => packages.filter(p => p.product_set === productSet),
    [packages, productSet]
  )

  const availableBrands = useMemo(() => {
    const set = new Set(setPackages_.map(p => p.brand).filter(b => b && b !== 'NA'))
    return Array.from(set).sort()
  }, [setPackages_])

  const availableBatterySizes = useMemo(() => {
    if (!includesBattery) return []
    const sizes = new Set(
      setPackages_
        .filter(p => p.brand === brand)
        .map(p => p.battery_kwh)
        .filter((s): s is number => s !== null && s !== undefined && s > 0)
    )
    return Array.from(sizes).sort((a, b) => a - b)
  }, [setPackages_, brand, includesBattery])

  const panelRange = useMemo(() => {
    if (!includesSolar) return { min: 0, max: 0 }
    const matching = setPackages_.filter(p => {
      if (includesBattery) return p.brand === brand && p.battery_kwh === batteryKwh
      return true
    })
    const counts = matching.map(p => p.panel_count).filter((n): n is number => n !== null && n !== undefined && n > 0)
    if (counts.length === 0) return { min: 0, max: 0 }
    return { min: Math.min(...counts), max: Math.max(...counts) }
  }, [setPackages_, brand, batteryKwh, includesSolar, includesBattery])

  const availableHwhpLitres = useMemo(() => {
    if (!includesHwhp) return []
    const set = new Set(setPackages_.map(p => (p.specs as any)?.hwhp_litres).filter(Boolean))
    return Array.from(set).sort((a, b) => a - b) as number[]
  }, [setPackages_, includesHwhp])

  const availableHvacTypes = useMemo(() => {
    if (!includesHvac) return []
    const set = new Set(setPackages_.map(p => (p.specs as any)?.hvac_type).filter(Boolean))
    return Array.from(set).sort() as string[]
  }, [setPackages_, includesHvac])

  const availableHvacKws = useMemo(() => {
    if (!includesHvac) return []
    const set = new Set(
      setPackages_
        .filter(p => (p.specs as any)?.hvac_type === hvacType)
        .map(p => (p.specs as any)?.hvac_kw)
        .filter(Boolean)
    )
    return Array.from(set).sort((a, b) => a - b) as number[]
  }, [setPackages_, hvacType, includesHvac])

  // Inverter filtering - only shown when more than one option exists for current selection
  const inverterCandidates = useMemo(() => {
    if (!includesBattery) return []
    return setPackages_.filter(p => {
      if (p.brand !== brand) return false
      if ((p.battery_kwh ?? 0) !== batteryKwh) return false
      if (includesSolar && (p.panel_count ?? 0) !== panels) return false
      return true
    })
  }, [setPackages_, brand, batteryKwh, panels, includesBattery, includesSolar])

  const availablePhases = useMemo(() => {
    const set = new Set(inverterCandidates.map(p => p.inverter_phase).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [inverterCandidates])

  const availableParalleled = useMemo(() => {
    const matching = availablePhases.length > 1
      ? inverterCandidates.filter(p => p.inverter_phase === inverterPhase)
      : inverterCandidates
    const set = new Set(matching.map(p => p.inverter_paralleled).filter(v => v !== null && v !== undefined) as boolean[])
    return Array.from(set).sort()
  }, [inverterCandidates, availablePhases, inverterPhase])

  // Classify a battery_inverter model string as 'AC-only' or 'Hybrid'.
  // Currently ANKER-specific: X1-H*** = Hybrid, X1-P*** = AC-only.
  // Other brands return null (no type distinction needed).
  const classifyInverterType = (model: string | null | undefined): 'AC-only' | 'Hybrid' | null => {
    if (!model) return null
    if (model.startsWith('X1-H')) return 'Hybrid'
    if (model.startsWith('X1-P')) return 'AC-only'
    return null
  }

  // Find which inverter types (AC-only / Hybrid) exist for the current selection
  const availableInverterTypes = useMemo(() => {
    let matching = inverterCandidates
    if (availablePhases.length > 1) {
      matching = matching.filter(p => p.inverter_phase === inverterPhase)
    }
    if (availableParalleled.length > 1) {
      matching = matching.filter(p => p.inverter_paralleled === inverterParalleled)
    }
    const types = new Set<'AC-only' | 'Hybrid'>()
    matching.forEach(p => {
      const t = classifyInverterType(p.battery_inverter)
      if (t) types.add(t)
    })
    return Array.from(types).sort((a, b) => (a === 'AC-only' ? -1 : 1))
  }, [inverterCandidates, availablePhases, inverterPhase, availableParalleled, inverterParalleled])

  const showPhaseFilter = availablePhases.length > 1
  const showParalleledFilter = availableParalleled.length > 1
  const showInverterTypeFilter = availableInverterTypes.length > 1

  // Auto-correct out-of-range selections
  useEffect(() => {
    if (includesBattery && availableBrands.length > 0 && !availableBrands.includes(brand)) {
      setBrand(availableBrands[0])
    }
  }, [availableBrands, brand, includesBattery])

  useEffect(() => {
    if (includesBattery && availableBatterySizes.length > 0 && !availableBatterySizes.includes(batteryKwh)) {
      setBatteryKwh(availableBatterySizes[0])
    }
  }, [availableBatterySizes, batteryKwh, includesBattery])

  useEffect(() => {
    if (includesSolar && (panels < panelRange.min || panels > panelRange.max)) {
      setPanels(panelRange.min)
    }
  }, [panelRange, panels, includesSolar])

  useEffect(() => {
    if (includesHwhp && availableHwhpLitres.length > 0 && !availableHwhpLitres.includes(hwhpLitres)) {
      setHwhpLitres(availableHwhpLitres[0])
    }
  }, [availableHwhpLitres, hwhpLitres, includesHwhp])

  // Auto-derive HWHP model from the selected tank size by looking up which model is
  // associated with that tank size in the data. This removes the need for a separate
  // model dropdown since model is uniquely determined by tank size.
  useEffect(() => {
    if (!includesHwhp) return
    const pkg = setPackages_.find(p => (p.specs as any)?.hwhp_litres === hwhpLitres)
    const derivedModel = (pkg?.specs as any)?.hwhp_model
    if (derivedModel && derivedModel !== hwhpModel) {
      setHwhpModel(derivedModel)
    }
  }, [setPackages_, hwhpLitres, hwhpModel, includesHwhp])

  useEffect(() => {
    if (includesHvac && availableHvacTypes.length > 0 && !availableHvacTypes.includes(hvacType)) {
      setHvacType(availableHvacTypes[0])
    }
  }, [availableHvacTypes, hvacType, includesHvac])

  useEffect(() => {
    if (includesHvac && availableHvacKws.length > 0 && !availableHvacKws.includes(hvacKw)) {
      setHvacKw(availableHvacKws[0])
    }
  }, [availableHvacKws, hvacKw, includesHvac])

  useEffect(() => {
    if (showPhaseFilter && !availablePhases.includes(inverterPhase)) {
      setInverterPhase(availablePhases[0])
    }
  }, [availablePhases, inverterPhase, showPhaseFilter])

  useEffect(() => {
    if (showParalleledFilter && !availableParalleled.includes(inverterParalleled)) {
      setInverterParalleled(availableParalleled[0])
    }
  }, [availableParalleled, inverterParalleled, showParalleledFilter])

  useEffect(() => {
    if (showInverterTypeFilter && !availableInverterTypes.includes(inverterType)) {
      setInverterType(availableInverterTypes[0])
    }
  }, [availableInverterTypes, inverterType, showInverterTypeFilter])

  // Match a package
  const matchedPackage = setPackages_.find(p => {
    const specs = (p.specs as any) || {}
    if (includesBattery) {
      if (p.brand !== brand) return false
      if ((p.battery_kwh ?? 0) !== batteryKwh) return false
    }
    if (includesSolar) {
      if ((p.panel_count ?? 0) !== panels) return false
    }
    if (includesHwhp) {
      if (specs.hwhp_litres !== hwhpLitres) return false
      if (specs.hwhp_model !== hwhpModel) return false
    }
    if (includesHvac) {
      if (specs.hvac_type !== hvacType) return false
      if (specs.hvac_kw !== hvacKw) return false
    }
    if (showPhaseFilter && p.inverter_phase !== inverterPhase) return false
    if (showParalleledFilter && p.inverter_paralleled !== inverterParalleled) return false
    if (showInverterTypeFilter && classifyInverterType(p.battery_inverter) !== inverterType) return false
    return true
  })

  // Look up the standard variant for the selected finance term (used as fallback / for proportional fortnightly scaling)
  const variant = variants.find(v =>
    v.package_id === matchedPackage?.id &&
    v.territory === territory &&
    v.zone === zone &&
    v.finance_term === financeTerm
  )

  // Also look up the CASH variant — this is the source of truth for inbound pricing math.
  // The discount applies to cash; 60m and 84m are then derived from the discounted cash price
  // using the business formula (cash_after_stc / 0.80 for 60m, / 0.70 for 84m).
  const cashVariant = variants.find(v =>
    v.package_id === matchedPackage?.id &&
    v.territory === territory &&
    v.zone === zone &&
    v.finance_term === 'Cash'
  )

  const extrasTotal = selectedExtras.reduce((sum, e) => {
    return sum + (e.charge_type === 'Per Panel' ? e.unit_price * panels : e.unit_price)
  }, 0)

  // Inbound discount math:
  // 1. Subtract discount from cash_after_stc (cash price the customer actually pays)
  // 2. For Cash term: base = discounted_cash_after_stc + stc
  // 3. For 60m: discounted_cash_after_stc / 0.80 = 60m_after_stc, then + stc = 60m_before
  // 4. For 84m: discounted_cash_after_stc / 0.70 = 84m_after_stc, then + stc = 84m_before
  const inboundDiscount = matchedPackage ? (discounts.get(matchedPackage.id) ?? 0) : 0
  const stc = cashVariant?.stc_discount ?? variant?.stc_discount ?? 0
  const cashAfterStc = cashVariant?.price_after_stc ?? 0
  const discountedCashAfterStc = Math.max(0, cashAfterStc - inboundDiscount)

  // Derive the after-STC price for the currently selected finance term
  // ASC: Cash = 1.0, 60m = 0.80 (no 84m available)
  const financeMultiplier = financeTerm === 'Cash' ? 1 : 0.80
  const afterStc = discountedCashAfterStc / financeMultiplier
  const base = afterStc + stc
  const total = afterStc + extrasTotal

  // Fortnightly: scale the standard fortnightly proportionally based on how much the after-STC price moved
  // (e.g. if discounted after-STC is 90% of standard after-STC, fortnightly is 90% of standard fortnightly)
  const rawAfterStc = variant?.price_after_stc ?? 0
  const rawFortnightly = variant?.fortnightly_repay ?? 0
  const fortnightly = rawAfterStc > 0 ? rawFortnightly * (afterStc / rawAfterStc) : 0

  const quotedItems = selectedExtras.filter(e => e.charge_type === 'QUOTED').length

  const addExtra = (e: Extra) => {
    setSelectedExtras([...selectedExtras, { ...e, instanceId: crypto.randomUUID() }])
    setShowExtraPicker(false)
  }

  const removeExtra = (instanceId: string) => {
    setSelectedExtras(selectedExtras.filter(e => e.instanceId !== instanceId))
  }

  // Generate an auto quote number like Q-2026-0001 (date-based, no DB lookup needed for uniqueness
  // because we add seconds + random suffix so collisions are vanishingly unlikely)
  const generateQuoteNumber = () => {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const hhmmss = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
    return `Q-${yyyy}${mm}${dd}-${hhmmss}`
  }

  const submitPricingRequest = async () => {
    if (!profile) {
      console.error('Cannot submit: no profile loaded')
      return
    }
    setSubmittingPricing(true)

    const { error } = await supabase.from('pricing_requests').insert({
      user_id: profile.id,
      user_email: profile.email,
      product_set: productSet,
      brand: includesBattery ? brand : null,
      battery_kwh: includesBattery ? batteryKwh : null,
      panel_count: includesSolar ? panels : null,
      inverter_phase: showPhaseFilter ? inverterPhase : null,
      inverter_paralleled: showParalleledFilter ? inverterParalleled : null,
      hwhp_litres: includesHwhp ? hwhpLitres : null,
      hvac_type: includesHvac ? hvacType : null,
      hvac_kw: includesHvac ? hvacKw : null,
      territory,
      zone,
      finance_term: financeTerm,
      notes: pricingNotes.trim() || null,
    })

    setSubmittingPricing(false)
    if (error) {
      console.error('Failed to submit pricing request:', error)
      return
    }
    setShowPricingDialog(false)
    setPricingNotes('')
    setPricingConfirmation(true)
    setTimeout(() => setPricingConfirmation(false), 4000)
  }

  const saveQuote = async () => {
    if (!matchedPackage) {
      console.error('Cannot save: no matched package')
      return
    }
    if (!profile) {
      console.error('Cannot save: no profile loaded')
      return
    }
    setSaving(true)
    const quoteNumber = generateQuoteNumber()

    const { data: quoteRow, error: quoteError } = await supabase
      .from('quotes')
      .insert({
        quote_number: quoteNumber,
        user_id: profile.id,
        nickname: saveNickname.trim() || null,
        customer_name: saveCustomerName.trim() || null,
        package_id: matchedPackage.id,
        product_set: productSet,
        brand: includesBattery ? brand : null,
        battery_kwh: includesBattery ? batteryKwh : null,
        panel_count: includesSolar ? panels : null,
        inverter_phase: showPhaseFilter ? inverterPhase : null,
        inverter_paralleled: showParalleledFilter ? inverterParalleled : null,
        hwhp_litres: includesHwhp ? hwhpLitres : null,
        hvac_type: includesHvac ? hvacType : null,
        hvac_kw: includesHvac ? hvacKw : null,
        territory,
        zone,
        finance_term: financeTerm,
        base_price: base,
        stc_discount: stc,
        extras_total: extrasTotal,
        total_price: total,
        status: 'draft',
        is_asc_pricing: true,
        pricing_version_id: pricingVersionId,
      })
      .select()
      .single()

    if (quoteError) {
      console.error('Failed to save quote:', quoteError)
      setSaving(false)
      return
    }

    // Save the extras as quote_extras rows (only if we have any and the quote insert succeeded)
    if (selectedExtras.length > 0 && quoteRow) {
      const extrasRows = selectedExtras.map(e => ({
        quote_id: quoteRow.id,
        extra_id: e.id,
        quantity: e.charge_type === 'Per Panel' ? panels : 1,
        line_total: e.charge_type === 'Per Panel' ? e.unit_price * panels : e.unit_price,
      }))
      const { error: extrasError } = await supabase.from('quote_extras').insert(extrasRows)
      if (extrasError) console.error('Failed to save quote extras:', extrasError)
    }

    setSaving(false)
    setShowSaveDialog(false)
    setSaveNickname('')
    setSaveCustomerName('')
    setSavedConfirmation(quoteNumber)
    setTimeout(() => setSavedConfirmation(null), 4000)
    loadRecentQuotes()
  }

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n)

  const systemSize = matchedPackage?.system_size_kw?.toFixed(2) ?? (panels * 0.44).toFixed(2)

  const inverterCode = (() => {
    if (!matchedPackage || !showPhaseFilter) return null
    const match = matchedPackage.package_code.match(/X1-[A-Z0-9]+-[ST]/)
    return match ? match[0] : null
  })()

  const packageDescription = [
    includesBattery ? `${brand}-${batteryKwh}kWh battery` : null,
    includesSolar && panels > 0 ? `${systemSize}kW PV` : null,
    includesHwhp ? `${hwhpLitres}L ${hwhpModel}` : null,
    includesHvac ? `${hvacKw}kW ${hvacType}` : null,
    inverterCode ? `${inverterCode}${inverterParalleled ? ' ×2 paralleled' : ''}` : null,
  ].filter(Boolean).join(' + ') || 'Nothing selected'

  return (
    <div className="min-h-screen bg-teal-50/30 dark:bg-teal-950/10">
    {/* Strong teal strip across the top of the page */}
    <div className="h-1.5 bg-teal-500 dark:bg-teal-600 w-full" />
    <main className="max-w-5xl mx-auto p-3 md:p-6 pb-24 md:pb-6">
      {/* Inbound mode banner - prominent */}
      <div className="mb-4 px-4 py-3 rounded-lg bg-teal-100 dark:bg-teal-950/60 border-2 border-teal-300 dark:border-teal-700 flex items-center gap-2.5">
        <div className="bg-teal-500 dark:bg-teal-600 rounded-full p-1 flex-shrink-0">
          <Info className="w-3.5 h-3.5 text-white" />
        </div>
        <p className="text-sm text-teal-900 dark:text-teal-200 flex-1">
          <span className="font-semibold">ASC PRICING MODE</span>
          <span className="hidden sm:inline"> — ASC partner pricing for authorised use.</span>
          
        </p>
      </div>

      <header className="flex items-center justify-between pb-3 mb-4 md:mb-5 border-b-2 border-teal-300 dark:border-teal-700 gap-2">
        <div className="flex items-center gap-2 md:gap-2.5 min-w-0">
          <Zap className="w-5 h-5 text-teal-600 dark:text-teal-400 flex-shrink-0" />
          <div className="min-w-0 flex items-center gap-2">
            <p className="font-medium text-sm md:text-[15px] truncate">SEG Pricing Builder</p>
            <span className="text-[10px] uppercase tracking-wider font-bold bg-teal-500 dark:bg-teal-600 text-white px-2 py-0.5 rounded">
              Inbound
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 md:gap-3 flex-shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 max-w-[120px] md:max-w-none">
            <User className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">
              {profile?.full_name?.split(' ')[0] || profile?.email?.split('@')[0] || '…'}
              {profile?.role === 'admin' && (
                <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                  Admin
                </span>
              )}
            </span>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-gray-200 p-1.5 md:px-2 md:py-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Sign out</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-4">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 mb-2">1. System</p>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-4">

            <div className="flex flex-col gap-3 text-sm md:grid md:grid-cols-[110px_1fr] md:gap-x-3 md:gap-y-2.5 md:items-center">
              <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">Product type</label>
              <select value={productSet} onChange={e => setProductSet(e.target.value)}
                className="h-11 md:h-9 px-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-base md:text-sm">
                {VISIBLE_PRODUCT_SETS.map(s => <option key={s}>{s}</option>)}
              </select>

              {includesBattery && (
                <>
                  <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">Battery brand</label>
                  <select value={brand} onChange={e => setBrand(e.target.value)}
                    className="h-11 md:h-9 px-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-base md:text-sm">
                    {availableBrands.map(b => <option key={b}>{b}</option>)}
                  </select>

                  <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">Battery size</label>
                  <select value={batteryKwh} onChange={e => setBatteryKwh(Number(e.target.value))}
                    className="h-11 md:h-9 px-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-base md:text-sm">
                    {availableBatterySizes.map(s => <option key={s} value={s}>{s} kWh</option>)}
                  </select>
                </>
              )}

              {includesSolar && panelRange.max > 0 && (
                <>
                  <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">Panels</label>
                  <div className="flex items-center gap-3">
                    <input type="range" min={panelRange.min} max={panelRange.max} value={panels}
                      onChange={e => setPanels(Number(e.target.value))} className="flex-1" />
                    <div className="flex items-center gap-1.5 min-w-[110px]">
                      <input
                        type="number"
                        min={panelRange.min}
                        max={panelRange.max}
                        value={panels}
                        onChange={e => {
                          const n = Number(e.target.value)
                          if (Number.isNaN(n)) return
                          setPanels(Math.max(panelRange.min, Math.min(panelRange.max, n)))
                        }}
                        className="w-14 px-2 py-1 text-sm font-medium text-right border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{systemSize} kW</span>
                    </div>
                  </div>
                </>
              )}

              {showPhaseFilter && (
                <>
                  <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">Phase</label>
                  <SegmentedControl
                    value={inverterPhase}
                    options={availablePhases}
                    onChange={v => setInverterPhase(v)}
                  />
                </>
              )}

              {showParalleledFilter && (
                <>
                  <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">Inverter</label>
                  <SegmentedControl
                    value={inverterParalleled ? 'paralleled' : 'single'}
                    options={availableParalleled.map(v => v ? 'paralleled' : 'single')}
                    labels={availableParalleled.map(v => v ? 'Paralleled ×2' : 'Single')}
                    onChange={v => setInverterParalleled(v === 'paralleled')}
                  />
                </>
              )}

              {showInverterTypeFilter && (
                <>
                  <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">Inverter type</label>
                  <SegmentedControl
                    value={inverterType}
                    options={availableInverterTypes}
                    onChange={v => setInverterType(v as 'AC-only' | 'Hybrid')}
                  />
                </>
              )}

              {includesHwhp && (
                <>
                  <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">HWHP tank</label>
                  <select value={hwhpLitres} onChange={e => setHwhpLitres(Number(e.target.value))}
                    className="h-11 md:h-9 px-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-base md:text-sm">
                    {availableHwhpLitres.map(l => <option key={l} value={l}>{l}L</option>)}
                  </select>
                </>
              )}

              {includesHvac && (
                <>
                  <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">HVAC type</label>
                  <select value={hvacType} onChange={e => setHvacType(e.target.value)}
                    className="h-11 md:h-9 px-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-base md:text-sm">
                    {availableHvacTypes.map(t => <option key={t}>{t}</option>)}
                  </select>

                  <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">HVAC capacity</label>
                  <select value={hvacKw} onChange={e => setHvacKw(Number(e.target.value))}
                    className="h-11 md:h-9 px-3 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-base md:text-sm">
                    {availableHvacKws.map(k => <option key={k} value={k}>{k} kW</option>)}
                  </select>
                </>
              )}

              <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">Package</label>
              <div className="flex flex-col md:flex-row md:items-center gap-1.5 md:gap-2 min-w-0">
                <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded break-all md:break-normal">
                  {matchedPackage?.package_code ?? 'No match'}
                </code>
                <span className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 md:truncate">{packageDescription}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 mb-2">2. Site & finance</p>
              <div className="flex flex-col gap-3 text-sm md:grid md:grid-cols-[110px_1fr] md:gap-x-3 md:gap-y-2.5 md:items-center">
                <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">Territory</label>
                <SegmentedControl
                  value={territory}
                  options={['Metro', 'Regional']}
                  onChange={v => setTerritory(v as 'Metro' | 'Regional')}
                />

                <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">STC zone</label>
                <SegmentedControl
                  value={String(zone)}
                  options={['1', '2', '3', '4']}
                  labelPrefix="ZN"
                  onChange={v => setZone(Number(v))}
                />

                <label className="text-gray-500 dark:text-gray-400 dark:text-gray-500">Finance</label>
                <SegmentedControl
                  value={financeTerm}
                  options={['Cash', '60m']}
                  labels={['Cash', 'BNPL 60m']}
                  onChange={v => setFinanceTerm(v as 'Cash' | '60m')}
                />
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500">3. Extras</p>
                <button onClick={() => setShowExtraPicker(!showExtraPicker)}
                  className="text-xs px-2.5 py-1 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>

              {showExtraPicker && (
                <div className="mb-2 border border-gray-200 dark:border-gray-700 rounded-md p-2 max-h-48 overflow-y-auto text-sm">
                  {extrasStatus === 'pending' && extras.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic py-2 px-1 text-center">Loading extras…</p>
                  ) : extrasStatus === 'error' && extras.length === 0 ? (
                    <div className="py-2 px-1 text-center">
                      <p className="text-xs text-red-600 dark:text-red-400 mb-1.5">Couldn't load extras.</p>
                      <button
                        onClick={() => { setExtrasStatus('pending'); loadExtrasWithCache() }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    extras.map(e => (
                      <button key={e.id} onClick={() => addExtra(e)}
                        className="w-full text-left px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex justify-between items-center">
                        <span>{e.name}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
                          {e.charge_type === 'Per Panel' ? `$${e.unit_price}/panel` : formatCurrency(e.unit_price)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div className="space-y-1.5 text-sm">
                {selectedExtras.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic py-2">No extras added yet</p>
                )}
                {selectedExtras.map(e => {
                  const lineTotal = e.charge_type === 'Per Panel' ? e.unit_price * panels : e.unit_price
                  return (
                    <div key={e.instanceId} className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-md px-2.5 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge type={e.charge_type} />
                        <span className="truncate">{e.name}</span>
                      </div>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        <span className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
                          {e.charge_type === 'Per Panel' ? `$${e.unit_price} × ${panels}` :
                           e.charge_type === 'QUOTED' ? 'est.' : ''}
                        </span>
                        <span className="font-medium min-w-[60px] text-right">{formatCurrency(lineTotal)}</span>
                        <button onClick={() => removeExtra(e.instanceId)}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded" aria-label="Remove">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 mb-2">Quote summary</p>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">Total (inc GST)</span>
              <span className="text-2xl font-medium">{formatCurrency(total)}</span>
            </div>
            <div className="flex items-baseline justify-between pb-3 border-b border-gray-200 dark:border-gray-700">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {financeTerm === 'Cash' ? 'One-off payment' : `Fortnightly · BNPL ${financeTerm}`}
              </span>
              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                {financeTerm === 'Cash' ? 'Paid upfront' : `$${Math.round(fortnightly)} / fn`}
              </span>
            </div>

            <div className="mt-3 text-sm space-y-1">
              <Line label="Base package" value={formatCurrency(base)} />
              <Line label={`STC discount (ZN${zone})`} value={`−${formatCurrency(stc)}`} valueColor="text-green-600 dark:text-green-400" />
              <Line label={`Extras (${selectedExtras.length})`} value={formatCurrency(extrasTotal)} />
            </div>

            {matchedPackage && inboundDiscount === 0 && (
              <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 italic">
                No inbound discount configured for this package — standard pricing shown.
              </p>
            )}

            {matchedPackage && (
              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 mb-2">Specifications</p>
                <div className="space-y-2">
                  {includesBattery && (
                    <SpecGroup title="Battery">
                      <SpecRow label="Brand" value={matchedPackage.brand} />
                      <SpecRow label="Capacity" value={`${matchedPackage.battery_kwh ?? '—'} kWh`} />
                      <SpecRow label="Model" value={matchedPackage.battery_model} />
                      <SpecRow
                        label="Inverter"
                        value={(() => {
                          const inv = matchedPackage.battery_inverter ?? inverterCode
                          if (!inv) return inv
                          return matchedPackage.inverter_paralleled ? `${inv} ×2` : inv
                        })()}
                      />
                      {showPhaseFilter && <SpecRow label="Phase" value={matchedPackage.inverter_phase} />}
                      {showParalleledFilter && <SpecRow label="Config" value={matchedPackage.inverter_paralleled ? 'Paralleled ×2' : 'Single'} />}
                    </SpecGroup>
                  )}

                  {includesSolar && (
                    <SpecGroup title="Solar">
                      <SpecRow label="Panels" value={matchedPackage.panel_count ? `${matchedPackage.panel_count} ×` : '—'} />
                      <SpecRow label="Panel model" value={matchedPackage.panel_model} />
                      <SpecRow label="System size" value={matchedPackage.system_size_kw ? `${matchedPackage.system_size_kw} kW` : '—'} />
                      <SpecRow
                        label="PV inverter"
                        value={matchedPackage.pv_inverter}
                        fallback="Shared with battery inverter"
                      />
                    </SpecGroup>
                  )}

                  {includesHwhp && (
                    <SpecGroup title="Hot water heat pump">
                      <SpecRow label="Tank" value={`${hwhpLitres}L`} />
                      <SpecRow label="Model" value={hwhpModel} />
                    </SpecGroup>
                  )}

                  {includesHvac && (
                    <SpecGroup title="HVAC">
                      <SpecRow label="Type" value={hvacType} />
                      <SpecRow label="Capacity" value={`${hvacKw} kW`} />
                    </SpecGroup>
                  )}
                </div>
              </div>
            )}

            <div className={`mt-3 px-3 py-2.5 rounded-md flex gap-2 items-start ${quotedItems > 0 ? 'bg-teal-50 dark:bg-teal-950/50' : 'bg-blue-50 dark:bg-blue-950/50'}`}>
              <Info className={`w-4 h-4 flex-shrink-0 mt-0.5 ${quotedItems > 0 ? 'text-teal-700 dark:text-teal-400' : 'text-blue-700 dark:text-blue-300'}`} />
              <p className={`text-xs leading-relaxed ${quotedItems > 0 ? 'text-teal-700 dark:text-teal-400' : 'text-blue-700 dark:text-blue-300'}`}>
                {quotedItems > 0
                  ? `Includes ${quotedItems} QUOTED item${quotedItems > 1 ? 's' : ''} — confirm with Tech before sending.`
                  : 'All prices fixed — ready to send to customer.'}
              </p>
            </div>

            <div className="mt-3.5 space-y-1.5">
              {matchedPackage ? (
                <button
                  onClick={() => setShowSaveDialog(true)}
                  className="hidden md:flex w-full py-2 text-sm border rounded-md transition-colors items-center justify-center gap-1.5 bg-gray-900 dark:bg-gray-700 text-white border-gray-900 dark:border-gray-700 hover:bg-gray-800 dark:hover:bg-gray-600"
                >
                  <Save className="w-3.5 h-3.5" /> Save quote
                </button>
              ) : (
                <button
                  onClick={() => setShowPricingDialog(true)}
                  className="hidden md:flex w-full py-2 text-sm border rounded-md transition-colors items-center justify-center gap-1.5 bg-teal-600 dark:bg-teal-500 text-white border-teal-600 dark:border-teal-500 hover:bg-teal-700 dark:hover:bg-teal-600"
                >
                  <Info className="w-3.5 h-3.5" /> Request pricing
                </button>
              )}
              {savedConfirmation && (
                <div className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 rounded-md px-2.5 py-1.5 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  Saved as <code className="font-mono">{savedConfirmation}</code>
                </div>
              )}
              {pricingConfirmation && (
                <div className="text-xs text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 rounded-md px-2.5 py-1.5 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  Pricing request submitted. The team will review and add it.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent quotes section - full width below everything */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500">
              {profile?.role === 'admin' ? 'Recent quotes — all users (last 20)' : 'Your recent quotes (last 20)'}
            </p>
          </div>
          <button onClick={loadRecentQuotes} className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-gray-200">
            Refresh
          </button>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          {loadingQuotes ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic p-4 text-center">Loading…</p>
          ) : recentQuotes.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic p-4 text-center">No saved quotes yet</p>
          ) : (
            <>
              {/* Desktop: table */}
              <table className="hidden md:table w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
                    <th className="text-left font-medium px-3 py-2">Quote #</th>
                    <th className="text-left font-medium px-3 py-2">Nickname</th>
                    <th className="text-left font-medium px-3 py-2">Customer</th>
                    <th className="text-left font-medium px-3 py-2">Configuration</th>
                    <th className="text-left font-medium px-3 py-2">Site</th>
                    <th className="text-left font-medium px-3 py-2">Finance</th>
                    <th className="text-right font-medium px-3 py-2">Total</th>
                    <th className="text-left font-medium px-3 py-2">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {recentQuotes.map(q => (
                    <tr key={q.id} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300 dark:text-gray-600">{q.quote_number}</td>
                      <td className="px-3 py-2 text-xs">{q.nickname || <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-3 py-2 text-xs">{q.customer_name || <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300 dark:text-gray-600">
                        {[
                          q.product_set,
                          q.brand && `${q.brand}`,
                          q.battery_kwh ? `${q.battery_kwh}kWh` : null,
                          q.panel_count ? `${q.panel_count}p` : null,
                        ].filter(Boolean).join(' · ')}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300 dark:text-gray-600">{q.territory ? `${q.territory} ZN${q.zone}` : '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300 dark:text-gray-600">{q.finance_term}</td>
                      <td className="px-3 py-2 text-xs font-medium text-right">{q.total_price !== null ? formatCurrency(q.total_price) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">{formatRelativeDate(q.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile: cards */}
              <div className="md:hidden divide-y divide-gray-100">
                {recentQuotes.map(q => (
                  <div key={q.id} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {q.nickname || q.customer_name || q.quote_number}
                        </p>
                        {(q.nickname && q.customer_name) && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 truncate">{q.customer_name}</p>
                        )}
                      </div>
                      <p className="text-sm font-medium flex-shrink-0">
                        {q.total_price !== null ? formatCurrency(q.total_price) : '—'}
                      </p>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-300 dark:text-gray-600 truncate">
                      {[
                        q.product_set,
                        q.brand,
                        q.battery_kwh ? `${q.battery_kwh}kWh` : null,
                        q.panel_count ? `${q.panel_count}p` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                    <div className="flex items-center justify-between mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                      <span className="font-mono">{q.quote_number}</span>
                      <span>
                        {q.territory && `${q.territory} ZN${q.zone} · `}
                        {q.finance_term} · {formatRelativeDate(q.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Save dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !saving && setShowSaveDialog(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium">Save quote</p>
              <button onClick={() => !saving && setShowSaveDialog(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 mb-1 block">Nickname (optional)</label>
                <input
                  type="text"
                  value={saveNickname}
                  onChange={e => setSaveNickname(e.target.value)}
                  placeholder="e.g. Smith family — option A"
                  className="w-full h-11 md:h-9 px-3 border border-gray-200 dark:border-gray-700 rounded-md text-base md:text-sm focus:outline-none focus:border-gray-400"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 mb-1 block">Customer name (optional)</label>
                <input
                  type="text"
                  value={saveCustomerName}
                  onChange={e => setSaveCustomerName(e.target.value)}
                  placeholder="e.g. John Smith"
                  className="w-full h-11 md:h-9 px-3 border border-gray-200 dark:border-gray-700 rounded-md text-base md:text-sm focus:outline-none focus:border-gray-400"
                />
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-md px-3 py-2 text-xs text-gray-600 dark:text-gray-300 dark:text-gray-600 space-y-0.5">
                <div className="flex justify-between"><span>Configuration:</span><span className="text-gray-900 dark:text-gray-100">{packageDescription}</span></div>
                <div className="flex justify-between"><span>Total:</span><span className="text-gray-900 dark:text-gray-100 font-medium">{formatCurrency(total)}</span></div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowSaveDialog(false)}
                  disabled={saving}
                  className="flex-1 py-2.5 md:py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 min-h-[44px] md:min-h-0"
                >
                  Cancel
                </button>
                <button
                  onClick={saveQuote}
                  disabled={saving}
                  className="flex-1 py-2.5 md:py-2 text-sm bg-gray-900 dark:bg-gray-700 text-white rounded-md hover:bg-gray-800 dark:hover:bg-gray-600 disabled:opacity-50 min-h-[44px] md:min-h-0"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pricing request dialog */}
      {showPricingDialog && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => !submittingPricing && setShowPricingDialog(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-sm w-full p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium">Request pricing</p>
              <button
                onClick={() => !submittingPricing && setShowPricingDialog(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              No pricing exists for this configuration yet. Submit a request and the pricing team will review and add it.
            </p>
            <div className="space-y-3">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-md px-3 py-2 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                <div className="flex justify-between gap-2"><span className="text-gray-500 dark:text-gray-400">Configuration:</span><span className="text-gray-900 dark:text-gray-100 text-right">{packageDescription}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Site:</span><span className="text-gray-900 dark:text-gray-100">{territory} ZN{zone}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Finance:</span><span className="text-gray-900 dark:text-gray-100">{financeTerm}</span></div>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Notes (optional)</label>
                <textarea
                  value={pricingNotes}
                  onChange={e => setPricingNotes(e.target.value)}
                  placeholder="e.g. customer wants this specific combo, urgent for Friday"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md text-base md:text-sm bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 resize-none"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowPricingDialog(false)}
                  disabled={submittingPricing}
                  className="flex-1 py-2.5 md:py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 min-h-[44px] md:min-h-0"
                >
                  Cancel
                </button>
                <button
                  onClick={submitPricingRequest}
                  disabled={submittingPricing}
                  className="flex-1 py-2.5 md:py-2 text-sm bg-teal-600 dark:bg-teal-500 text-white rounded-md hover:bg-teal-700 dark:hover:bg-teal-600 disabled:opacity-50 min-h-[44px] md:min-h-0"
                >
                  {submittingPricing ? 'Submitting…' : 'Submit request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky bottom bar - mobile only */}
      <div className="fixed bottom-0 left-0 right-0 md:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-3 py-2.5 flex items-center gap-3 shadow-lg z-40">
        <div className="flex-1 min-w-0">
          {matchedPackage ? (
            <>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
                {financeTerm === 'Cash' ? 'Total (inc GST)' : `BNPL ${financeTerm} · $${Math.round(fortnightly)}/fn`}
              </p>
              <p className="text-lg font-medium leading-tight">{formatCurrency(total)}</p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-teal-700 dark:text-teal-400 leading-tight">No pricing available</p>
              <p className="text-sm leading-tight text-gray-600 dark:text-gray-300">Request team to add it</p>
            </>
          )}
        </div>
        {matchedPackage ? (
          <button
            onClick={() => setShowSaveDialog(true)}
            className="px-4 py-2.5 bg-gray-900 dark:bg-gray-700 text-white rounded-md text-sm font-medium flex items-center gap-1.5 min-h-[44px]"
          >
            <Save className="w-4 h-4" />
            Save
          </button>
        ) : (
          <button
            onClick={() => setShowPricingDialog(true)}
            className="px-4 py-2.5 bg-teal-600 dark:bg-teal-500 text-white rounded-md text-sm font-medium flex items-center gap-1.5 min-h-[44px]"
          >
            <Info className="w-4 h-4" />
            Request
          </button>
        )}
      </div>
    </main>
    </div>
  )
}

// Format an ISO timestamp into "5m ago", "2h ago", "3d ago" or full date for older
function formatRelativeDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function SegmentedControl({ value, options, labels, labelPrefix, onChange }: {
  value: string; options: string[]; labels?: string[]; labelPrefix?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt, i) => (
        <button key={opt} onClick={() => onChange(opt)}
          className={`flex-1 px-2.5 py-2.5 md:py-1.5 text-sm border rounded-md transition-colors min-h-[44px] md:min-h-0 ${
            value === opt
              ? 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 font-medium'
              : 'bg-transparent border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}>
          {labels ? labels[i] : labelPrefix ? `${labelPrefix}${opt}` : opt}
        </button>
      ))}
    </div>
  )
}

function Badge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    'Per Panel': 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300',
    'Flat Fee': 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200',
    'QUOTED': 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-400',
    'Variable': 'bg-purple-50 dark:bg-purple-950/50 text-purple-800 dark:text-purple-400',
  }
  const labels: Record<string, string> = {
    'Per Panel': 'Per panel', 'Flat Fee': 'Flat', 'QUOTED': 'Quoted', 'Variable': 'Variable'
  }
  return <span className={`text-[11px] px-1.5 py-0.5 rounded ${colors[type] ?? 'bg-gray-100 dark:bg-gray-800'}`}>{labels[type] ?? type}</span>
}

function Line({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between py-0.5 text-gray-500 dark:text-gray-400 dark:text-gray-500">
      <span>{label}</span>
      <span className={valueColor ?? 'text-gray-900 dark:text-gray-100'}>{value}</span>
    </div>
  )
}

function SpecGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function SpecRow({ label, value, fallback }: {
  label: string
  value: string | number | null | undefined
  fallback?: string
}) {
  const isEmpty = value === null || value === undefined || value === ''
  // If a fallback is provided, treat null as "not applicable" rather than "missing"
  const display = isEmpty ? (fallback ?? '—') : String(value)
  const isMissing = isEmpty && !fallback
  const isFallback = isEmpty && !!fallback
  return (
    <div className="flex justify-between text-xs gap-2">
      <span className="text-gray-500 dark:text-gray-400 dark:text-gray-500 flex-shrink-0">{label}</span>
      <span
        className={
          isMissing ? 'text-teal-600 dark:text-teal-400 italic' :
          isFallback ? 'text-gray-400 dark:text-gray-500 italic text-right truncate max-w-[180px]' :
          'text-gray-900 dark:text-gray-100 text-right truncate max-w-[180px]'
        }
        title={display}
      >
        {display}
      </span>
    </div>
  )
}
