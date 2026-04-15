import { talexioQuery } from './client'

export interface TalexioEmployee {
  id: string
  firstName: string
  lastName: string
  fullName: string
}

export interface TalexioWorkLocation {
  id: string
  name: string
  long: number | null
  lat: number | null
}

export interface TalexioWorkCode {
  id: string
  name: string
  code: string
}

export interface TalexioTimeLog {
  id: string
  from: string | null               // DateTime ISO string
  to: string | null                 // DateTime ISO string
  locationLatIn: number | null
  locationLongIn: number | null
  locationAccuracyIn: number | null
  locationLatOut: number | null
  locationLongOut: number | null
  locationAccuracyOut: number | null
  label: string | null
  employee: {
    id: string
    fullName: string
    firstName: string
    lastName: string
  }
  workLocationIn: TalexioWorkLocation | null
  workLocationOut: TalexioWorkLocation | null
  workCode: TalexioWorkCode | null
}

// ------------------------------------------------------------
// Fetch all employees
// ------------------------------------------------------------
export async function fetchEmployees(): Promise<TalexioEmployee[]> {
  const data = await talexioQuery<{ employees: TalexioEmployee[] }>({
    query: `
      query GetEmployees {
        employees {
          id
          firstName
          lastName
          fullName
        }
      }
    `,
  })
  return data.employees ?? []
}

// ------------------------------------------------------------
// Fetch time logs for a date range
// Params shape confirmed from network inspection:
//   { from, to, selectedUnitIds, selectedRoomIds, selectedEmployeeIds }
// ------------------------------------------------------------
export async function fetchTimeLogs(dateFrom: string, dateTo: string): Promise<TalexioTimeLog[]> {
  const PAGE_SIZE = 100
  let page = 1
  const all: TalexioTimeLog[] = []

  while (true) {
    const data = await talexioQuery<{
      pagedTimeLogs: { timeLogs: TalexioTimeLog[]; totalCount: number }
    }>({
      query: `
        query GetTimeLogs($params: TimeLogsFilterParams, $pageNumber: Int!, $pageSize: Int!) {
          pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize, withTotal: true) {
            totalCount
            timeLogs {
              id
              from
              to
              locationLatIn
              locationLongIn
              locationAccuracyIn
              locationLatOut
              locationLongOut
              locationAccuracyOut
              label
              employee {
                id
                fullName
                firstName
                lastName
              }
              workLocationIn {
                id
                name
                long
                lat
              }
              workLocationOut {
                id
                name
                long
                lat
              }
              workCode {
                id
                name
                code
              }
            }
          }
        }
      `,
      variables: {
        params: {
          from: dateFrom,
          to: dateTo,
          selectedUnitIds: [],
          selectedRoomIds: [],
          selectedEmployeeIds: [],
        },
        pageNumber: page,
        pageSize: PAGE_SIZE,
      },
    })

    const batch = data.pagedTimeLogs?.timeLogs ?? []
    all.push(...batch)

    if (all.length >= (data.pagedTimeLogs?.totalCount ?? 0) || batch.length === 0) break
    page++
  }

  return all
}
