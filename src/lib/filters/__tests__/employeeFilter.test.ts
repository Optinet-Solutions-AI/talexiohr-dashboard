import { describe, it, expect } from 'vitest'
import { locationGroup, parseFilters, selectEmployees, groupCounts, type FilterableEmployee } from '../employeeFilter'

function emp(over: Partial<FilterableEmployee> & { id: string }): FilterableEmployee {
  return { full_name: over.id, country: null, is_terminated: false, excluded: false, ...over }
}

describe('locationGroup', () => {
  it('maps Malta and Bulgaria, everything else to other', () => {
    expect(locationGroup('Malta')).toBe('malta')
    expect(locationGroup('Bulgaria')).toBe('bulgaria')
    expect(locationGroup('Spain')).toBe('other')
    expect(locationGroup(null)).toBe('other')
  })
})

describe('parseFilters', () => {
  it('parses empty params to defaults', () => {
    expect(parseFilters({})).toEqual({ employeeIds: [], locations: [], includeTerminated: false })
  })
  it('parses csv employees and locations, ignores invalid locations', () => {
    expect(parseFilters({ employees: 'a,b', locations: 'malta,xyz,other', terminated: '1' }))
      .toEqual({ employeeIds: ['a', 'b'], locations: ['malta', 'other'], includeTerminated: true })
  })
  it('treats terminated other than "1" as false', () => {
    expect(parseFilters({ terminated: '0' }).includeTerminated).toBe(false)
  })
})

describe('selectEmployees', () => {
  const list = [
    emp({ id: 'mt', country: 'Malta' }),
    emp({ id: 'bg', country: 'Bulgaria' }),
    emp({ id: 'es', country: 'Spain' }),
    emp({ id: 'x', country: 'Malta', excluded: true }),
    emp({ id: 'term', country: 'Malta', is_terminated: true }),
  ]
  it('drops excluded and terminated by default', () => {
    expect(selectEmployees(list, parseFilters({})).map(e => e.id)).toEqual(['mt', 'bg', 'es'])
  })
  it('includes terminated when requested (still drops excluded)', () => {
    expect(selectEmployees(list, parseFilters({ terminated: '1' })).map(e => e.id)).toEqual(['mt', 'bg', 'es', 'term'])
  })
  it('filters by location group', () => {
    expect(selectEmployees(list, parseFilters({ locations: 'bulgaria,other' })).map(e => e.id)).toEqual(['bg', 'es'])
  })
  it('filters by employee ids, AND-combined with location', () => {
    expect(selectEmployees(list, parseFilters({ locations: 'malta', employees: 'mt,bg' })).map(e => e.id)).toEqual(['mt'])
  })
})

describe('groupCounts', () => {
  it('counts per group, excluding excluded and (by default) terminated', () => {
    const list = [
      emp({ id: '1', country: 'Malta' }),
      emp({ id: '2', country: 'Malta' }),
      emp({ id: '3', country: 'Bulgaria' }),
      emp({ id: '4', country: 'Spain' }),
      emp({ id: '5', country: 'Malta', excluded: true }),
      emp({ id: '6', country: 'Malta', is_terminated: true }),
    ]
    expect(groupCounts(list, false)).toEqual({ malta: 2, bulgaria: 1, other: 1 })
    expect(groupCounts(list, true)).toEqual({ malta: 3, bulgaria: 1, other: 1 })
  })
})
