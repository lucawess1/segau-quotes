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
 * The Salesforce "Payment Information" fields, filled in from the quote.
 *
 * Only the fields Salesforce leaves editable and that the quote actually determines are copyable;
 * STC value and discounted price are shown read-only as a cross-check against what Salesforce will
 * calculate, and the customer-specific fields (deposit, cash amount, Smart Savings) are named but
 * left to the specialist.
 */
export default function SalesforceBreakdown(props: BreakdownInput) {
  const [open, setOpen] = useState(true)
  const b = buildSalesforceBreakdown(props)

  const copyAll = [
    ['Payment type', b.paymentType],
    ...b.rows.map(r => [r.label, raw(r.amount)]),
    ...(b.otherRebates > 0 ? [['Total value of other rebates', raw(b.otherRebates)]] : []),
  ].map(([k, v]) => `${k}\t${v}`).join('\n')

  return (
    <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Salesforce · Payment Information
        </button>
        {open && (
          <CopyButton value={copyAll} label="all Salesforce fields" />
        )}
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

          {b.rows.map(r => (
            <FieldRow
              key={r.key}
              label={r.label}
              display={money(r.amount)}
              copyValue={raw(r.amount)}
              note={r.extrasAmount !== 0
                ? `incl. ${money(r.extrasAmount)} extras (${r.extrasNames.length})`
                : undefined}
              noteTitle={r.extrasNames.join(', ')}
            />
          ))}

          {b.otherRebates > 0 && (
            <FieldRow
              label="Total value of other rebates"
              display={money(b.otherRebates)}
              copyValue={raw(b.otherRebates)}
              note="Combo discount"
            />
          )}

          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 space-y-0.5">
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">Salesforce calculates these — check they match</p>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">System total STC value</span>
              <span className="text-gray-600 dark:text-gray-300 tabular-nums">{money(b.stcTotal)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">System total discounted price</span>
              <span className="text-gray-600 dark:text-gray-300 tabular-nums">{money(b.discountedPrice)}</span>
            </div>
          </div>

          <p className="pt-2 text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
            Deposit amount, Cash amount and Smart Savings come from the customer — this quote doesn&apos;t set them.
          </p>
        </div>
      )}
    </div>
  )
}
