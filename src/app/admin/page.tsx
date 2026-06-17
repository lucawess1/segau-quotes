'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Zap, User, LogOut, Database, Play, Check, AlertTriangle, RefreshCw, History, Camera } from 'lucide-react'

const supabase = createClient()

type Profile = {
  id: string
  email: string
  role: 'specialist' | 'admin'
  full_name: string | null
  teams: string[]
}

type MergeResult = {
  action: string
  count: number
}

type StagingTable = {
  key: 'packages' | 'price_variants' | 'discounts' | 'builder_packages' | 'builder_stc'
  label: string
  tableName: string
  functionName: string
  description: string
}

type VersionHistoryRow = {
  kind: 'price' | 'packages'
  id: string
  label: string | null
  notes: string | null
  taken_by: string | null
  taken_at: string
  row_count: number | null
  start_date: string | null
  end_date: string | null
  is_current: boolean
}

const STAGING_TABLES: StagingTable[] = [
  {
    key: 'packages',
    label: 'Packages',
    tableName: 'packages_staging',
    functionName: 'merge_packages',
    description: 'Upsert package definitions (new packages + updates to existing).',
  },
  {
    key: 'price_variants',
    label: 'Price variants',
    tableName: 'price_variants_staging',
    functionName: 'merge_price_variants',
    description: 'Upsert prices and create a labelled pricing version.',
  },
  {
    key: 'discounts',
    label: 'Discounts',
    tableName: 'discounts_staging',
    functionName: 'merge_discounts',
    description: 'Upsert inbound and ASC discount amounts.',
  },
  {
    key: 'builder_packages',
    label: 'Builder packages',
    tableName: 'builder_packages_staging',
    functionName: 'merge_builder_packages',
    description: 'Upsert builder upgrade packages (cost-based pricing for builder channel).',
  },
  {
    key: 'builder_stc',
    label: 'Builder STC values',
    tableName: 'builder_stc_values_staging',
    functionName: 'merge_builder_stc',
    description: 'Upsert STC rebate values by year for builder packages (solar + battery components).',
  },
]

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-AU', { 
    day: '2-digit', month: 'short', year: 'numeric', 
    hour: '2-digit', minute: '2-digit', hour12: false 
  })
}

