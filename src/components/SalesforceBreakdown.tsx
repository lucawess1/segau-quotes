'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check, AlertTriangle } from 'lucide-react'
import { buildSalesforceBreakdown, type BreakdownInput } from '@/lib/salesforce'

// Salesforce currency fields take a plain number, so the copied value never carries the $ or commas
// even though we display it formatted.
const money = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }).format(n)
const raw = (n: number) => n.toFixed(2)

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          // Clipboard can be blocked (insecure origin, permissions) — the value is on screen anyway.
        }
      }}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 md:p-1 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 flex-shrink-0"
    >
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
        : <Copy className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />}
    </button>
  )
}

function FieldRow({ label, display, copyValue, note, noteTitle }: {
  label: string
  display: string
  copyValue: string
  note?: string
  noteTitle?: string
}) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5">
      <div className="min-w-0">
        <p className="text-gray-500 dark:text-gray-400 leading-snug">{label}</p>
        {note && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 italic leading-snug" title={noteTitle}>{note}</p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-900 dark:text-gray-100 font-medium tabular-nums">{display}</span>
        <CopyButton value={copyValue} label={label} />
      </div>
    </div>
  )
}

/**
 * The Salesforce "Payment Information" fields, filled in from the quote — and the summary card's
 * only price breakdown, so every figure appears exactly once.
 *
 * Copyable rows are the fields Salesforce leaves editable and the quote determines. The STC value
 * is read-only over there so it reads as a deduction here, and the discounted price it derives is
 * the card's headline total rather than a repeated row. The products subtotal only appears when it
 * isn't already readable off the card — one product line restates itself, and with no STC to deduct
 * it restates the total.
 */
export default function SalesforceBreakdown({ zone, ...props }: BreakdownInput & { zone?: number | null }) {
  const [open, setOpen] = useState(true)
  const b = buildSalesforceBreakdown(props)

  // The summary card's header block already draws the divider above this, so no border here.
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Salesforce · Payment Information
        </button>
      </div>

      {open && (
        <div className="text-sm space-y-0.5">
          {b.variance !== 0 && (
            <div className="mb-2 px-2.5 py-2 rounded-md flex gap-2 items-start bg-amber-50 dark:bg-amber-950/50">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                {`Breakdown is ${money(Math.abs(b.variance))} ${b.variance > 0 ? 'above' : 'below'} the quote total — check with pricing before entering these.`}
              </p>
            </div>
          )}

          <FieldRow label="Payment type" display={b.paymentType} copyValue={b.paymentType} />

          {b.rows.map(r => {
            // The combo discount is already inside `amount`; the note is there so a specialist can
            // see why the line reads lower than the product's list price.
            const notes = [
              r.extrasAmount !== 0 ? `incl. ${money(r.extrasAmount)} extras (${r.extrasNames.length})` : null,
              r.comboDiscount !== 0 ? `less ${money(r.comboDiscount)} combo` : null,
            ].filter(Boolean)
            return (
              <FieldRow
                key={r.key}
                label={r.label}
                display={money(r.amount)}
                copyValue={raw(r.amount)}
                note={notes.length > 0 ? notes.join(' · ') : undefined}
                noteTitle={r.extrasNames.join(', ')}
              />
            )
          })}

          {/* Only worth a subtotal when it's a figure you can't already read off the card: more
              than one line to add up, and an STC deduction that makes it differ from the total. */}
          {b.rows.length > 1 && b.stcTotal > 0 && (
            <div className="flex justify-between gap-2 pt-1.5 mt-0.5 border-t border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Products before rebates</span>
              <span className="text-gray-700 dark:text-gray-300 font-medium tabular-nums">{money(b.productsTotal)}</span>
            </div>
          )}

          {b.stcTotal > 0 && (
            <div className="flex items-start justify-between gap-2 py-0.5">
              <div className="min-w-0">
                <p className="text-gray-500 dark:text-gray-400 leading-snug">System total STC value</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 italic leading-snug">
                  {zone ? `ZN${zone} · Salesforce calculates this` : 'Salesforce calculates this'}
                </p>
              </div>
              <span className="text-green-600 dark:text-green-400 font-medium tabular-nums">−{money(b.stcTotal)}</span>
            </div>
          )}

          <p className="mt-1.5 pt-2 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
            Salesforce works the discounted price out from these — it should match the total above.
            Deposit amount, Cash amount and Smart Savings come from the customer.
          </p>
        </div>
      )}
    </div>
  )
}
