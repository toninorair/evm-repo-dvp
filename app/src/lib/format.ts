import { formatUnits, parseUnits } from 'viem'

const nf = (min: number, max = min) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max })

/** 18-decimal token amount → "10,000,000.00". */
export function amount(value: bigint, digits = 2, decimals = 18) {
  return nf(digits).format(Number(formatUnits(value, decimals)))
}

export function eur(value: bigint, digits = 2) {
  return `€${amount(value, digits)}`
}

/** Compact €: 42_500_000e18 → "€42.50M". */
export function eurCompact(value: bigint) {
  const n = Number(formatUnits(value, 18))
  if (Math.abs(n) >= 1e9) return `€${nf(2).format(n / 1e9)}B`
  if (Math.abs(n) >= 1e6) return `€${nf(2).format(n / 1e6)}M`
  if (Math.abs(n) >= 1e3) return `€${nf(1).format(n / 1e3)}K`
  return `€${nf(2).format(n)}`
}

/** 8-decimal oracle price → "€92.00". */
export function price(value: bigint) {
  return `€${nf(2).format(Number(formatUnits(value, 8)))}`
}

export function bps(value: number, digits = 2) {
  return `${nf(digits).format(value / 100)}%`
}

export function shortAddr(a?: string) {
  if (!a) return '—'
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** Formats a repo identifier: 4n → "#0004". */
export function formatRepoId(id: bigint) {
  return `#${String(id).padStart(4, '0')}`
}

/**
 * Parses a human-entered decimal string (tolerating commas, underscores, spaces) into base units.
 * Returns `fallback` (default `0n`) on invalid input; returns `0n` on empty input.
 */
export function parseDecimal(input: string, decimals = 18, fallback = 0n): bigint {
  const cleaned = input.trim().replace(/[,_\s]/g, '')
  if (!cleaned) return 0n
  try {
    return parseUnits(cleaned, decimals)
  } catch {
    return fallback
  }
}

/** Term label: "O/N", "7d", "6h", "15m". */
export function tenor(seconds: number) {
  if (seconds === 86_400) return 'O/N'
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

export function date(ts: number) {
  return ts ? dateFmt.format(new Date(ts * 1000)) : '—'
}
export function time(ts: number) {
  return ts ? timeFmt.format(new Date(ts * 1000)) : '—'
}
export function dateTime(ts: number) {
  return ts ? `${date(ts)} · ${time(ts)}` : '—'
}

/** 6180 → "1h 43m"; under a minute shows seconds. */
export function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86_400)
  const h = Math.floor((s % 86_400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${s}s`
}

export function ago(seconds: number) {
  return seconds < 60 ? 'just now' : `${duration(seconds)} ago`
}
