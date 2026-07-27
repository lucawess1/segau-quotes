'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Zap, User, LogOut, UserPlus, Check, AlertTriangle, X } from 'lucide-react'

const supabase = createClient()

type Profile = {
  id: string
  email: string
  role: 'specialist' | 'admin'
  full_name: string | null
  teams: string[]
  active: boolean
}

type AllowlistEntry = {
  email: string
  role: string
  teams: string[]
  added_at: string
  notes: string | null
}

type SpecialistProfile = {
  id: string
  email: string
  full_name: string | null
  teams: string[]
  active: boolean
}

const MANAGEABLE_TEAMS = ['inbound', 'asc'] as const

export default function TeamPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([])
  const [specialists, setSpecialists] = useState<SpecialistProfile[]>([])
  const [loading, setLoading] = useState(true)

  const [newEmail, setNewEmail] = useState('')
  const [newTeams, setNewTeams] = useState<string[]>([])
  const [inviteError, setInviteError] = useState('')
  const [inviting, setInviting] = useState(false)

  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    loadProfile()
    loadAll()
  }, [])

  useEffect(() => {
    if (profile && profile.role !== 'admin' && !profile.teams?.includes('team_admin')) {
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
      .select('id, email, role, full_name, teams, active')
      .eq('id', user.id)
      .single()
    if (error) {
      console.error('Failed to load profile:', error)
      return
    }
    if (data && !data.active) {
      await supabase.auth.signOut()
      window.location.href = '/login?revoked=1'
      return
    }
    if (data) setProfile(data as Profile)
  }

  const loadAll = async () => {
    setLoading(true)
    const [allowlistRes, specialistsRes] = await Promise.all([
      supabase.from('allowlist').select('*').order('added_at', { ascending: false }),
      supabase.from('profiles').select('id, email, full_name, teams, active').eq('role', 'specialist').order('email'),
    ])
    if (allowlistRes.error) console.error('Failed to load allowlist:', allowlistRes.error)
    if (specialistsRes.error) console.error('Failed to load specialists:', specialistsRes.error)
    if (allowlistRes.data) setAllowlist(allowlistRes.data as AllowlistEntry[])
    if (specialistsRes.data) setSpecialists(specialistsRes.data as SpecialistProfile[])
    setLoading(false)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const specialistEmails = new Set(specialists.map(s => s.email.toLowerCase()))
  const pendingInvites = allowlist.filter(a => !specialistEmails.has(a.email.toLowerCase()))

  const sendInvite = async () => {
    const email = newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError('Enter a valid email address')
      return
    }
    setInviting(true)
    setInviteError('')
    const { error } = await supabase.from('allowlist').upsert({
      email,
      role: 'specialist',
      teams: newTeams,
      notes: null,
    })
    setInviting(false)
    if (error) {
      setInviteError(error.message)
      return
    }
    setNewEmail('')
    setNewTeams([])
    loadAll()
  }

  const removeInvite = async (email: string) => {
    setSavingKey(`invite:${email}`)
    const { error } = await supabase.from('allowlist').delete().eq('email', email)
    setSavingKey(null)
    if (error) {
      console.error('Failed to remove invite:', error)
      return
    }
    loadAll()
  }

  const toggleInviteTeam = async (entry: AllowlistEntry, team: string) => {
    const teams = entry.teams.includes(team) ? entry.teams.filter(t => t !== team) : [...entry.teams, team]
    setSavingKey(`invite:${entry.email}`)
    const { error } = await supabase.from('allowlist').update({ teams }).eq('email', entry.email)
    setSavingKey(null)
    if (error) {
      console.error('Failed to update invite teams:', error)
      return
    }
    loadAll()
  }

  const toggleSpecialistTeam = async (specialist: SpecialistProfile, team: string) => {
    const teams = specialist.teams.includes(team) ? specialist.teams.filter(t => t !== team) : [...specialist.teams, team]
    setSavingKey(`specialist:${specialist.id}`)
    const { error } = await supabase.from('profiles').update({ teams }).eq('id', specialist.id)
    setSavingKey(null)
    if (error) {
      console.error('Failed to update specialist teams:', error)
      return
    }
    loadAll()
  }

  const toggleSpecialistActive = async (specialist: SpecialistProfile) => {
    setSavingKey(`active:${specialist.id}`)
    const { error } = await supabase.from('profiles').update({ active: !specialist.active }).eq('id', specialist.id)
    setSavingKey(null)
    if (error) {
      console.error('Failed to update active status:', error)
      return
    }
    loadAll()
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <main className="max-w-3xl mx-auto p-3 md:p-6">
        <header className="flex items-center justify-between pb-3 mb-5 border-b border-gray-200 dark:border-gray-700 gap-2">
          <div className="flex items-center gap-2.5">
            <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="font-medium text-[15px]">SE Pricing Builder — Team</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Onboard and manage specialist access</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <User className="w-3.5 h-3.5" />
              <span>{profile?.full_name?.split(' ')[0] || profile?.email?.split('@')[0] || '…'}</span>
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

        {/* Invite form */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-2 mb-3">
            <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">Invite a specialist</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                They&apos;ll get access the moment they sign in with Google — no other setup needed.
              </p>
            </div>
          </div>
          <div className="ml-6 space-y-2">
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
            />
            <div className="flex items-center gap-4">
              {MANAGEABLE_TEAMS.map(team => (
                <label key={team} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newTeams.includes(team)}
                    onChange={e => setNewTeams(e.target.checked ? [...newTeams, team] : newTeams.filter(t => t !== team))}
                    className="w-4 h-4 accent-blue-600 dark:accent-blue-400"
                  />
                  <span className="capitalize">{team}</span>
                </label>
              ))}
            </div>
            <button
              onClick={sendInvite}
              disabled={inviting || !newEmail.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 dark:bg-blue-500 text-white rounded-md hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {inviting ? 'Inviting…' : 'Send invite'}
            </button>
            {inviteError && (
              <div className="px-3 py-2 rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-700 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-400">{inviteError}</p>
              </div>
            )}
          </div>
        </div>

        {/* Pending invites */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4">
          <p className="font-medium text-sm mb-3">Pending invites ({pendingInvites.length})</p>
          {loading ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic py-2">Loading…</p>
          ) : pendingInvites.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic py-2">No pending invites — everyone invited has signed in</p>
          ) : (
            <div className="space-y-1.5">
              {pendingInvites.map(entry => (
                <div key={entry.email} className="flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-800 rounded-md px-3 py-2">
                  <span className="text-sm truncate">{entry.email}</span>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {MANAGEABLE_TEAMS.map(team => (
                      <label key={team} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={entry.teams.includes(team)}
                          disabled={savingKey === `invite:${entry.email}`}
                          onChange={() => toggleInviteTeam(entry, team)}
                          className="w-3.5 h-3.5 accent-blue-600 dark:accent-blue-400"
                        />
                        <span className="capitalize">{team}</span>
                      </label>
                    ))}
                    <button
                      onClick={() => removeInvite(entry.email)}
                      disabled={savingKey === `invite:${entry.email}`}
                      className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-40"
                      aria-label="Remove invite"
                      title="Remove invite"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active specialists */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <p className="font-medium text-sm mb-3">Specialists ({specialists.length})</p>
          {loading ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic py-2">Loading…</p>
          ) : specialists.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic py-2">No specialists yet</p>
          ) : (
            <div className="space-y-1.5">
              {specialists.map(s => (
                <div key={s.id} className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 ${s.active ? 'bg-gray-50 dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-800 opacity-50'}`}>
                  <div className="min-w-0">
                    <p className="text-sm truncate">{s.full_name || s.email}</p>
                    {s.full_name && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{s.email}</p>}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {MANAGEABLE_TEAMS.map(team => (
                      <label key={team} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={s.teams.includes(team)}
                          disabled={savingKey === `specialist:${s.id}`}
                          onChange={() => toggleSpecialistTeam(s, team)}
                          className="w-3.5 h-3.5 accent-blue-600 dark:accent-blue-400"
                        />
                        <span className="capitalize">{team}</span>
                      </label>
                    ))}
                    <button
                      onClick={() => toggleSpecialistActive(s)}
                      disabled={savingKey === `active:${s.id}`}
                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md ${
                        s.active
                          ? 'text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50'
                          : 'text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/50'
                      }`}
                    >
                      {s.active ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                      {s.active ? 'Revoke' : 'Reactivate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