export default function AdminPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [results, setResults] = useState<Record<string, MergeResult[]>>({})
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Price variants labelling state (filled in before clicking Merge)
  const [priceLabel, setPriceLabel] = useState('')
  const [priceNotes, setPriceNotes] = useState('')
  const [priceStartDate, setPriceStartDate] = useState('')
  const [priceEndDate, setPriceEndDate] = useState('')

  // Packages snapshot state
  const [snapshotLabel, setSnapshotLabel] = useState('')
  const [snapshotNotes, setSnapshotNotes] = useState('')
  const [snapshotRunning, setSnapshotRunning] = useState(false)
  const [snapshotResult, setSnapshotResult] = useState<{ snapshot_id: number; label: string; packages_count: number; pricing_version_id: string | null } | null>(null)
  const [snapshotError, setSnapshotError] = useState('')

  // Version history
  const [versionHistory, setVersionHistory] = useState<VersionHistoryRow[]>([])

  useEffect(() => {
    loadProfile()
    refreshCounts()
    loadVersionHistory()
  }, [])

  useEffect(() => {
    if (profile && profile.role !== 'admin') {
      window.location.href = '/'
    }
  }, [profile])

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      window.location.href = '/login'
      return
    }
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

  const refreshCounts = async () => {
    const newCounts: Record<string, number> = {}
    for (const t of STAGING_TABLES) {
      const { count, error } = await supabase
        .from(t.tableName)
        .select('*', { count: 'exact', head: true })
      if (error) {
        console.error(`Failed to count ${t.tableName}:`, error)
        newCounts[t.key] = -1
      } else {
        newCounts[t.key] = count ?? 0
      }
    }
    setCounts(newCounts)
  }

  const loadVersionHistory = async () => {
    const { data, error } = await supabase
      .from('version_history')
      .select('*')
      .limit(30)
    if (error) {
      console.error('Failed to load version history:', error)
      return
    }
    if (data) setVersionHistory(data as VersionHistoryRow[])
  }

  const runMerge = async (table: StagingTable) => {
    setRunning(prev => ({ ...prev, [table.key]: true }))
    setErrors(prev => ({ ...prev, [table.key]: '' }))
    setResults(prev => ({ ...prev, [table.key]: [] }))

    // For price_variants, pass the label/notes/dates as RPC parameters
    const rpcArgs = table.key === 'price_variants'
      ? {
          p_name: priceLabel.trim() || null,
          p_notes: priceNotes.trim() || null,
          p_start_date: priceStartDate || null,
          p_end_date: priceEndDate || null,
        }
      : undefined

    const { data, error } = await supabase.rpc(table.functionName, rpcArgs)

    setRunning(prev => ({ ...prev, [table.key]: false }))

    if (error) {
      setErrors(prev => ({ ...prev, [table.key]: error.message }))
      return
    }
    if (data) {
      setResults(prev => ({ ...prev, [table.key]: data as MergeResult[] }))
    }

    // Clear the price label fields after a successful price merge
    if (table.key === 'price_variants') {
      setPriceLabel('')
      setPriceNotes('')
      setPriceStartDate('')
      setPriceEndDate('')
    }

    refreshCounts()
    loadVersionHistory()
  }

  const takeSnapshot = async () => {
    if (!snapshotLabel.trim()) {
      setSnapshotError('Label is required')
      return
    }
    setSnapshotRunning(true)
    setSnapshotError('')
    setSnapshotResult(null)

    const { data, error } = await supabase.rpc('take_full_snapshot', {
      p_label: snapshotLabel.trim(),
      p_notes: snapshotNotes.trim() || null,
    })

    setSnapshotRunning(false)

    if (error) {
      setSnapshotError(error.message)
      return
    }
    if (data && data.length > 0) {
      setSnapshotResult(data[0])
      setSnapshotLabel('')
      setSnapshotNotes('')
      loadVersionHistory()
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <main className="max-w-3xl mx-auto p-3 md:p-6">
        <header className="flex items-center justify-between pb-3 mb-5 border-b border-gray-200 dark:border-gray-700 gap-2">
          <div className="flex items-center gap-2.5">
            <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="font-medium text-[15px]">SEG Pricing Builder — Admin</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Staging merge console</p>
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
            <button
              onClick={signOut}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </header>

        {/* Packages snapshot card */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-2 mb-3">
            <Camera className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">Take full snapshot</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Capture the current state of active packages AND link to the current pricing version. Useful before structural changes (new product rollouts, retiring old products).
              </p>
            </div>
          </div>

          <div className="ml-6 space-y-2">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Label (required)</label>
              <input
                type="text"
                value={snapshotLabel}
                onChange={e => setSnapshotLabel(e.target.value)}
                placeholder="e.g. Pre-460W panel rollout"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Notes (optional)</label>
              <textarea
                value={snapshotNotes}
                onChange={e => setSnapshotNotes(e.target.value)}
                placeholder="Context about why this snapshot was taken…"
                rows={2}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
              />
            </div>
            <button
              onClick={takeSnapshot}
              disabled={snapshotRunning || !snapshotLabel.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 dark:bg-blue-500 text-white rounded-md hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Camera className="w-3.5 h-3.5" />
              {snapshotRunning ? 'Taking snapshot…' : 'Take snapshot'}
            </button>

            {snapshotError && (
              <div className="px-3 py-2 rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-700 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-400">{snapshotError}</p>
              </div>
            )}
            {snapshotResult && (
              <div className="px-3 py-2 rounded-md bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-green-700 dark:text-green-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-green-800 dark:text-green-300">
                  <p>
                    Snapshot <span className="font-mono">#{snapshotResult.snapshot_id}</span> captured — {snapshotResult.packages_count.toLocaleString()} package{snapshotResult.packages_count === 1 ? '' : 's'}
                  </p>
                  {snapshotResult.pricing_version_id && (
                    <p className="mt-0.5 text-green-700 dark:text-green-400">
                      Linked to pricing version <span className="font-mono">{snapshotResult.pricing_version_id}</span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Staging merge actions</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Upload data to staging tables via Supabase Table Editor first, then run the merge.
            </p>
          </div>
          <button
            onClick={refreshCounts}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <RefreshCw className="w-3 h-3" /> Refresh counts
          </button>
        </div>

        <div className="space-y-3">
          {STAGING_TABLES.map(t => {
            const count = counts[t.key] ?? 0
            const isRunning = running[t.key]
            const error = errors[t.key]
            const result = results[t.key]
            const empty = count === 0
            const isPriceMerge = t.key === 'price_variants'

            return (
              <div key={t.key} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                      <p className="font-medium text-sm">{t.label}</p>
                      <code className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                        {t.tableName}
                      </code>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">{t.description}</p>
                  </div>
                  <button
                    onClick={() => runMerge(t)}
                    disabled={isRunning || empty}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-900 dark:bg-gray-700 text-white rounded-md hover:bg-gray-800 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {isRunning ? 'Running…' : 'Merge'}
                  </button>
                </div>

                <div className="ml-6 mt-2">
                  <p className={`text-xs ${empty ? 'text-gray-400 dark:text-gray-500 italic' : 'text-gray-700 dark:text-gray-300'}`}>
                    {empty
                      ? 'No rows in staging — upload data via Supabase Table Editor first.'
                      : `${count.toLocaleString()} row${count === 1 ? '' : 's'} ready to merge.`}
                  </p>
                </div>

                {/* Special: labelling fields shown only for price_variants */}
                {isPriceMerge && !empty && (
                  <div className="mt-3 ml-6 p-3 rounded-md bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 space-y-2">
                    <p className="text-xs font-medium text-blue-900 dark:text-blue-300">Label this pricing version</p>
                    <div>
                      <label className="text-xs text-gray-600 dark:text-gray-400 mb-0.5 block">Name</label>
                      <input
                        type="text"
                        value={priceLabel}
                        onChange={e => setPriceLabel(e.target.value)}
                        placeholder="e.g. Pricing 2026-06-17 (460W rollout)"
                        className="w-full px-2.5 py-1 text-xs border border-blue-200 dark:border-blue-800 rounded bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-600 dark:text-gray-400 mb-0.5 block">Effective from</label>
                        <input
                          type="date"
                          value={priceStartDate}
                          onChange={e => setPriceStartDate(e.target.value)}
                          className="w-full px-2.5 py-1 text-xs border border-blue-200 dark:border-blue-800 rounded bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-400"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600 dark:text-gray-400 mb-0.5 block">Effective until</label>
                        <input
                          type="date"
                          value={priceEndDate}
                          onChange={e => setPriceEndDate(e.target.value)}
                          className="w-full px-2.5 py-1 text-xs border border-blue-200 dark:border-blue-800 rounded bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-400"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 dark:text-gray-400 mb-0.5 block">Notes</label>
                      <textarea
                        value={priceNotes}
                        onChange={e => setPriceNotes(e.target.value)}
                        placeholder="Context about this pricing version…"
                        rows={2}
                        className="w-full px-2.5 py-1 text-xs border border-blue-200 dark:border-blue-800 rounded bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <p className="text-[10px] text-blue-800 dark:text-blue-400 italic">
                      Leave name blank to use auto-generated date (e.g. v2026-06-17).
                    </p>
                  </div>
                )}

                {error && (
                  <div className="mt-3 ml-6 px-3 py-2 rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-700 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700 dark:text-red-400 break-all">{error}</p>
                  </div>
                )}

                {result && result.length > 0 && (
                  <div className="mt-3 ml-6 px-3 py-2 rounded-md bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Check className="w-3.5 h-3.5 text-green-700 dark:text-green-400" />
                      <p className="text-xs font-medium text-green-800 dark:text-green-300">Merge complete</p>
                    </div>
                    <table className="text-xs w-full">
                      <tbody>
                        {result.map((r, i) => (
                          <tr key={i}>
                            <td className="text-gray-600 dark:text-gray-400 pr-3">{r.action}</td>
                            <td className="text-gray-900 dark:text-gray-100 font-mono text-right">
                              {r.count === null || r.count === undefined ? '—' : r.count.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Version history */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Version history</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            {versionHistory.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic p-4 text-center">No versions or snapshots yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="text-left px-3 py-2 font-normal">Type</th>
                    <th className="text-left px-3 py-2 font-normal">Label</th>
                    <th className="text-left px-3 py-2 font-normal">Date range</th>
                    <th className="text-left px-3 py-2 font-normal">Taken at</th>
                    <th className="text-right px-3 py-2 font-normal">Rows</th>
                    <th className="text-right px-3 py-2 font-normal">View</th>
                  </tr>
                </thead>
                <tbody>
                  {versionHistory.map(v => (
                    <tr key={`${v.kind}-${v.id}`} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-2">
                        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                          v.kind === 'price' 
                            ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300' 
                            : 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300'
                        }`}>
                          {v.kind === 'price' ? 'Price' : 'Packages'}
                        </span>
                        {v.is_current && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">
                            Current
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{v.label || <span className="text-gray-400 dark:text-gray-500 italic">—</span>}</span>
                        {v.notes && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{v.notes}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                        {v.start_date || v.end_date ? (
                          <>
                            {v.start_date ?? '—'} → {v.end_date ?? '—'}
                          </>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {formatDateTime(v.taken_at)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">
                        {v.row_count != null ? v.row_count.toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a
                          href={`/admin/version/${v.id}?kind=${v.kind}`}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          View →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-xl">
          <p className="text-xs font-medium text-blue-900 dark:text-blue-300 mb-1">Quick reference — upload order</p>
          <ol className="text-xs text-blue-800 dark:text-blue-300 space-y-1 list-decimal list-inside">
            <li>Take a packages snapshot if making structural changes (e.g. retiring old products)</li>
            <li>Packages first (so price_variants can match by package_code)</li>
            <li>Price variants second (creates a new labelled pricing version)</li>
            <li>Discounts last (matches by package_code, needs packages in place)</li>
          </ol>
        </div>
      </main>
    </div>
  )
}
