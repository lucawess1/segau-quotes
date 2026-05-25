'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase, type Package, type PriceVariant, type Extra } from '@/lib/supabase'
import { Zap, User, Plus, X, FileText, ArrowLeftRight, Save, Info } from 'lucide-react'

type QuoteExtra = Extra & { instanceId: string }

// Product sets that include each component
const HAS_BATTERY = ['Solar & Battery', 'Battery Only', 'HWHP & Battery', 'HWHP, Solar & Battery']
const HAS_SOLAR = ['Solar Only', 'Solar & Battery', 'HWHP, Solar & Battery']
const HAS_HWHP = ['HWHP Only', 'HWHP & Battery', 'HWHP, Solar & Battery']
const HAS_HVAC = ['HVAC']

// Product sets we expose in the UI (excludes "Additional Panels" - moved to extras - and any test rows)
const VISIBLE_PRODUCT_SETS = [
  'Solar Only',
  'Solar & Battery',
  'Battery Only',
  'HWHP Only',
  'HWHP & Battery',
  'HWHP, Solar & Battery',
  'HVAC',
]

export default function QuoteBuilder() {
  const [packages, setPackages] = useState<Package[]>([])
  const [extras, setExtras] = useState<Extra[]>([])
  const [variants, setVariants] = useState<PriceVariant[]>([])

  // Primary selector
  const [productSet, setProductSet] = useState<string>('Solar & Battery')

  // Component-specific selections (only used when relevant)
  const [brand, setBrand] = useState<string>('ALPHA')
  const [batteryKwh, setBatteryKwh] = useState<number>(10)
  const [panels, setPanels] = useState<number>(15)
  const [hwhpLitres, setHwhpLitres] = useState<number>(280)
  const [hwhpModel, setHwhpModel] = useState<string>('EHPG VM')
  const [hvacType, setHvacType] = useState<string>('Ducted')
  const [hvacKw, setHvacKw] = useState<number>(13)

  // Site & finance
  const [territory, setTerritory] = useState<'Metro' | 'Regional'>('Metro')
  const [zone, setZone] = useState(3)
  const [financeTerm, setFinanceTerm] = useState<'Cash' | '60m' | '84m'>('60m')

  // Extras
  const [selectedExtras, setSelectedExtras] = useState<QuoteExtra[]>([])
  const [showExtraPicker, setShowExtraPicker] = useState(false)

  // What's in this product set?
  const includesBattery = HAS_BATTERY.includes(productSet)
  const includesSolar = HAS_SOLAR.includes(productSet)
  const includesHwhp = HAS_HWHP.includes(productSet)
  const includesHvac = HAS_HVAC.includes(productSet)

  // Load reference data
  useEffect(() => {
    supabase.from('packages').select('*').eq('active', true).then(({ data }) => {
      if (data) setPackages(data)
    })
    supabase.from('extras').select('*').eq('active', true).then(({ data }) => {
      if (data) setExtras(data)
    })
    supabase.from('price_variants').select('*').then(({ data }) => {
      if (data) setVariants(data)
    })
  }, [])

  // Packages filtered to current product set
  const setPackages_ = useMemo(
    () => packages.filter(p => p.product_set === productSet),
    [packages, productSet]
  )

  // Derived dropdown options from actual data
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

  const availableHwhpModels = useMemo(() => {
    if (!includesHwhp) return []
    const set = new Set(setPackages_.map(p => (p.specs as any)?.hwhp_model).filter(Boolean))
    return Array.from(set).sort() as string[]
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

  // Auto-correct out-of-range selections when product set or upstream selection changes
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

  useEffect(() => {
    if (includesHwhp && availableHwhpModels.length > 0 && !availableHwhpModels.includes(hwhpModel)) {
      setHwhpModel(availableHwhpModels[0])
    }
  }, [availableHwhpModels, hwhpModel, includesHwhp])

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

  // Match a package based on all the currently-relevant selections
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
    return true
  })

  // Price lookup
  const variant = variants.find(v =>
    v.package_id === matchedPackage?.id &&
    v.territory === territory &&
    v.zone === zone &&
    v.finance_term === financeTerm
  )

  // Calculate extras total
  const extrasTotal = selectedExtras.reduce((sum, e) => {
    return sum + (e.charge_type === 'Per Panel' ? e.unit_price * panels : e.unit_price)
  }, 0)

  const base = variant?.price_before_stc ?? 0
  const stc = variant?.stc_discount ?? 0
  const afterStc = variant?.price_after_stc ?? 0
  const total = afterStc + extrasTotal
  const fortnightly = variant?.fortnightly_repay ?? 0

  const quotedItems = selectedExtras.filter(e => e.charge_type === 'QUOTED').length

  const addExtra = (e: Extra) => {
    setSelectedExtras([...selectedExtras, { ...e, instanceId: crypto.randomUUID() }])
    setShowExtraPicker(false)
  }

  const removeExtra = (instanceId: string) => {
    setSelectedExtras(selectedExtras.filter(e => e.instanceId !== instanceId))
  }

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n)

  const systemSize = matchedPackage?.system_size_kw?.toFixed(2) ?? (panels * 0.44).toFixed(2)

  // Build a friendly package description
  const packageDescription = [
    includesBattery ? `${brand}-${batteryKwh}kWh battery` : null,
    includesSolar && panels > 0 ? `${systemSize}kW PV` : null,
    includesHwhp ? `${hwhpLitres}L ${hwhpModel}` : null,
    includesHvac ? `${hvacKw}kW ${hvacType}` : null,
  ].filter(Boolean).join(' + ') || 'Nothing selected'

  return (
    <main className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <header className="flex items-center justify-between pb-3 mb-5 border-b border-gray-200">
        <div className="flex items-center gap-2.5">
          <Zap className="w-5 h-5 text-blue-600" />
          <div>
            <p className="font-medium text-[15px]">SEGAU Quote Builder</p>
            <p className="text-xs text-gray-500">Pricing v2026.05.05 · last updated 5 May</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <User className="w-3.5 h-3.5" />
          <span>Specialist: T. Nguyen</span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-4">
        {/* Left column: builder */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">1. System</p>
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">

            <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5 items-center text-sm">
              <label className="text-gray-500">Product type</label>
              <select value={productSet} onChange={e => setProductSet(e.target.value)}
                className="h-9 px-3 border border-gray-200 rounded-md bg-white">
                {VISIBLE_PRODUCT_SETS.map(s => <option key={s}>{s}</option>)}
              </select>

              {includesBattery && (
                <>
                  <label className="text-gray-500">Battery brand</label>
                  <select value={brand} onChange={e => setBrand(e.target.value)}
                    className="h-9 px-3 border border-gray-200 rounded-md bg-white">
                    {availableBrands.map(b => <option key={b}>{b}</option>)}
                  </select>

                  <label className="text-gray-500">Battery size</label>
                  <select value={batteryKwh} onChange={e => setBatteryKwh(Number(e.target.value))}
                    className="h-9 px-3 border border-gray-200 rounded-md bg-white">
                    {availableBatterySizes.map(s => <option key={s} value={s}>{s} kWh</option>)}
                  </select>
                </>
              )}

              {includesSolar && panelRange.max > 0 && (
                <>
                  <label className="text-gray-500">Panels</label>
                  <div className="flex items-center gap-3">
                    <input type="range" min={panelRange.min} max={panelRange.max} value={panels}
                      onChange={e => setPanels(Number(e.target.value))} className="flex-1" />
                    <span className="text-sm font-medium min-w-[80px] text-right">
                      {panels} ({systemSize} kW)
                    </span>
                  </div>
                </>
              )}

              {includesHwhp && (
                <>
                  <label className="text-gray-500">HWHP tank</label>
                  <select value={hwhpLitres} onChange={e => setHwhpLitres(Number(e.target.value))}
                    className="h-9 px-3 border border-gray-200 rounded-md bg-white">
                    {availableHwhpLitres.map(l => <option key={l} value={l}>{l}L</option>)}
                  </select>

                  <label className="text-gray-500">HWHP model</label>
                  <select value={hwhpModel} onChange={e => setHwhpModel(e.target.value)}
                    className="h-9 px-3 border border-gray-200 rounded-md bg-white">
                    {availableHwhpModels.map(m => <option key={m}>{m}</option>)}
                  </select>
                </>
              )}

              {includesHvac && (
                <>
                  <label className="text-gray-500">HVAC type</label>
                  <select value={hvacType} onChange={e => setHvacType(e.target.value)}
                    className="h-9 px-3 border border-gray-200 rounded-md bg-white">
                    {availableHvacTypes.map(t => <option key={t}>{t}</option>)}
                  </select>

                  <label className="text-gray-500">HVAC capacity</label>
                  <select value={hvacKw} onChange={e => setHvacKw(Number(e.target.value))}
                    className="h-9 px-3 border border-gray-200 rounded-md bg-white">
                    {availableHvacKws.map(k => <option key={k} value={k}>{k} kW</option>)}
                  </select>
                </>
              )}

              <label className="text-gray-500">Package</label>
              <div className="flex items-center gap-2 min-w-0">
                <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                  {matchedPackage?.package_code ?? 'No match'}
                </code>
                <span className="text-xs text-gray-500 truncate">{packageDescription}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200">
              <p className="text-xs font-medium text-gray-500 mb-2">2. Site & finance</p>
              <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5 items-center text-sm">
                <label className="text-gray-500">Territory</label>
                <SegmentedControl
                  value={territory}
                  options={['Metro', 'Regional']}
                  onChange={v => setTerritory(v as 'Metro' | 'Regional')}
                />

                <label className="text-gray-500">STC zone</label>
                <SegmentedControl
                  value={String(zone)}
                  options={['1', '2', '3', '4']}
                  labelPrefix="ZN"
                  onChange={v => setZone(Number(v))}
                />

                <label className="text-gray-500">Finance</label>
                <SegmentedControl
                  value={financeTerm}
                  options={['Cash', '60m', '84m']}
                  labels={['Cash', 'BNPL 60m', 'BNPL 84m']}
                  onChange={v => setFinanceTerm(v as 'Cash' | '60m' | '84m')}
                />
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500">3. Extras</p>
                <button onClick={() => setShowExtraPicker(!showExtraPicker)}
                  className="text-xs px-2.5 py-1 border border-gray-200 rounded-md hover:bg-gray-50 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>

              {showExtraPicker && (
                <div className="mb-2 border border-gray-200 rounded-md p-2 max-h-48 overflow-y-auto text-sm">
                  {extras.map(e => (
                    <button key={e.id} onClick={() => addExtra(e)}
                      className="w-full text-left px-2 py-1.5 hover:bg-gray-100 rounded flex justify-between items-center">
                      <span>{e.name}</span>
                      <span className="text-xs text-gray-500">
                        {e.charge_type === 'Per Panel' ? `$${e.unit_price}/panel` : formatCurrency(e.unit_price)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1.5 text-sm">
                {selectedExtras.length === 0 && (
                  <p className="text-xs text-gray-400 italic py-2">No extras added yet</p>
                )}
                {selectedExtras.map(e => {
                  const lineTotal = e.charge_type === 'Per Panel' ? e.unit_price * panels : e.unit_price
                  return (
                    <div key={e.instanceId} className="flex items-center justify-between bg-gray-50 rounded-md px-2.5 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge type={e.charge_type} />
                        <span className="truncate">{e.name}</span>
                      </div>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        <span className="text-xs text-gray-500">
                          {e.charge_type === 'Per Panel' ? `$${e.unit_price} × ${panels}` :
                           e.charge_type === 'QUOTED' ? 'est.' : ''}
                        </span>
                        <span className="font-medium min-w-[60px] text-right">{formatCurrency(lineTotal)}</span>
                        <button onClick={() => removeExtra(e.instanceId)}
                          className="p-1 hover:bg-gray-200 rounded" aria-label="Remove">
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

        {/* Right column: summary */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Quote summary</p>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm text-gray-500">Total (inc GST)</span>
              <span className="text-2xl font-medium">{formatCurrency(total)}</span>
            </div>
            <div className="flex items-baseline justify-between pb-3 border-b border-gray-200">
              <span className="text-xs text-gray-400">
                {financeTerm === 'Cash' ? 'One-off payment' : `Fortnightly · BNPL ${financeTerm}`}
              </span>
              <span className="text-sm font-medium text-blue-600">
                {financeTerm === 'Cash' ? 'Paid upfront' : `$${Math.round(fortnightly)} / fn`}
              </span>
            </div>

            <div className="mt-3 text-sm space-y-1">
              <Line label="Base package" value={formatCurrency(base)} />
              <Line label={`STC discount (ZN${zone})`} value={`−${formatCurrency(stc)}`} valueColor="text-green-600" />
              <Line label={`Extras (${selectedExtras.length})`} value={formatCurrency(extrasTotal)} />
            </div>

            <div className={`mt-3 px-3 py-2.5 rounded-md flex gap-2 items-start ${quotedItems > 0 ? 'bg-amber-50' : 'bg-blue-50'}`}>
              <Info className={`w-4 h-4 flex-shrink-0 mt-0.5 ${quotedItems > 0 ? 'text-amber-700' : 'text-blue-700'}`} />
              <p className={`text-xs leading-relaxed ${quotedItems > 0 ? 'text-amber-700' : 'text-blue-700'}`}>
                {quotedItems > 0
                  ? `Includes ${quotedItems} QUOTED item${quotedItems > 1 ? 's' : ''} — confirm with Tech before sending.`
                  : 'All prices fixed — ready to send to customer.'}
              </p>
            </div>

            <div className="mt-3.5 space-y-1.5">
              <Button icon={<FileText className="w-3.5 h-3.5" />} primary>Generate proposal</Button>
              <Button icon={<ArrowLeftRight className="w-3.5 h-3.5" />}>Compare brands</Button>
              <Button icon={<Save className="w-3.5 h-3.5" />}>Save draft</Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

function SegmentedControl({ value, options, labels, labelPrefix, onChange }: {
  value: string; options: string[]; labels?: string[]; labelPrefix?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt, i) => (
        <button key={opt} onClick={() => onChange(opt)}
          className={`flex-1 px-2.5 py-1.5 text-sm border rounded-md transition-colors ${
            value === opt
              ? 'bg-gray-100 border-gray-300 font-medium'
              : 'bg-transparent border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}>
          {labels ? labels[i] : labelPrefix ? `${labelPrefix}${opt}` : opt}
        </button>
      ))}
    </div>
  )
}

function Badge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    'Per Panel': 'bg-blue-50 text-blue-800',
    'Flat Fee': 'bg-gray-100 text-gray-700',
    'QUOTED': 'bg-amber-50 text-amber-800',
    'Variable': 'bg-purple-50 text-purple-800',
  }
  const labels: Record<string, string> = {
    'Per Panel': 'Per panel', 'Flat Fee': 'Flat', 'QUOTED': 'Quoted', 'Variable': 'Variable'
  }
  return <span className={`text-[11px] px-1.5 py-0.5 rounded ${colors[type] ?? 'bg-gray-100'}`}>{labels[type] ?? type}</span>
}

function Line({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between py-0.5 text-gray-500">
      <span>{label}</span>
      <span className={valueColor ?? 'text-gray-900'}>{value}</span>
    </div>
  )
}

function Button({ children, icon, primary }: { children: React.ReactNode; icon?: React.ReactNode; primary?: boolean }) {
  return (
    <button className={`w-full py-2 text-sm border rounded-md transition-colors flex items-center justify-center gap-1.5 ${
      primary
        ? 'bg-gray-900 text-white border-gray-900 hover:bg-gray-800'
        : 'bg-white border-gray-200 hover:bg-gray-50'
    }`}>
      {icon} {children}
    </button>
  )
}
