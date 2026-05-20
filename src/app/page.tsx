'use client'

import { useEffect, useState } from 'react'
import { supabase, type Package, type PriceVariant, type Extra } from '@/lib/supabase'
import { Zap, User, Plus, X, FileText, ArrowLeftRight, Save, Info } from 'lucide-react'

type QuoteExtra = Extra & { instanceId: string }

export default function QuoteBuilder() {
  const [packages, setPackages] = useState<Package[]>([])
  const [extras, setExtras] = useState<Extra[]>([])
  const [variants, setVariants] = useState<PriceVariant[]>([])

  const [brand, setBrand] = useState('ALPHA')
  const [batteryKwh, setBatteryKwh] = useState(10)
  const [panels, setPanels] = useState(15)
  const [territory, setTerritory] = useState<'Metro' | 'Regional'>('Metro')
  const [zone, setZone] = useState(3)
  const [financeTerm, setFinanceTerm] = useState<'Cash' | '60m' | '84m'>('60m')
  const [selectedExtras, setSelectedExtras] = useState<QuoteExtra[]>([])
  const [showExtraPicker, setShowExtraPicker] = useState(false)

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

  // Find the matching package
  const matchedPackage = packages.find(p =>
    p.brand === brand &&
    p.battery_kwh === batteryKwh &&
    p.panel_count === panels
  )

  // Find the price for current selections
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
  const cashEquiv = variants.find(v =>
    v.package_id === matchedPackage?.id &&
    v.territory === territory && v.zone === zone && v.finance_term === 'Cash'
  )?.price_after_stc ?? 0
  const financeLoading = financeTerm === 'Cash' ? 0 : afterStc - cashEquiv
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

  const systemSize = (panels * 0.44).toFixed(2)

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
              <label className="text-gray-500">Brand</label>
              <select value={brand} onChange={e => setBrand(e.target.value)}
                className="h-9 px-3 border border-gray-200 rounded-md bg-white">
                <option>ALPHA</option>
                <option>ANKER</option>
                <option>GIV</option>
              </select>

              <label className="text-gray-500">Battery size</label>
              <select value={batteryKwh} onChange={e => setBatteryKwh(Number(e.target.value))}
                className="h-9 px-3 border border-gray-200 rounded-md bg-white">
                <option value={5}>5 kWh</option>
                <option value={10}>10 kWh</option>
                <option value={15}>15 kWh</option>
                <option value={20}>20 kWh</option>
              </select>

              <label className="text-gray-500">Panels</label>
              <div className="flex items-center gap-3">
                <input type="range" min={7} max={31} value={panels}
                  onChange={e => setPanels(Number(e.target.value))} className="flex-1" />
                <span className="text-sm font-medium min-w-[80px] text-right">{panels} ({systemSize} kW)</span>
              </div>

              <label className="text-gray-500">Package</label>
              <div className="flex items-center gap-2 min-w-0">
                <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                  {matchedPackage?.package_code ?? 'No match'}
                </code>
                <span className="text-xs text-gray-500 truncate">
                  {brand}-{batteryKwh}kW DC + {systemSize}kW PV
                </span>
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
              <Line label={`Finance loading (${financeTerm})`} value={financeTerm === 'Cash' ? '—' : formatCurrency(financeLoading)} />
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