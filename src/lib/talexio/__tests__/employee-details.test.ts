import { describe, it, expect } from 'vitest'
import { resolveCountry, buildDetailUpdates, type RawPosition } from '../employee-details'

function pos(over: Partial<RawPosition>): RawPosition {
  return { startDate: null, endDate: null, isActive: false, country: null, ...over }
}

describe('resolveCountry', () => {
  it('returns null for no positions', () => {
    expect(resolveCountry([])).toBe(null)
  })
  it('uses the active position (isActive) country', () => {
    expect(resolveCountry([
      pos({ startDate: '2024-01-01', endDate: '2025-01-01', isActive: false, country: { name: 'Spain' } }),
      pos({ startDate: '2025-01-02', endDate: null, isActive: true, country: { name: 'Malta' } }),
    ])).toBe('Malta')
  })
  it('treats endDate null as active when isActive flag is absent/false', () => {
    expect(resolveCountry([pos({ startDate: '2025-01-01', endDate: null, country: { name: 'Bulgaria' } })])).toBe('Bulgaria')
  })
  it('falls back to the latest position by startDate when none active', () => {
    expect(resolveCountry([
      pos({ startDate: '2023-01-01', endDate: '2023-12-31', country: { name: 'Spain' } }),
      pos({ startDate: '2024-06-01', endDate: '2024-12-31', country: { name: 'Malta' } }),
    ])).toBe('Malta')
  })
  it('returns null when the resolved position has no country', () => {
    expect(resolveCountry([pos({ startDate: '2025-01-01', endDate: null, country: null })])).toBe(null)
  })
})

describe('buildDetailUpdates', () => {
  it('maps details to upsert rows', () => {
    expect(buildDetailUpdates([
      { id: '1', isTerminated: false, positions: [pos({ endDate: null, isActive: true, country: { name: 'Malta' } })] },
      { id: '2', isTerminated: true, positions: [] },
    ])).toEqual([
      { talexio_id: '1', country: 'Malta', is_terminated: false },
      { talexio_id: '2', country: null, is_terminated: true },
    ])
  })
})
