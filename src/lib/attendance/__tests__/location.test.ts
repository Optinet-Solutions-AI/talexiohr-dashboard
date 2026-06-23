import { describe, it, expect } from 'vitest'
import { isOfficeLocation, classifyClockedStatus, dayAnomalies, OFFICE_LAT, OFFICE_LNG } from '../location'

describe('isOfficeLocation', () => {
  it('matches office names case-insensitively', () => {
    expect(isOfficeLocation('Head Office', null, null)).toBe(true)
    expect(isOfficeLocation('office', null, null)).toBe(true)
    expect(isOfficeLocation('TA Office', null, null)).toBe(true)
    expect(isOfficeLocation('Home', null, null)).toBe(false)
  })
  it('matches GPS within 150m of the office', () => {
    expect(isOfficeLocation(null, OFFICE_LAT, OFFICE_LNG)).toBe(true)
    expect(isOfficeLocation('Not from the office', OFFICE_LAT + 0.05, OFFICE_LNG)).toBe(false)
  })
  it('returns false for null/NaN coords and null name', () => {
    expect(isOfficeLocation(null, null, null)).toBe(false)
    expect(isOfficeLocation(null, NaN, NaN)).toBe(false)
  })
})

describe('classifyClockedStatus', () => {
  it('is office when clock-in is at office', () => {
    expect(classifyClockedStatus({ inOffice: true, outOffice: false, isMalta: true })).toBe('office')
  })
  it('is office when clock-out is at office (the fix)', () => {
    expect(classifyClockedStatus({ inOffice: false, outOffice: true, isMalta: true })).toBe('office')
  })
  it('is wfh for a Malta employee neither in nor out at office', () => {
    expect(classifyClockedStatus({ inOffice: false, outOffice: false, isMalta: true })).toBe('wfh')
  })
  it('is remote for a non-Malta employee neither in nor out at office', () => {
    expect(classifyClockedStatus({ inOffice: false, outOffice: false, isMalta: false })).toBe('remote')
  })
})

describe('dayAnomalies', () => {
  it('flags incomplete when exactly one timestamp is present', () => {
    expect(dayAnomalies({ timeIn: '09:00', timeOut: null, inOffice: true, outOffice: false, inLocationKnown: true, outLocationKnown: false }).incomplete).toBe(true)
    expect(dayAnomalies({ timeIn: null, timeOut: '17:00', inOffice: false, outOffice: true, inLocationKnown: false, outLocationKnown: true }).incomplete).toBe(true)
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: true, outOffice: true, inLocationKnown: true, outLocationKnown: true }).incomplete).toBe(false)
    expect(dayAnomalies({ timeIn: null, timeOut: null, inOffice: false, outOffice: false, inLocationKnown: false, outLocationKnown: false }).incomplete).toBe(false)
  })
  it('flags locationMismatch only when both present, both locations known, and office-ness differs', () => {
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: false, outOffice: true, inLocationKnown: true, outLocationKnown: true }).locationMismatch).toBe(true)
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: true, outOffice: false, inLocationKnown: true, outLocationKnown: true }).locationMismatch).toBe(true)
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: true, outOffice: true, inLocationKnown: true, outLocationKnown: true }).locationMismatch).toBe(false)
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: false, outOffice: false, inLocationKnown: true, outLocationKnown: true }).locationMismatch).toBe(false)
  })
  it('never flags locationMismatch when out-location is unknown (false positive fix)', () => {
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: true, outOffice: false, inLocationKnown: true, outLocationKnown: false }).locationMismatch).toBe(false)
  })
  it('flags locationMismatch when both timestamps present and both locations known and office-ness differs', () => {
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: true, outOffice: false, inLocationKnown: true, outLocationKnown: true }).locationMismatch).toBe(true)
  })
  it('never flags locationMismatch for an incomplete day', () => {
    expect(dayAnomalies({ timeIn: '09:00', timeOut: null, inOffice: false, outOffice: true, inLocationKnown: true, outLocationKnown: false }).locationMismatch).toBe(false)
  })
})
