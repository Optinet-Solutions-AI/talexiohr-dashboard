'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, Loader2, RotateCw, Bookmark, BookmarkCheck, Trash2, Sparkles, Mic, MicOff } from 'lucide-react'

interface Answer {
  id: string
  question: string
  answer: string
  context: { dateRange: { from: string; to: string }; employeeCount: number; recordCount: number }
  timestamp: string
  saved: boolean
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export default function AskSearch() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [showSavedOnly, setShowSavedOnly] = useState(false)
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!SR) return

    const recognition = new SR()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = false
    recognitionRef.current = recognition

    recognition.onresult = (event: { results: { [key: number]: { transcript: string }; isFinal: boolean; length: number }[] }) => {
      const transcript = Array.from(event.results).map((r: any) => r[0].transcript).join('')
      setQuery(transcript)
      if ((event.results[0] as any)?.isFinal) {
        setListening(false)
      }
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)

    recognition.start()
    setListening(true)
  }

  // Load saved answers from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('hr-ask-saved')
    if (saved) {
      try { setAnswers(JSON.parse(saved)) } catch {}
    }
  }, [])

  // Persist saved answers
  function persistSaved(list: Answer[]) {
    const toSave = list.filter(a => a.saved)
    localStorage.setItem('hr-ask-saved', JSON.stringify(toSave))
  }

  async function handleAsk(question?: string) {
    const q = (question ?? query).trim()
    if (!q) return
    setLoading(true)
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const newAnswer: Answer = {
        id: generateId(),
        question: q,
        answer: data.answer,
        context: data.context,
        timestamp: data.timestamp,
        saved: false,
      }
      setAnswers(prev => [newAnswer, ...prev])
      if (!question) setQuery('')
    } catch (err) {
      const errAnswer: Answer = {
        id: generateId(),
        question: q,
        answer: `Error: ${err instanceof Error ? err.message : 'Failed to get answer'}`,
        context: { dateRange: { from: '', to: '' }, employeeCount: 0, recordCount: 0 },
        timestamp: new Date().toISOString(),
        saved: false,
      }
      setAnswers(prev => [errAnswer, ...prev])
    } finally {
      setLoading(false)
    }
  }

  function toggleSave(id: string) {
    setAnswers(prev => {
      const updated = prev.map(a => a.id === id ? { ...a, saved: !a.saved } : a)
      persistSaved(updated)
      return updated
    })
  }

  function removeAnswer(id: string) {
    setAnswers(prev => {
      const updated = prev.filter(a => a.id !== id)
      persistSaved(updated)
      return updated
    })
  }

  function runAgain(question: string) {
    setQuery(question)
    handleAsk(question)
  }

  const displayed = showSavedOnly ? answers.filter(a => a.saved) : answers
  const savedCount = answers.filter(a => a.saved).length

  // Suggested questions
  const suggestions = [
    'Who has the most office days this month?',
    'Which employees have no clockings?',
    'What is the average hours worked per day?',
    'Who is on leave today?',
    'Show me the top 5 employees by attendance',
    'Which employees are not compliant with the 4-day rule?',
  ]

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Search bar */}
      <div className="relative">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center px-4 py-3">
            <Sparkles size={18} className="text-indigo-500 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && handleAsk()}
              placeholder="Ask anything about your HR data..."
              className="flex-1 ml-3 text-sm text-slate-800 placeholder:text-slate-400 outline-none bg-transparent"
              autoFocus
            />
            <button
              onClick={toggleVoice}
              className={`ml-2 p-2 rounded-lg transition-colors ${listening ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-indigo-600 hover:bg-slate-50'}`}
              title={listening ? 'Stop listening' : 'Voice input'}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              onClick={() => handleAsk()}
              disabled={loading || !query.trim()}
              className="ml-1 p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Suggestions (show when no answers yet) */}
      {answers.length === 0 && !loading && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 text-center">Try asking</p>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map(s => (
              <button key={s} onClick={() => { setQuery(s); handleAsk(s) }}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Saved filter */}
      {answers.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSavedOnly(false)}
              className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${!showSavedOnly ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              All ({answers.length})
            </button>
            <button
              onClick={() => setShowSavedOnly(true)}
              className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${showSavedOnly ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              Saved ({savedCount})
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 text-center">
          <Loader2 size={20} className="animate-spin text-indigo-500 mx-auto mb-2" />
          <p className="text-xs text-slate-500">Analyzing your HR data...</p>
        </div>
      )}

      {/* Answers */}
      <div className="space-y-4">
        {displayed.map(a => (
          <div key={a.id} className={`bg-white rounded-lg border overflow-hidden ${a.saved ? 'border-indigo-200' : 'border-slate-200'}`}>
            {/* Question */}
            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <p className="text-xs font-medium text-slate-700 flex-1">{a.question}</p>
              <span className="text-[10px] text-slate-500 ml-2 shrink-0">
                {new Date(a.timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Answer */}
            <div className="px-4 py-3">
              <div className="prose prose-sm prose-slate max-w-none text-xs leading-relaxed [&_strong]:text-slate-800 [&_li]:my-0.5 [&_p]:my-1 [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_th]:bg-slate-50 [&_th]:text-slate-600 [&_table]:border [&_th]:border [&_td]:border [&_table]:border-slate-200"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(a.answer) }} />
            </div>

            {/* Context + Actions */}
            <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">
                {a.context.employeeCount} employees · {a.context.recordCount} records · {a.context.dateRange?.from || '?'} → {a.context.dateRange?.to || '?'}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => toggleSave(a.id)}
                  className={`p-1.5 rounded transition-colors ${a.saved ? 'text-indigo-600 hover:bg-indigo-50' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
                  title={a.saved ? 'Unsave' : 'Save'}>
                  {a.saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                </button>
                <button onClick={() => runAgain(a.question)}
                  className="p-1.5 rounded text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors" title="Run again">
                  <RotateCw size={14} />
                </button>
                <button onClick={() => removeAnswer(a.id)}
                  className="p-1.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Remove">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Simple markdown → HTML (bold, lists, tables, line breaks)
function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    .replace(/`(.*?)`/g, '<code class="bg-slate-100 px-1 rounded text-[11px]">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-slate-800 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-sm font-bold text-slate-800 mt-3 mb-1">$1</h2>')

  // Tables
  html = html.replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)*)/g, (_, header, body) => {
    const ths = header.split('|').filter(Boolean).map((h: string) => `<th>${h.trim()}</th>`).join('')
    const rows = body.trim().split('\n').map((row: string) => {
      const tds = row.split('|').filter(Boolean).map((c: string) => `<td>${c.trim()}</td>`).join('')
      return `<tr>${tds}</tr>`
    }).join('')
    return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`
  })

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="list-disc list-inside">$&</ul>')

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/\n/g, '<br>')
  html = `<p>${html}</p>`
  html = html.replace(/<p><\/p>/g, '')

  return html
}
