import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseRoute } from '../src/lib/router.ts'

describe('parseRoute', () => {
  it('extracts tab and page for standard console routes', () => {
    assert.deepEqual(parseRoute('/borrower'), { tab: 'borrower', page: '/' })
    assert.deepEqual(parseRoute('/borrower/propose'), { tab: 'borrower', page: '/propose' })
    assert.deepEqual(parseRoute('/lender/repo/42'), { tab: 'lender', page: '/repo/42' })
    assert.deepEqual(parseRoute('/market'), { tab: 'market', page: '/' })
    assert.deepEqual(parseRoute('/identity?wallet=0x1234'), { tab: 'identity', page: '/' })
  })

  it('falls back to borrower tab for bare routes', () => {
    assert.deepEqual(parseRoute('/'), { tab: 'borrower', page: '/' })
    assert.deepEqual(parseRoute('/repo/7'), { tab: 'borrower', page: '/repo/7' })
  })
})
