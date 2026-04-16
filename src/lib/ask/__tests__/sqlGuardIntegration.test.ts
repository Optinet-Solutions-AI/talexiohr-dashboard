import { describe, it, expect } from 'vitest'
import { executeReadonly } from '../readonlyDb'

const HAS_DB = !!process.env.DATABASE_URL_READONLY
const maybe = HAS_DB ? describe : describe.skip

maybe('Readonly DB defense layers (integration)', () => {
  it('runs a plain SELECT successfully', async () => {
    const res = await executeReadonly('SELECT count(*) AS n FROM employees')
    expect(res.rows.length).toBe(1)
  })

  it('blocks INSERT at the role level', async () => {
    await expect(
      executeReadonly("INSERT INTO employees (first_name, last_name) VALUES ('x','y')"),
    ).rejects.toThrow()
  })

  it('blocks access to ask_ai_logs at the role level', async () => {
    await expect(executeReadonly('SELECT * FROM ask_ai_logs')).rejects.toThrow()
  })

  it('enforces statement_timeout on long queries', async () => {
    await expect(
      executeReadonly("SELECT pg_sleep(10)"),
    ).rejects.toThrow(/timeout|canceling statement/i)
  }, 10_000)

  it('caps results at 500 rows', async () => {
    const res = await executeReadonly('SELECT 1 AS x FROM generate_series(1, 10000)')
    expect(res.rowCount).toBeLessThanOrEqual(500)
    expect(res.truncated).toBe(true)
  })
})
