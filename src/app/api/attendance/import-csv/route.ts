import { NextRequest, NextResponse } from 'next/server'
import { saveCsvRows, type CsvRow } from '@/lib/attendance/sync'
import { format } from 'date-fns'

// Parses the Talexio attendance CSV format:
// Row structure per day:
//   "April 6",,Location In,Location In Latitude,Location In Longitude,...
//   firstName,lastName,locationIn,latIn,lngIn,timeIn,locationOut,latOut,lngOut,timeOut,hours,comments
function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/)
  const rows: CsvRow[] = []
  let currentDate: string | null = null
  let year = new Date().getFullYear()

  // Try extract year from first line e.g. "WEEK 15 (06-12/04/2026)"
  const yearMatch = lines[0]?.match(/\/(\d{4})/)
  if (yearMatch) year = parseInt(yearMatch[1])

  const MONTHS: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  }

  for (const line of lines) {
    const cols = line.split(',')
    const first = (cols[0] ?? '').trim().toLowerCase()

    // Detect day header lines like "April 6" (col 0 = month, col 1 = "" + rest are headers)
    const monthKey = Object.keys(MONTHS).find(m => first.startsWith(m))
    if (monthKey && cols[1]?.trim() === '') {
      const dayNum = parseInt(first.replace(monthKey, '').trim())
      if (!isNaN(dayNum)) {
        const month = MONTHS[monthKey]
        currentDate = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
      }
      continue
    }

    // Skip empty lines, week headers, column headers
    if (!currentDate || !first || first.includes('week') || first === 'location in') continue

    // Skip rows where col[0] looks like a header (e.g. "location in latitude")
    if (first.includes('latitude') || first.includes('longitude')) continue

    const [
      firstName, lastName,
      locationIn, latInStr, lngInStr, timeIn,
      locationOut, latOutStr, lngOutStr, timeOut,
      hours, ...commentParts
    ] = cols.map(c => c.trim())

    if (!firstName || !lastName) continue

    const validTime  = (v: string) => (v && v !== 'n/a' && /^\d{1,2}:\d{2}$/.test(v)) ? v : null
    const validFloat = (v: string) => (v && v !== 'n/a') ? parseFloat(v) : null

    rows.push({
      date:        currentDate,
      firstName,
      lastName,
      locationIn:  (locationIn  && locationIn  !== 'n/a') ? locationIn  : null,
      latIn:       validFloat(latInStr),
      lngIn:       validFloat(lngInStr),
      timeIn:      validTime(timeIn),
      locationOut: (locationOut && locationOut !== 'n/a') ? locationOut : null,
      latOut:      validFloat(latOutStr),
      lngOut:      validFloat(lngOutStr),
      timeOut:     validTime(timeOut),
      hours:       (hours && hours !== 'n/a') ? hours : null,
      comments:    commentParts.join(',').trim() || null,
    })
  }

  return rows
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const text = await file.text()
    const rows = parseCsv(text)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid rows found in CSV' }, { status: 400 })
    }

    const result = await saveCsvRows(rows)
    return NextResponse.json({ ok: true, parsed: rows.length, ...result })
  } catch (err) {
    console.error('[attendance/import-csv]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 },
    )
  }
}
