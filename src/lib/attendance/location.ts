/** Malta head office coordinates + match radius (km). */
export const OFFICE_LAT = 35.9222072
export const OFFICE_LNG = 14.4878368
export const OFFICE_KM = 0.15

function gpsKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** True if the location name reads as the office, or the GPS is within OFFICE_KM of it. */
export function isOfficeLocation(name: string | null, lat: number | null, lng: number | null): boolean {
  if (name) {
    const l = name.toLowerCase()
    if (l.includes('head office') || l === 'office' || l.includes('ta office')) return true
  }
  if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
    return gpsKm(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_KM
  }
  return false
}

/** Office if clock-in OR clock-out at office; otherwise wfh (Malta) / remote. */
export function classifyClockedStatus(
  { inOffice, outOffice, isMalta }: { inOffice: boolean; outOffice: boolean; isMalta: boolean },
): 'office' | 'wfh' | 'remote' {
  if (inOffice || outOffice) return 'office'
  return isMalta ? 'wfh' : 'remote'
}

/** Render-time anomaly flags derived from the stored day. */
export function dayAnomalies(
  { timeIn, timeOut, inOffice, outOffice, inLocationKnown, outLocationKnown }:
  { timeIn: string | null; timeOut: string | null; inOffice: boolean; outOffice: boolean; inLocationKnown: boolean; outLocationKnown: boolean },
): { incomplete: boolean; locationMismatch: boolean } {
  const hasIn = Boolean(timeIn)
  const hasOut = Boolean(timeOut)
  return {
    incomplete: hasIn !== hasOut,
    locationMismatch: hasIn && hasOut && inLocationKnown && outLocationKnown && inOffice !== outOffice,
  }
}
