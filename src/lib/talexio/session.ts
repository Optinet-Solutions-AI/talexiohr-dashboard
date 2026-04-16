const API_URL = 'https://api.talexiohr.com/graphql'
const DOMAIN = 'roosterpartners.talexiohr.com'

/**
 * Login via Talexio's loginUser mutation to get a session Bearer token.
 * Returns the JWT token string.
 */
export async function loginTalexio(): Promise<string> {
  const email = process.env.TALEXIO_EMAIL
  const password = process.env.TALEXIO_PASSWORD

  if (!email || !password) {
    throw new Error('TALEXIO_EMAIL and TALEXIO_PASSWORD must be set in .env.local')
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'client-domain': DOMAIN,
      'apollographql-client-name': 'talexio-hr-frontend',
      'apollographql-client-version': '1.0',
    },
    body: JSON.stringify({
      operationName: 'LoginUser',
      query: `mutation LoginUser($emailAddress: String!, $password: String!) {
        loginUser(emailAddress: $emailAddress, password: $password) {
          token
          domain
          expiry
        }
      }`,
      variables: { emailAddress: email, password: password },
    }),
    cache: 'no-store',
  })

  const json = await res.json()

  if (json.errors?.length) {
    throw new Error(`Login failed: ${json.errors.map((e: { message: string }) => e.message).join(', ')}`)
  }

  const token = json.data?.loginUser?.token
  if (!token) throw new Error('Login returned no token')

  return token
}

/**
 * Trigger the timesheet export via the REST endpoint.
 * Returns the background job ID.
 */
export async function triggerExport(token: string, dateFrom: string, dateTo: string): Promise<number> {
  const res = await fetch('https://api.talexiohr.com/exportInsightsChart', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authorization': `Bearer ${token}`,
      'client-domain': DOMAIN,
      'expect-ct': 'max-age=0, report-uri="https://api.talexiohr.com/ct-error"',
    },
    body: JSON.stringify({
      dateFrom,
      dateTo,
      chartType: 'WEEKLY_SHIFT_OVERVIEW',
    }),
    cache: 'no-store',
  })

  const json = await res.json()

  if (typeof json === 'number') return json
  if (json.jobId) return json.jobId
  if (json.id) return json.id
  if (json.error) throw new Error(`Export trigger failed: ${json.error}`)

  throw new Error(`Unexpected export response: ${JSON.stringify(json)}`)
}

/**
 * Poll the BackgroundJobQuery until it completes.
 * Returns the full job result including file URL and time log data.
 */
export async function pollBackgroundJob(token: string, jobId: number, maxAttempts = 30): Promise<{
  jobStatus: string
  file: { id: string; fileUrl: string } | null
  result: unknown
}> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${token}`,
        'client-domain': DOMAIN,
        'apollographql-client-name': 'talexio-hr-frontend',
        'apollographql-client-version': '1.0',
      },
      body: JSON.stringify({
        operationName: 'BackgroundJobQuery',
        query: `query BackgroundJobQuery($id: ID!) {
          backgroundJob(id: $id) {
            id
            jobStatus
            jobType
            estimatedCompletionOn
            file {
              id
              fileUrl
            }
            result {
              ... on BackgroundJobResultWithWarnings {
                warnings
              }
            }
          }
        }`,
        variables: { id: jobId },
      }),
      cache: 'no-store',
    })

    const json = await res.json()

    if (json.errors?.length) {
      throw new Error(`BackgroundJob poll error: ${json.errors.map((e: { message: string }) => e.message).join(', ')}`)
    }

    const job = json.data?.backgroundJob
    if (!job) throw new Error('BackgroundJob not found')

    if (job.jobStatus === 'COMPLETED' || job.jobStatus === 'COMPLETED_WITH_WARNINGS') {
      return {
        jobStatus: job.jobStatus,
        file: job.file,
        result: job.result,
      }
    }

    if (job.jobStatus === 'FAILED' || job.jobStatus === 'CANCELLED') {
      throw new Error(`Background job ${job.jobStatus}: ${JSON.stringify(job.result)}`)
    }

    // Wait 2 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error(`Background job timed out after ${maxAttempts} attempts`)
}

/**
 * Download the exported file (CSV) from Talexio's file URL.
 */
export async function downloadExportFile(_token: string, fileUrl: string): Promise<ArrayBuffer> {
  // fileUrl is a pre-signed S3 URL — do NOT send auth headers (S3 rejects dual auth)
  const url = fileUrl.startsWith('http') ? fileUrl : `https://api.talexiohr.com${fileUrl}`

  const res = await fetch(url, { cache: 'no-store' })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`File download failed (${res.status}): url=${url} body=${body.slice(0, 200)}`)
  }

  return await res.arrayBuffer()
}
