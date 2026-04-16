const TOOL_STATUS_MESSAGES: Record<string, string> = {
  list_employees:    'Looking up employees...',
  query_attendance:  'Analyzing attendance...',
  list_on_status:    "Checking today's status...",
  check_compliance:  'Checking compliance rules...',
  run_readonly_sql:  'Running custom analysis...',
}

export function statusMessageForTool(tool: string): string {
  return TOOL_STATUS_MESSAGES[tool] ?? 'Working...'
}
