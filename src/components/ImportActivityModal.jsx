import { useEffect, useRef, useState } from 'react'
import { ocrImage, parseActivityText, markDuplicates } from '../lib/parseScreenshot.js'

// Paste / drop / pick a Wealthsimple "Activity" screenshot → local OCR → an editable
// review table → onApply(rows). Nothing is applied until you confirm, so OCR slips
// (missing amounts, a wrong buy/sell) are easy to fix first.
let rowSeq = 0
const mkRow = (r) => ({
  id: ++rowSeq,
  import: !r.isDuplicate,
  date: r.date,
  type: r.type,
  symbol: r.symbol,
  amount: r.amount == null ? '' : String(r.amount),
  currency: r.currency || 'CAD',
  needsAmount: r.needsAmount,
  isDuplicate: !!r.isDuplicate,
  dupHint: r.dupHint || '',
})

export default function ImportActivityModal({ open, onClose, onApply, existingTxns }) {
  const [stage, setStage] = useState('drop') // drop | ocr | review
  const [progress, setProgress] = useState(0)
  const [imgUrl, setImgUrl] = useState('')
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  // Reset to a clean slate every time the modal opens.
  useEffect(() => {
    if (open) {
      setStage('drop')
      setProgress(0)
      setImgUrl('')
      setRows([])
      setError('')
    }
  }, [open])

  // Grab an image from a Ctrl+V paste anywhere while the modal is open.
  useEffect(() => {
    if (!open) return
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'))
      if (item) {
        e.preventDefault()
        handleImage(item.getAsFile())
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  async function handleImage(file) {
    if (!file) return
    setError('')
    setImgUrl(URL.createObjectURL(file))
    setStage('ocr')
    setProgress(0)
    try {
      const text = await ocrImage(file, setProgress)
      const parsed = markDuplicates(parseActivityText(text), existingTxns || [])
      if (!parsed.length) {
        setError("Couldn't find any trades in that image. Make sure it's a clear shot of the Activity list, then try again.")
        setStage('drop')
        return
      }
      setRows(parsed.map(mkRow))
      setStage('review')
    } catch (err) {
      setError('OCR failed: ' + (err?.message || err))
      setStage('drop')
    }
  }

  function onDrop(e) {
    e.preventDefault()
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'))
    if (file) handleImage(file)
  }

  const setField = (id, field, value) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id))
  const addRow = () =>
    setRows((rs) => [
      ...rs,
      mkRow({ date: new Date().toISOString().slice(0, 10), type: 'buy', symbol: '', amount: null, currency: 'CAD', needsAmount: true }),
    ])

  const isCash = (t) => t === 'deposit' || t === 'withdrawal'
  // A trade needs a symbol; a deposit/withdrawal doesn't. Both need a positive amount.
  const valid = (r) => r.import && parseFloat(r.amount) > 0 && (isCash(r.type) || r.symbol.trim())
  const selected = rows.filter(valid)

  function apply() {
    onApply(
      selected.map((r) => ({
        date: r.date,
        type: r.type,
        symbol: isCash(r.type) ? '' : r.symbol.trim().toUpperCase(),
        amount: parseFloat(r.amount),
        currency: r.currency,
      })),
    )
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Paste activity screenshot</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {error && <div className="modal-err">{error}</div>}

        {stage === 'drop' && (
          <div
            className="dropzone"
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
          >
            <div className="dz-big">📋</div>
            <p>
              <strong>Press Ctrl+V</strong> to paste a screenshot of your Wealthsimple <em>Activity</em> list
            </p>
            <p className="muted">…or drag an image here, or click to choose a file</p>
            <p className="muted dz-note">
              Runs entirely on your device — the image never leaves your computer.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) handleImage(f)
              }}
            />
          </div>
        )}

        {stage === 'ocr' && (
          <div className="ocr-stage">
            {imgUrl && <img className="ocr-thumb" src={imgUrl} alt="screenshot" />}
            <div className="ocr-bar">
              <div className="ocr-fill" style={{ width: Math.round(progress * 100) + '%' }} />
            </div>
            <p className="muted">Reading text… {Math.round(progress * 100)}%</p>
          </div>
        )}

        {stage === 'review' && (
          <>
            <p className="muted modal-sub">
              Check the rows, fix anything OCR misread (highlighted rows need an amount), then apply.
              Trades already in your data are unchecked.
            </p>
            <div className="review-wrap">
              <table className="review-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Symbol</th>
                    <th className="r">Amount</th>
                    <th></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const bad = r.import && !(parseFloat(r.amount) > 0)
                    return (
                      <tr key={r.id} className={(r.import ? '' : 'row-off') + (bad ? ' row-bad' : '')}>
                        <td>
                          <input type="checkbox" checked={r.import} onChange={(e) => setField(r.id, 'import', e.target.checked)} />
                        </td>
                        <td>
                          <input className="rv-date" type="date" value={r.date} onChange={(e) => setField(r.id, 'date', e.target.value)} />
                        </td>
                        <td>
                          <select value={r.type} onChange={(e) => setField(r.id, 'type', e.target.value)}>
                            <option value="buy">buy</option>
                            <option value="sell">sell</option>
                            <option value="deposit">deposit</option>
                            <option value="withdrawal">withdrawal</option>
                          </select>
                        </td>
                        <td>
                          <input
                            className="rv-sym"
                            value={r.symbol}
                            placeholder={isCash(r.type) ? '—' : ''}
                            disabled={isCash(r.type)}
                            onChange={(e) => setField(r.id, 'symbol', e.target.value.toUpperCase())}
                          />
                        </td>
                        <td className="r">
                          <input
                            className={'rv-amt' + (bad ? ' rv-amt-bad' : '')}
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={r.amount}
                            onChange={(e) => setField(r.id, 'amount', e.target.value)}
                          />
                        </td>
                        <td className="rv-tag">
                          {r.isDuplicate ? (
                            <span className="pill pill-dup" title="Already in your loaded activity">already in data</span>
                          ) : r.needsAmount && !(parseFloat(r.amount) > 0) ? (
                            <span className="pill pill-need" title={r.dupHint || 'OCR could not read the amount'}>enter amount</span>
                          ) : r.dupHint ? (
                            <span className="pill pill-hint" title={r.dupHint}>check</span>
                          ) : (
                            <span className="pill pill-new">new</span>
                          )}
                        </td>
                        <td>
                          <button className="rv-del" onClick={() => removeRow(r.id)} aria-label="Remove row">×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="modal-foot">
              <button onClick={addRow}>+ Add row</button>
              <div className="modal-foot-right">
                <button onClick={onClose}>Cancel</button>
                <button className="primary" onClick={apply} disabled={!selected.length}>
                  Apply {selected.length} trade{selected.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
