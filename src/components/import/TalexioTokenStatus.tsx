'use client'

import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, AlertTriangle, KeyRound, RefreshCw, Save, ExternalLink } from 'lucide-react'

interface TokenStatus {
  state: 'valid' | 'expired' | 'missing' | 'unverified'
  source: 'db' | 'env' | 'none'
  expiresAt: string | null
  minutesRemaining: number | null
  updatedAt: string | null
  updatedBy: string | null
  liveCheck?: { ok: boolean; error?: string; httpStatus?: number }
}

function formatRelative(minutes: number | null): string {
  if (minutes == null) return ''
  const abs = Math.abs(minutes)
  const future = minutes > 0
  if (abs < 60) return future ? `in ${abs}m` : `${abs}m ago`
  if (abs < 60 * 24) return future ? `in ${Math.floor(abs / 60)}h` : `${Math.floor(abs / 60)}h ago`
  return future ? `in ${Math.floor(abs / 60 / 24)}d` : `${Math.floor(abs / 60 / 24)}d ago`
}

export default function TalexioTokenStatus() {
  const [status, setStatus] = useState<TokenStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveOk, setSaveOk] = useState(false)

  async function load(live = false) {
    if (live) setVerifying(true); else setLoading(true)
    try {
      const res = await fetch(`/api/talexio/token-status${live ? '?live=1' : ''}`, { cache: 'no-store' })
      const data = await res.json()
      setStatus(data)
    } finally {
      setLoading(false); setVerifying(false)
    }
  }

  useEffect(() => { load(true) }, [])

  async function handleSave() {
    setSaving(true); setSaveError(''); setSaveOk(false)
    try {
      const res = await fetch('/api/talexio/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error ?? 'Save failed')
        return
      }
      setSaveOk(true)
      setTokenInput('')
      setShowPaste(false)
      setStatus(data.status)
      setTimeout(() => setSaveOk(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Live-check failures are informational only — Talexio's probe queries can
  // fail even when the token works fine for the cron. Real validity comes
  // from the JWT-decoded expiry.
  const isAlert = status && (status.state === 'expired' || status.state === 'missing')
  const isValid = status && status.state === 'valid'
  const liveCheckFailed = status?.liveCheck && !status.liveCheck.ok

  return (
    <div className={`bg-white rounded-lg border overflow-hidden ${isAlert ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'}`}>
      <div className={`px-4 py-3 border-b ${isAlert ? 'border-red-200 bg-red-50' : 'border-slate-100'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound size={14} className={isAlert ? 'text-red-600' : 'text-slate-500'} />
            <h2 className={`text-sm font-semibold ${isAlert ? 'text-red-800' : 'text-slate-800'}`}>Talexio Token</h2>
          </div>
          <button onClick={() => load(true)} disabled={verifying || loading}
            className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50">
            {verifying ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Verify
          </button>
        </div>
        <p className={`text-xs mt-0.5 ${isAlert ? 'text-red-700' : 'text-slate-600'}`}>
          The cron and pull-from-Talexio button use this token. Talexio JWTs expire every ~7 days.
        </p>
      </div>

      <div className="p-4 space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Loader2 size={13} className="animate-spin" /> Checking token status...
          </div>
        )}

        {status && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                {isValid ? (
                  <><CheckCircle2 size={13} className="text-emerald-600" /><span className="font-medium text-emerald-700">Valid</span></>
                ) : status.state === 'expired' ? (
                  <><AlertTriangle size={13} className="text-red-600" /><span className="font-medium text-red-700">Expired</span></>
                ) : status.state === 'missing' ? (
                  <><AlertTriangle size={13} className="text-red-600" /><span className="font-medium text-red-700">Not configured</span></>
                ) : (
                  <><AlertTriangle size={13} className="text-amber-600" /><span className="font-medium text-amber-700">Unverified</span></>
                )}
              </div>

              {status.expiresAt && (
                <div className="text-slate-600">
                  Expires <span className="font-medium text-slate-800">{formatRelative(status.minutesRemaining)}</span>
                  <span className="text-slate-400"> · {new Date(status.expiresAt).toLocaleString()}</span>
                </div>
              )}

              <div className="text-slate-500">
                Source: <span className="font-mono">{status.source}</span>
                {status.updatedAt && (
                  <span className="ml-2 text-slate-400">
                    pasted {new Date(status.updatedAt).toLocaleString()}
                    {status.updatedBy ? ` by ${status.updatedBy}` : ''}
                  </span>
                )}
              </div>
            </div>

            {liveCheckFailed && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
                <AlertTriangle size={12} className="inline mr-1" />
                Talexio probe returned a non-fatal error: {status.liveCheck!.error}
                {status.liveCheck!.httpStatus ? ` (HTTP ${status.liveCheck!.httpStatus})` : ''}.
                <span className="block mt-1 text-amber-700">
                  This is informational only — the cron will still run with this token. The real signal is whether the next daily sync succeeds.
                </span>
              </div>
            )}

            {(isAlert || status.state === 'unverified') && !showPaste && (
              <button onClick={() => setShowPaste(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-indigo-700">
                Paste new token
              </button>
            )}

            {!isAlert && status.state === 'valid' && !showPaste && (
              <button onClick={() => setShowPaste(true)}
                className="text-xs text-slate-600 hover:text-slate-900 underline">
                Replace token
              </button>
            )}
          </>
        )}

        {showPaste && (
          <div className="rounded-md bg-slate-50 border border-slate-200 p-3 space-y-2">
            <div className="text-xs text-slate-700 space-y-2">
              <p className="font-medium">How to get a fresh token (two options):</p>

              <div>
                <p className="font-medium text-slate-700">Option A — Talexio dashboard (preferred)</p>
                <ol className="list-decimal list-inside space-y-0.5 text-slate-600 ml-1">
                  <li>Log into Talexio (solve the captcha)</li>
                  <li>Go to your access-token / API-token page in Talexio settings</li>
                  <li>Generate or copy the access token</li>
                  <li>Paste it below as-is — no <span className="font-mono">Bearer </span> prefix</li>
                </ol>
              </div>

              <div>
                <p className="font-medium text-slate-700">Option B — DevTools (fallback)</p>
                <ol className="list-decimal list-inside space-y-0.5 text-slate-600 ml-1">
                  <li>Log into Talexio, open DevTools → Network tab</li>
                  <li>Click any page that loads data; find a request to <span className="font-mono">api.talexiohr.com/graphql</span></li>
                  <li>Copy the <span className="font-mono">authorization</span> header value and drop the leading <span className="font-mono">Bearer </span></li>
                </ol>
              </div>

              <a href="https://roosterpartners.talexiohr.com" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
                Open Talexio <ExternalLink size={10} />
              </a>
            </div>

            <textarea
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="Paste the JWT here (eyJ...)"
              rows={3}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-[11px] font-mono text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
            />

            <div className="flex items-center gap-2">
              <button onClick={handleSave} disabled={saving || !tokenInput.trim()}
                className="flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Validate & save
              </button>
              <button onClick={() => { setShowPaste(false); setTokenInput(''); setSaveError('') }}
                className="text-xs text-slate-600 hover:text-slate-900">
                Cancel
              </button>
            </div>

            {saveError && (
              <div className="text-xs text-red-700 bg-red-50 rounded p-2">
                <AlertTriangle size={11} className="inline mr-1" />{saveError}
              </div>
            )}
          </div>
        )}

        {saveOk && (
          <div className="text-xs text-emerald-700 bg-emerald-50 rounded p-2">
            <CheckCircle2 size={11} className="inline mr-1" /> Token saved. Cron and pulls will use this from now on.
          </div>
        )}
      </div>
    </div>
  )
}
