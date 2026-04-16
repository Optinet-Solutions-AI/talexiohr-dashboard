import type { ToolCallRecord } from '../types'
import type { AskContext } from '../context'

export type AskDonePayload = {
  answer: string
  toolCalls: ToolCallRecord[]
  context: AskContext
  timestamp: string
}

export type SseEvent =
  | { type: 'status'; stage: string; message?: string }
  | { type: 'token'; delta: string }
  | { type: 'done'; payload: AskDonePayload }
  | { type: 'error'; message: string }

export async function* parseSseStream(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) throw new Error('Response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const parsed = parseOneEvent(raw)
      if (parsed) yield parsed
    }
  }

  // Flush any remaining buffered event (no trailing blank line)
  if (buf.trim().length > 0) {
    const parsed = parseOneEvent(buf)
    if (parsed) yield parsed
  }
}

function parseOneEvent(raw: string): SseEvent | null {
  let event = 'message'
  let dataStr = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) dataStr += line.slice(6)
  }
  if (!dataStr) return null

  try {
    const data = JSON.parse(dataStr)
    if (event === 'status') return { type: 'status', stage: data.stage, message: data.message }
    if (event === 'token') return { type: 'token', delta: data.delta }
    if (event === 'done')  return { type: 'done', payload: data }
    if (event === 'error') return { type: 'error', message: data.message }
  } catch { /* skip malformed */ }
  return null
}
