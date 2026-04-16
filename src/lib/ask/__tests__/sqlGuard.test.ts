import { describe, it, expect } from 'vitest'
import { validateReadonlySql } from '../sqlGuard'

describe('validateReadonlySql', () => {
  it('allows a plain SELECT on employees', () => {
    const r = validateReadonlySql('SELECT id, full_name FROM employees WHERE excluded = false')
    expect(r.ok).toBe(true)
  })

  it('allows a SELECT with join on the two whitelisted tables', () => {
    const r = validateReadonlySql(
      'SELECT e.full_name, count(*) FROM employees e JOIN attendance_records a ON a.employee_id = e.id GROUP BY e.full_name'
    )
    expect(r.ok).toBe(true)
  })

  it('rejects INSERT', () => {
    const r = validateReadonlySql("INSERT INTO employees (first_name) VALUES ('x')")
    if (r.ok) throw new Error('expected validation to fail')
    expect(r.reason).toMatch(/SELECT/i)
  })

  it('rejects UPDATE', () => {
    const r = validateReadonlySql("UPDATE employees SET excluded = true")
    expect(r.ok).toBe(false)
  })

  it('rejects DELETE', () => {
    const r = validateReadonlySql("DELETE FROM employees")
    expect(r.ok).toBe(false)
  })

  it('rejects DROP', () => {
    const r = validateReadonlySql("DROP TABLE employees")
    expect(r.ok).toBe(false)
  })

  it('rejects multiple statements', () => {
    const r = validateReadonlySql('SELECT 1; DROP TABLE employees')
    if (r.ok) throw new Error('expected validation to fail')
    expect(r.reason).toMatch(/one statement|single/i)
  })

  it('rejects tables outside the whitelist', () => {
    const r = validateReadonlySql('SELECT * FROM ask_ai_logs')
    if (r.ok) throw new Error('expected validation to fail')
    expect(r.reason).toMatch(/allowed|whitelist|table/i)
  })

  it('rejects pg_sleep', () => {
    const r = validateReadonlySql("SELECT pg_sleep(60)")
    if (r.ok) throw new Error('expected validation to fail')
    expect(r.reason).toMatch(/function/i)
  })

  it('rejects pg_read_file', () => {
    const r = validateReadonlySql("SELECT pg_read_file('/etc/passwd')")
    expect(r.ok).toBe(false)
  })

  it('rejects current_setting', () => {
    const r = validateReadonlySql("SELECT current_setting('server_version')")
    if (r.ok) throw new Error('expected validation to fail')
    expect(r.reason).toMatch(/function/i)
  })

  it('rejects inet_server_addr', () => {
    const r = validateReadonlySql('SELECT inet_server_addr()')
    expect(r.ok).toBe(false)
  })

  it('rejects a CTE that writes', () => {
    const r = validateReadonlySql(
      "WITH x AS (INSERT INTO employees (first_name) VALUES ('x') RETURNING id) SELECT * FROM x"
    )
    expect(r.ok).toBe(false)
  })
})
