import { describe, it, expect } from 'vitest'
import { parseSseStream } from '../client/parseSse'

function makeResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of iter) out.push(v)
  return out
}

describe('parseSseStream', () => {
  it('yields a single status event', async () => {
    const res = makeResponse([`event: status\ndata: {"stage":"agent_call"}\n\n`])
    const events = await collect(parseSseStream(res))
    expect(events).toEqual([{ type: 'status', stage: 'agent_call', message: undefined }])
  })

  it('yields multiple events from one chunk', async () => {
    const res = makeResponse([
      `event: status\ndata: {"stage":"tool_call","message":"Analyzing attendance..."}\n\n` +
      `event: token\ndata: {"delta":"Hi"}\n\n` +
      `event: done\ndata: {"answer":"Hi","toolCalls":[],"context":{"dateRange":{"from":"","to":""},"employeeCount":0,"recordCount":0},"timestamp":"t"}\n\n`,
    ])
    const events = await collect(parseSseStream(res))
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ type: 'status', stage: 'tool_call', message: 'Analyzing attendance...' })
    expect(events[1]).toEqual({ type: 'token', delta: 'Hi' })
    expect(events[2]).toMatchObject({ type: 'done' })
  })

  it('handles an event split across chunks', async () => {
    const res = makeResponse([
      `event: token\ndata: {"delta":`,
      `"Hello"}\n\n`,
    ])
    const events = await collect(parseSseStream(res))
    expect(events).toEqual([{ type: 'token', delta: 'Hello' }])
  })

  it('skips malformed events silently', async () => {
    const res = makeResponse([
      `event: token\ndata: {not json}\n\n` +
      `event: token\ndata: {"delta":"ok"}\n\n`,
    ])
    const events = await collect(parseSseStream(res))
    expect(events).toEqual([{ type: 'token', delta: 'ok' }])
  })

  it('skips unknown event types', async () => {
    const res = makeResponse([
      `event: heartbeat\ndata: {}\n\n` +
      `event: token\ndata: {"delta":"x"}\n\n`,
    ])
    const events = await collect(parseSseStream(res))
    expect(events).toEqual([{ type: 'token', delta: 'x' }])
  })

  it('yields an error event', async () => {
    const res = makeResponse([`event: error\ndata: {"message":"oops"}\n\n`])
    const events = await collect(parseSseStream(res))
    expect(events).toEqual([{ type: 'error', message: 'oops' }])
  })

  it('throws when response has no body', async () => {
    const res = new Response(null, { status: 500 })
    await expect(collect(parseSseStream(res))).rejects.toThrow(/body/i)
  })
})
