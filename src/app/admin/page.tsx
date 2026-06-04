'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Zap, User, LogOut, Database, Play, Check, AlertTriangle, RefreshCw } from 'lucide-react'

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
  key: 'packages' | 'price_variants' | 'discounts'
  label: string
  tableName: string
  functionName: string
  description: string
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
    description: 'Upsert prices and create a new pricing version (auto-dated).',
  },
  {
    key: 'discounts',
    label: 'Discounts',
    tableName: 'discounts_staging',
    functionName: 'merge_discounts',
    description: 'Upsert inbound discount amounts.',
  },
]

export default function AdminPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [results, setResults] = useState<Record<string, MergeResult[]>>({})
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    loadProfile()
    refreshCounts()
  }, [])

  // Access guard: kick non-admins back to /
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
            <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="font-medium text-[15px]">SEGAU Quote Builder — Admin</p>
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

        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-xl">
          <p className="text-xs font-medium text-blue-900 dark:text-blue-300 mb-1">Quick reference — upload order</p>
          <ol className="text-xs text-blue-800 dark:text-blue-300 space-y-1 list-decimal list-inside">
            <li>Packages first (so price_variants can match by package_code)</li>
            <li>Price variants second (creates a new pricing version)</li>
            <li>Discounts last (matches by package_code, needs packages in place)</li>
          </ol>
        </div>
      </main>
    </div>
  )
}
