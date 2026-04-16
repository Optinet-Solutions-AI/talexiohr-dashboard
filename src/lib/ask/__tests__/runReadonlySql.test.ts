import { describe, it, expect, vi } from 'vitest'

vi.mock('../readonlyDb', () => ({
  executeReadonly: vi.fn(),
}))

import { runReadonlySql } from '../tools/runReadonlySql'
import { executeReadonly } from '../readonlyDb'

describe('runReadonlySql', () => {
  it('rejects non-SELECT with a validation error', async () => {
    const res = await runReadonlySql({
      query: 'DELETE FROM employees',
      reason: 'test',
    })
    expect(res.error).toBeDefined()
    expect(res.error).toMatch(/SELECT/i)
    expect(executeReadonly).not.toHaveBeenCalled()
  })

  it('rejects query touching tables outside the whitelist', async () => {
    const res = await runReadonlySql({
      query: 'SELECT * FROM ask_ai_logs',
      reason: 'audit',
    })
    expect(res.error).toMatch(/allowed|whitelist|table/i)
    expect(executeReadonly).not.toHaveBeenCalled()
  })

  it('passes valid SELECTs through to executeReadonly', async () => {
    vi.mocked(executeReadonly).mockResolvedValue({
      rows: [{ count: 37 }], rowCount: 1, truncated: false,
    })
    const res = await runReadonlySql({
      query: 'SELECT count(*) FROM employees',
      reason: 'count',
    })
    expect(res.rowCount).toBe(1)
    expect(res.rows).toEqual([{ count: 37 }])
    expect(executeReadonly).toHaveBeenCalledWith('SELECT count(*) FROM employees')
  })
})
