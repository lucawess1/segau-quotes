'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Zap, User, LogOut, Database, Play, Check, AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react'

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
  key: string
  label: string
  tableName: string
  functionName: string
  description: string
}

const BUILDER_TABLES: StagingTable[] = [
  {
    key: 'batteries',
    label: 'Batteries',
    tableName: 'builder_batteries_staging',
    functionName: 'merge_builder_batteries',
    description: 'Battery components (brand, kWh, model, cost). Used in Battery Only and Solar and Battery quotes.',
  },
  {
    key: 'inverters',
    label: 'Inverters',
    tableName: 'builder_inverters_staging',
    functionName: 'merge_builder_inverters',
    description: 'Inverter components (brand, phase, cost, gateway_cost). Required for all battery quotes.',
  },
  {
    key: 'pv',
    label: 'PV (solar panels)',
    tableName: 'builder_pv_staging',
    functionName: 'merge_builder_pv',
    description: 'PV system options (panel model, panel count, system size, cost). Used in Solar quotes.',
  },
  {
    key: 'solar_stc',
    label: 'Solar STC values',
    tableName: 'builder_solar_stc_staging',
    functionName: 'merge_builder_solar_stc',
    description: 'Solar STC rebate values by system size and year.',
  },
  {
    key: 'battery_stc',
    label: 'Battery STC values',
    tableName: 'builder_battery_stc_staging',
    functionName: 'merge_builder_battery_stc',
    description: 'Battery STC rebate values by kWh and year.',
  },
  {
    key: 'costs',
    label: 'Costs (overheads + install)',
    tableName: 'builder_costs_staging',
    functionName: 'merge_builder_costs',
    description: 'Per-product overheads and install costs (product_overhead, base_install, install_per_panel, install_per_kwh_over).',
  },
]

export default function BuilderAdminPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [results, setResults] = useState<Record<string, MergeResult[]>>({})
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    loadProfile()
    refreshCounts()
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
    for (const t of BUILDER_TABLES) {
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

  const runMerge = async (table: StagingTable) => {
    setRunning(prev => ({ ...prev, [table.key]: true }))
    setErrors(prev => ({ ...prev, [table.key]: '' }))
    setResults(prev => ({ ...prev, [table.key]: [] }))

    const { data, error } = await supabase.rpc(table.functionName)

    setRunning(prev => ({ ...prev, [table.key]: false }))

    if (error) {
      setErrors(prev => ({ ...prev, [table.key]: error.message }))
      return
    }
    if (data) {
      setResults(prev => ({ ...prev, [table.key]: data as MergeResult[] }))
    }
    refreshCounts()
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
            <Zap className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <p className="font-medium text-[15px]">Builder admin</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Manage builder channel components, STC, and costs</p>
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

        <a href="/admin" className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to admin
        </a>

        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Builder staging tables</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Upload via Supabase Table Editor first, then click Merge to apply.
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
          {BUILDER_TABLES.map(t => {
            const count = counts[t.key] ?? 0
            const isRunning = running[t.key]
            const error = errors[t.key]
            const result = results[t.key]
            const empty = count === 0

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
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 dark:bg-indigo-500 text-white rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
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

        <div className="mt-6 p-4 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 rounded-xl">
          <p className="text-xs font-medium text-indigo-900 dark:text-indigo-300 mb-1">Upload order suggestion</p>
          <ol className="text-xs text-indigo-800 dark:text-indigo-300 space-y-1 list-decimal list-inside">
            <li>Components first: Batteries, Inverters, PV</li>
            <li>STC values: Solar STC, Battery STC</li>
            <li>Costs last: per-product overheads and install rates</li>
          </ol>
        </div>
      </main>
    </div>
  )
}
