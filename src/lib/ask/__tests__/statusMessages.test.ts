import { describe, it, expect } from 'vitest'
import { statusMessageForTool } from '../statusMessages'

describe('statusMessageForTool', () => {
  it('maps each curated tool to a friendly message', () => {
    expect(statusMessageForTool('list_employees')).toBe('Looking up employees...')
    expect(statusMessageForTool('query_attendance')).toBe('Analyzing attendance...')
    expect(statusMessageForTool('list_on_status')).toBe("Checking today's status...")
    expect(statusMessageForTool('check_compliance')).toBe('Checking compliance rules...')
    expect(statusMessageForTool('run_readonly_sql')).toBe('Running custom analysis...')
  })

  it('falls back to a generic message for unknown tools', () => {
    expect(statusMessageForTool('future_unknown_tool')).toBe('Working...')
    expect(statusMessageForTool('')).toBe('Working...')
  })
})
