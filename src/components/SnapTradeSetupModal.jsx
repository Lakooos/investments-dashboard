import { useEffect, useState } from 'react'
import { getState, saveKeys, register, connect, listAccounts, setAccount } from '../lib/snaptradeSource.js'

// One-time connect wizard for SnapTrade (Path B — the app reads your brokerage
// directly). Three steps:
//   1) keys     — paste your SnapTrade Client ID + Consumer Key (dashboard.snaptrade.com)
//   2) connect  — open the Wealthsimple login portal in your browser, link the account
//   3) account  — pick which connected account the dashboard should track
// onDone() fires once an account is chosen so the app can pull live data.
export default function SnapTradeSetupModal({ open, onClose, onDone }) {
  const [step, setStep] = useState('keys')
  const [clientId, setClientId] = useState('')
  const [consumerKey, setConsumerKey] = useState('')
  const [accounts, setAccounts] = useState([])
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [isPersonal, setIsPersonal] = useState(false)

  // When opened, jump to the right step based on what's already configured.
  // Personal keys skip the brokerage-link step (already connected on the dashboard).
  useEffect(() => {
    if (!open) return
    setError('')
    setBusy(false)
    getState()
      .then((s) => {
        setIsPersonal(!!s.isPersonal)
        if (s.hasAccount) setStep('account')
        else if (s.isPersonal) setStep('account')
        else if (s.registered) setStep('connect')
        else setStep('keys')
      })
      .catch(() => setStep('keys'))
  }, [open])

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      return await fn()
    } catch (e) {
      setError(e.message || String(e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  async function onSaveKeys() {
    try {
      const st = await run(async () => {
        const s = await saveKeys({ clientId, consumerKey })
        await register() // registers a SnapTrade user once; no-op for personal keys
        return s
      })
      setIsPersonal(!!st.isPersonal)
      if (st.isPersonal) {
        setStep('account') // personal keys are already connected — pick the account
        onLoadAccounts()
      } else {
        setStep('connect')
      }
    } catch {
      /* error shown in banner */
    }
  }

  async function onConnect() {
    try {
      await run(connect) // opens the Wealthsimple login portal in the real browser
    } catch {
      /* error shown in banner */
    }
  }

  async function onLoadAccounts() {
    try {
      const list = await run(listAccounts)
      setAccounts(list)
      const open1 = list.find((a) => (a.status || '').toLowerCase() === 'open') || list[0]
      if (open1) setPicked(open1.id)
      setStep('account')
    } catch {
      /* error shown in banner */
    }
  }

  async function onUseAccount() {
    const a = accounts.find((x) => x.id === picked)
    try {
      await run(() => setAccount({ accountId: picked, accountName: a ? a.name : null }))
      onDone()
    } catch {
      /* error shown in banner */
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Connect Wealthsimple (live)</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="seg seg-sm" style={{ marginBottom: 12 }}>
          <button className={step === 'keys' ? 'on' : ''} onClick={() => setStep('keys')}>1 · Keys</button>
          {!isPersonal && (
            <button className={step === 'connect' ? 'on' : ''} onClick={() => setStep('connect')}>2 · Link</button>
          )}
          <button className={step === 'account' ? 'on' : ''} onClick={() => setStep('account')}>
            {isPersonal ? '2' : '3'} · Account
          </button>
        </div>

        {error && <div className="modal-err">{error}</div>}

        {step === 'keys' && (
          <div className="setup-step">
            <p className="muted modal-sub">
              Create a free developer account at{' '}
              <a href="https://dashboard.snaptrade.com" target="_blank" rel="noreferrer">dashboard.snaptrade.com</a>,
              then paste your <strong>Client ID</strong> and <strong>Consumer Key</strong>. They're stored only on
              this device (never in the project), and the Consumer Key never leaves the app's background process.
            </p>
            <label className="setup-fld">
              <span>Client ID</span>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="YOUR-CLIENT-ID" />
            </label>
            <label className="setup-fld">
              <span>Consumer Key</span>
              <input type="password" value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} placeholder="••••••••••••" />
            </label>
            <div className="modal-foot">
              <span className="muted">Step 1 of {/^PERS/i.test(clientId.trim()) ? '2' : '3'}</span>
              <div className="modal-foot-right">
                <button onClick={onClose}>Cancel</button>
                <button className="primary" onClick={onSaveKeys} disabled={busy || !clientId.trim() || !consumerKey.trim()}>
                  {busy ? 'Saving…' : 'Save & continue'}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'connect' && (
          <div className="setup-step">
            <p className="muted modal-sub">
              Click below to open SnapTrade's secure connection portal in your browser, then log into
              <strong> Wealthsimple</strong> and authorize read access. When it says you're connected, come back here.
            </p>
            <div className="setup-actions">
              <button className="primary" onClick={onConnect} disabled={busy}>
                {busy ? 'Opening…' : '🔗 Open Wealthsimple login'}
              </button>
            </div>
            <div className="modal-foot">
              <span className="muted">Step 2 of 3</span>
              <div className="modal-foot-right">
                <button onClick={() => setStep('keys')}>Back</button>
                <button className="primary" onClick={onLoadAccounts} disabled={busy}>
                  {busy ? 'Loading…' : "I've connected → choose account"}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'account' && (
          <div className="setup-step">
            <p className="muted modal-sub">
              Pick the account the dashboard should track (your self-directed TFSA, most likely).
            </p>
            {!accounts.length && (
              <div className="setup-actions">
                <button onClick={onLoadAccounts} disabled={busy}>{busy ? 'Loading…' : 'Load my accounts'}</button>
              </div>
            )}
            <ul className="setup-accts">
              {accounts.map((a) => (
                <li key={a.id} className={picked === a.id ? 'on' : ''}>
                  <label>
                    <input type="radio" name="acct" checked={picked === a.id} onChange={() => setPicked(a.id)} />
                    <span className="acct-name">{a.name}</span>
                    <span className="muted acct-meta">
                      {a.type ? a.type + ' · ' : ''}{a.currency || ''}
                      {a.total != null ? ' · $' + Number(a.total).toLocaleString('en-CA', { maximumFractionDigits: 2 }) : ''}
                      {a.status && a.status.toLowerCase() !== 'open' ? ' · ' + a.status : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="modal-foot">
              <span className="muted">{isPersonal ? 'Step 2 of 2' : 'Step 3 of 3'}</span>
              <div className="modal-foot-right">
                <button onClick={() => setStep(isPersonal ? 'keys' : 'connect')}>Back</button>
                <button className="primary" onClick={onUseAccount} disabled={busy || !picked}>
                  {busy ? 'Saving…' : 'Use this account'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
