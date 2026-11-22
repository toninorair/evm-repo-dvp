import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ago,
  amount,
  bps,
  duration,
  eur,
  eurCompact,
  formatRepoId,
  parseDecimal,
  price,
  shortAddr,
  tenor,
} from '../src/lib/format.ts'

const WAD = 10n ** 18n

describe('format helpers', () => {
  it('formats token amounts, EUR, compact EUR, oracle prices, and bps', () => {
    assert.equal(amount(1_234_567n * WAD, 2), '1,234,567.00')
    assert.equal(eur(1_000n * WAD), '€1,000.00')
    assert.equal(eurCompact(42_500_000n * WAD), '€42.50M')
    assert.equal(eurCompact(1_500_000_000n * WAD), '€1.50B')
    assert.equal(eurCompact(12_500n * WAD), '€12.5K')
    assert.equal(eurCompact(250n * WAD), '€250.00')
    assert.equal(price(92_50000000n), '€92.50')
    assert.equal(bps(350), '3.50%')
    assert.equal(bps(10_200, 1), '102.0%')
  })

  it('formats addresses and repo IDs', () => {
    assert.equal(shortAddr('0x9b7d0BaE4acDE189DAe646FEfbafFd9842E39233'), '0x9b7d…9233')
    assert.equal(shortAddr(undefined), '—')
    assert.equal(formatRepoId(4n), '#0004')
    assert.equal(formatRepoId(12345n), '#12345')
  })

  it('parses decimal strings with commas, spaces, and custom fallbacks', () => {
    assert.equal(parseDecimal('1,000,000', 18), 1_000_000n * WAD)
    assert.equal(parseDecimal('92.50', 8), 92_50000000n)
    assert.equal(parseDecimal('  ', 18), 0n)
    assert.equal(parseDecimal('not-a-number', 18), 0n)
    assert.equal(parseDecimal('not-a-number', 18, -1n), -1n)
  })

  it('formats tenors, durations, and relative ages', () => {
    assert.equal(tenor(86_400), 'O/N')
    assert.equal(tenor(7 * 86_400), '7d')
    assert.equal(tenor(3_600 * 6), '6h')
    assert.equal(tenor(600), '10m')
    assert.equal(tenor(45), '45s')

    assert.equal(duration(45), '45s')
    assert.equal(duration(125), '2m 05s')
    assert.equal(duration(6_180), '1h 43m')
    assert.equal(duration(90_000), '1d 1h')

    assert.equal(ago(12), 'just now')
    assert.equal(ago(180), '3m 00s ago')
  })
})
