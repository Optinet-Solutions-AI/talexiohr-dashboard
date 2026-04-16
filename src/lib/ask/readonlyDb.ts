import { Pool } from 'pg'

let pool: Pool | null = null

function getPool(): Pool {
  if (pool) return pool
  const url = process.env.DATABASE_URL_READONLY
  if (!url) throw new Error('DATABASE_URL_READONLY is not set')
  pool = new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
  return pool
}

export type ReadonlyResult = {
  rows: unknown[]
  rowCount: number
  truncated: boolean
}

export async function executeReadonly(query: string): Promise<ReadonlyResult> {
  const client = await getPool().connect()
  try {
    const res = await client.query('SELECT ask_ai_execute($1) AS data', [query])
    const rows = (res.rows[0]?.data ?? []) as unknown[]
    return {
      rows,
      rowCount: rows.length,
      truncated: rows.length >= 500,
    }
  } finally {
    client.release()
  }
}
