'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Zap, User, LogOut, ArrowLeft, ChevronDown, ChevronRight, Search, Calendar, Package, DollarSign } from 'lucide-react'

const supabase = createClient()

type Profile = {
  id: string
  email: string
  role: 'specialist' | 'admin'
  full_name: string | null
  teams: string[]
}

type PackagesSnapshotMeta = {
  id: number
  label: string
  notes: string | null
  taken_at: string
  taken_by: string | null
  row_count: number
  pricing_version_id: string | null
}

type PricingVersionMeta = {
  id: string
  name: string
  notes: string | null
  uploaded_at: string
  uploaded_by: string | null
  row_count: number | null
  start_date: string | null
  end_date: string | null
  is_current: boolean
}

type ArchivedPackage = {
  package_code: string
  product_set: string | null
  brand: string | null
  battery_kwh: number | null
  panel_count: number | null
  system_size_kw: number | null
  battery_inverter: string | null
  battery_model: string | null
  pv_inverter: string | null
  panel_model: string | null
  specs: any
  inverter_phase: string | null
  inverter_paralleled: boolean | null
  channels: string[] | null
  active: boolean | null
}

type ArchivedPrice = {
  package_code: string
  territory: string
  zone: number
  finance_term: string
  price_before_stc: number
  stc_discount: number
  price_after_stc: number
  fortnightly_repay: number | null
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n)
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export default function VersionDetailPage() {
  const params = useParams<{ id: string }>()
  const search = useSearchParams()
  const kind = (search.get('kind') ?? 'packages') as 'packages' | 'price'
  const id = params.id

  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Metadata for the version (one shape or the other depending on kind)
  const [packagesMeta, setPackagesMeta] = useState<PackagesSnapshotMeta | null>(null)
  const [priceMeta, setPriceMeta] = useState<PricingVersionMeta | null>(null)

  // Archived data
  const [archivedPackages, setArchivedPackages] = useState<ArchivedPackage[]>([])
  const [archivedPrices, setArchivedPrices] = useState<ArchivedPrice[]>([])

  // UI state
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadProfile()
  }, [])

  useEffect(() => {
    if (profile && profile.role !== 'admin') {
      window.location.href = '/'
    }
  }, [profile])

  useEffect(() => {
    if (!profile || profile.role !== 'admin') return
    loadVersionData()
  }, [profile, id, kind])

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { window.location.href = '/login'; return }
    const { data } = await supabase
      .from('profiles')
      .select('id, email, role, full_name, teams')
      .eq('id', user.id)
      .single()
    if (data) setProfile(data as Profile)
  }

  const loadVersionData = async () => {
    setLoading(true)
    setError(null)
    setArchivedPackages([])
    setArchivedPrices([])
    setPackagesMeta(null)
    setPriceMeta(null)

    try {
      if (kind === 'packages') {
        // Snapshot ID is numeric
        const snapshotId = Number(id)
        if (Number.isNaN(snapshotId)) {
          setError('Invalid snapshot ID')
          setLoading(false)
          return
        }

        // Load snapshot metadata
        const { data: metaData, error: metaErr } = await supabase
          .from('packages_snapshots')
          .select('*')
          .eq('id', snapshotId)
          .single()
        if (metaErr || !metaData) {
          setError(metaErr?.message || 'Snapshot not found')
          setLoading(false)
          return
        }
        setPackagesMeta(metaData as PackagesSnapshotMeta)

        // Load the archived packages
        const { data: pkgData } = await supabase
          .from('packages_archive')
          .select('*')
          .eq('snapshot_id', snapshotId)
          .order('package_code')
        if (pkgData) setArchivedPackages(pkgData as ArchivedPackage[])

        // If this snapshot is linked to a pricing version, also load those prices
        if (metaData.pricing_version_id) {
          const { data: priceData } = await supabase
            .from('price_variants_archive')
            .select('package_code, territory, zone, finance_term, price_before_stc, stc_discount, price_after_stc, fortnightly_repay')
            .eq('pricing_version_id', metaData.pricing_version_id)
          if (priceData) setArchivedPrices(priceData as ArchivedPrice[])
        }
      } else {
        // kind === 'price' — id is a pricing_version text id
        const { data: metaData, error: metaErr } = await supabase
          .from('pricing_versions')
          .select('*')
          .eq('id', id)
          .single()
        if (metaErr || !metaData) {
          setError(metaErr?.message || 'Pricing version not found')
          setLoading(false)
          return
        }
        setPriceMeta(metaData as PricingVersionMeta)

        // Load the archived prices for this version
        const { data: priceData } = await supabase
          .from('price_variants_archive')
          .select('package_code, territory, zone, finance_term, price_before_stc, stc_discount, price_after_stc, fortnightly_repay')
          .eq('pricing_version_id', id)
        if (priceData) setArchivedPrices(priceData as ArchivedPrice[])
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setLoading(false)
  }

  // Group prices by package_code for fast lookup
  const pricesByCode = useMemo(() => {
    const map = new Map<string, ArchivedPrice[]>()
    for (const p of archivedPrices) {
      const arr = map.get(p.package_code) || []
      arr.push(p)
      map.set(p.package_code, arr)
    }
    return map
  }, [archivedPrices])

  // For price-only kind, derive a list of unique package codes from prices
  const priceOnlyCodes = useMemo(() => {
    if (kind !== 'price') return []
    const set = new Set(archivedPrices.map(p => p.package_code))
    return Array.from(set).sort()
  }, [archivedPrices, kind])

  // Filter packages/codes by search term
  const filteredPackages = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return archivedPackages
    return archivedPackages.filter(p =>
      p.package_code.toLowerCase().includes(q) ||
      (p.brand?.toLowerCase().includes(q) ?? false) ||
      (p.product_set?.toLowerCase().includes(q) ?? false)
    )
  }, [archivedPackages, searchTerm])

  const filteredCodes = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return priceOnlyCodes
    return priceOnlyCodes.filter(c => c.toLowerCase().includes(q))
  }, [priceOnlyCodes, searchTerm])

  const toggleExpand = (code: string) => {
    setExpandedCodes(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  if (!profile) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
  }

  // Display title
  const title = kind === 'packages'
    ? (packagesMeta?.label ?? `Snapshot #${id}`)
    : (priceMeta?.name ?? id)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <main className="max-w-5xl mx-auto p-3 md:p-6">
        <header className="flex items-center justify-between pb-3 mb-5 border-b border-gray-200 dark:border-gray-700 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-[15px] truncate">SEG Pricing Builder — Admin</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Version detail</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <User className="w-3.5 h-3.5" />
              <span>
                {profile?.full_name?.split(' ')[0] || profile?.email?.split('@')[0] || '…'}
                <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                  Admin
                </span>
              </span>
            </div>
            <button onClick={signOut} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded">
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </header>

        <a href="/admin" className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to admin
        </a>

        {/* Metadata card */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-3">
            {kind === 'packages' ? (
              <Package className="w-5 h-5 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
            ) : (
              <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-base">{title}</p>
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  kind === 'packages'
                    ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300'
                    : 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                }`}>
                  {kind === 'packages' ? 'Packages snapshot' : 'Price version'}
                </span>
                {priceMeta?.is_current && (
                  <span className="text-[10px] uppercase tracking-wide bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">
                    Current
                  </span>
                )}
              </div>

              {(kind === 'packages' ? packagesMeta?.notes : priceMeta?.notes) && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {kind === 'packages' ? packagesMeta?.notes : priceMeta?.notes}
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Taken at</p>
                  <p className="text-gray-900 dark:text-gray-100 mt-0.5">
                    {kind === 'packages' && packagesMeta ? formatDateTime(packagesMeta.taken_at) :
                     priceMeta ? formatDateTime(priceMeta.uploaded_at) : '—'}
                  </p>
                </div>
                {kind === 'price' && (priceMeta?.start_date || priceMeta?.end_date) && (
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Effective</p>
                    <p className="text-gray-900 dark:text-gray-100 mt-0.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-gray-400" />
                      {priceMeta.start_date ?? '—'} → {priceMeta.end_date ?? '—'}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Rows</p>
                  <p className="text-gray-900 dark:text-gray-100 mt-0.5 tabular-nums">
                    {kind === 'packages'
                      ? `${packagesMeta?.row_count?.toLocaleString() ?? '—'} packages`
                      : `${archivedPrices.length.toLocaleString()} price variants`}
                  </p>
                </div>
                {kind === 'packages' && packagesMeta?.pricing_version_id && (
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Linked pricing version</p>
                    <a
                      href={`/admin/version/${packagesMeta.pricing_version_id}?kind=price`}
                      className="text-blue-600 dark:text-blue-400 mt-0.5 font-mono hover:underline block"
                    >
                      {packagesMeta.pricing_version_id}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {loading && (
          <div className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-8">
            Loading version data…
          </div>
        )}

        {error && !loading && (
          <div className="px-4 py-3 rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Search */}
            <div className="mb-3">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search by package code, brand, or product type…"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                {kind === 'packages'
                  ? `Showing ${filteredPackages.length} of ${archivedPackages.length} packages${packagesMeta?.pricing_version_id ? ' · click a row to expand prices' : ''}`
                  : `Showing ${filteredCodes.length} of ${priceOnlyCodes.length} packages · click a row to expand prices`}
              </p>
            </div>

            {/* Packages list (kind === 'packages') */}
            {kind === 'packages' && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                {filteredPackages.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic p-6 text-center">
                    {archivedPackages.length === 0 ? 'No packages in this snapshot' : 'No packages match your search'}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="w-8"></th>
                        <th className="text-left px-3 py-2 font-normal">Package code</th>
                        <th className="text-left px-3 py-2 font-normal">Product type</th>
                        <th className="text-left px-3 py-2 font-normal">Brand</th>
                        <th className="text-left px-3 py-2 font-normal">Battery</th>
                        <th className="text-left px-3 py-2 font-normal">Panels</th>
                        <th className="text-left px-3 py-2 font-normal">Channels</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPackages.map(p => {
                        const expanded = expandedCodes.has(p.package_code)
                        const pricesForPkg = pricesByCode.get(p.package_code) || []
                        const hasLinkedPrices = packagesMeta?.pricing_version_id != null
                        return (
                          <>
                            <tr
                              key={p.package_code}
                              className={`border-t border-gray-100 dark:border-gray-800 ${hasLinkedPrices ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : ''}`}
                              onClick={() => hasLinkedPrices && toggleExpand(p.package_code)}
                            >
                              <td className="px-2 py-2">
                                {hasLinkedPrices && (expanded
                                  ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                  : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />)}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{p.package_code}</td>
                              <td className="px-3 py-2 text-xs">{p.product_set ?? '—'}</td>
                              <td className="px-3 py-2 text-xs">{p.brand ?? '—'}</td>
                              <td className="px-3 py-2 text-xs tabular-nums">{p.battery_kwh ? `${p.battery_kwh} kWh` : '—'}</td>
                              <td className="px-3 py-2 text-xs tabular-nums">{p.panel_count ?? '—'}</td>
                              <td className="px-3 py-2 text-xs">
                                {p.channels?.map(c => (
                                  <span key={c} className="inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 mr-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded">
                                    {c}
                                  </span>
                                )) ?? <span className="text-gray-400">—</span>}
                              </td>
                            </tr>
                            {expanded && hasLinkedPrices && (
                              <tr key={`${p.package_code}-prices`} className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20">
                                <td colSpan={7} className="px-3 py-2">
                                  <PriceMatrix prices={pricesForPkg} />
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Price-only list (kind === 'price') */}
            {kind === 'price' && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                {filteredCodes.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic p-6 text-center">
                    {priceOnlyCodes.length === 0 ? 'No prices in this version' : 'No packages match your search'}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="w-8"></th>
                        <th className="text-left px-3 py-2 font-normal">Package code</th>
                        <th className="text-right px-3 py-2 font-normal">Variants</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCodes.map(code => {
                        const expanded = expandedCodes.has(code)
                        const pricesForPkg = pricesByCode.get(code) || []
                        return (
                          <>
                            <tr
                              key={code}
                              className="border-t border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                              onClick={() => toggleExpand(code)}
                            >
                              <td className="px-2 py-2">
                                {expanded
                                  ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                  : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{code}</td>
                              <td className="px-3 py-2 text-xs text-right tabular-nums">{pricesForPkg.length}</td>
                            </tr>
                            {expanded && (
                              <tr key={`${code}-prices`} className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20">
                                <td colSpan={3} className="px-3 py-2">
                                  <PriceMatrix prices={pricesForPkg} />
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function PriceMatrix({ prices }: { prices: ArchivedPrice[] }) {
  if (prices.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 italic">No prices found for this package in the linked pricing version.</p>
  }

  // Group by territory then zone then finance_term
  // Most useful layout: rows = territory + finance_term, cols = zones
  const territories = Array.from(new Set(prices.map(p => p.territory))).sort()
  const finance_terms = Array.from(new Set(prices.map(p => p.finance_term)))
  const zones = Array.from(new Set(prices.map(p => p.zone))).sort()

  const lookup = (territory: string, ft: string, zone: number) =>
    prices.find(p => p.territory === territory && p.finance_term === ft && p.zone === zone)

  return (
    <div className="space-y-2 py-1">
      {territories.map(territory => (
        <div key={territory}>
          <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1 font-medium">{territory}</p>
          <table className="text-xs w-full">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left pr-3 py-1 font-normal">Finance</th>
                {zones.map(z => <th key={z} className="text-right px-2 py-1 font-normal">ZN{z}</th>)}
              </tr>
            </thead>
            <tbody>
              {finance_terms.map(ft => (
                <tr key={ft} className="border-t border-gray-100 dark:border-gray-800/60">
                  <td className="pr-3 py-1 text-gray-700 dark:text-gray-300">{ft}</td>
                  {zones.map(z => {
                    const p = lookup(territory, ft, z)
                    return (
                      <td key={z} className="px-2 py-1 text-right tabular-nums">
                        {p ? (
                          <div>
                            <p className="text-gray-900 dark:text-gray-100">{formatCurrency(p.price_after_stc)}</p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400">before {formatCurrency(p.price_before_stc)}</p>
                          </div>
                        ) : <span className="text-gray-400 dark:text-gray-600">—</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
