import { useState, useRef, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles, X, Send, Database, ChevronDown, Loader2, Plus, Maximize2, Minimize2 } from 'lucide-react'
import type { Chart as ChartJS } from 'chart.js'
import { useChatbotStream } from './useChatbotStream'
import { ChatChart } from './ChatChart'
import { MarkdownAnswer } from './MarkdownAnswer'
import { SortableTable } from './SortableTable'
import { MessageActions } from './MessageActions'
import type { ChatMessage, SqlLogEntry } from './types'

const SUGGESTIONS = [
  'How many PRs are pending review for each procurement reviewer?',
  'Total finance spend this month by site',
  'Top 5 employees by delegation points this month',
  'Imprest outstanding ("money on the street") by employee',
]

function SqlChips({ log }: { log: SqlLogEntry[] }) {
  const [open, setOpen] = useState(false)
  if (log.length === 0) return null
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-600">
        <Database size={11} /> ran {log.length} {log.length === 1 ? 'query' : 'queries'}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-1.5 space-y-1.5">
              {log.map((e, i) => (
                <div key={i} className="text-[11px] rounded-lg border border-stone-100 bg-stone-50 p-2">
                  <pre className="whitespace-pre-wrap break-words font-mono text-stone-600">{e.sql}</pre>
                  <div className={`mt-1 ${e.error ? 'text-red-500' : 'text-stone-400'}`}>
                    {e.error ? `error: ${e.error}` : `${e.rows ?? 0} row(s)`}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const chartRef = useRef<ChartJS | null>(null)
  const getChartPng = () => {
    try { return chartRef.current?.toBase64Image('image/png', 1) ?? null } catch { return null }
  }

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-amber-700 text-white text-sm px-3.5 py-2">{msg.text}</div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] w-full rounded-2xl rounded-bl-sm bg-white border border-stone-100 px-3.5 py-2.5 shadow-sm">
        {msg.text
          ? <MarkdownAnswer text={msg.text} errored={msg.errored} />
          : msg.streaming
            ? <div className="flex items-center gap-2 text-stone-400 text-sm"><Loader2 size={13} className="animate-spin" /> {msg.phase ?? 'Thinking…'}</div>
            : null}
        {msg.chart && <div className="mt-3"><ChatChart ref={chartRef} spec={msg.chart} /></div>}
        {msg.table && <SortableTable table={msg.table} />}
        {!msg.streaming && msg.text && (
          <MessageActions answer={msg.text} table={msg.table} hasChart={!!msg.chart} getChartPng={getChartPng} />
        )}
        <SqlChips log={msg.sqlLog} />
      </div>
    </div>
  )
}

export function ChatbotWidget() {
  const [open, setOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [input, setInput] = useState('')
  const { messages, isStreaming, send, reset } = useChatbotStream()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = () => {
    if (!input.trim() || isStreaming) return
    send(input)
    setInput('')
  }

  const panelWidth = fullscreen ? 'w-full' : 'w-full sm:w-[460px]'

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-white font-medium text-sm"
        style={{ background: 'linear-gradient(135deg, #92400e 0%, #b45309 100%)', boxShadow: '0 8px 28px rgba(146,64,14,0.40)' }}
      >
        <Sparkles size={16} /> Ask the data
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className={`fixed right-0 top-0 z-50 h-full ${panelWidth} bg-stone-50 flex flex-col shadow-2xl`}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #92400e 0%, #b45309 100%)' }}>
                    <Sparkles size={15} className="text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-stone-800">Ask the data</div>
                    <div className="text-[11px] text-stone-400">Read-only · all Hub modules</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {messages.length > 0 && (
                    <button onClick={reset} title="New chat" className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg"><Plus size={16} /></button>
                  )}
                  <button onClick={() => setFullscreen((f) => !f)} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg hidden sm:block">
                    {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                  <button onClick={() => setOpen(false)} aria-label="Close chat" title="Close" className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg"><X size={18} /></button>
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                <div className={`space-y-3 ${fullscreen ? 'max-w-3xl mx-auto' : ''}`}>
                  {messages.length === 0 ? (
                    <div className="text-center pt-10">
                      <div className="text-sm text-stone-500 mb-1">Ask anything about your company's data.</div>
                      <div className="text-[11px] text-stone-400 mb-5">Finance, procurement, design, marketing, labour, delegation — across every module.</div>
                      <div className="space-y-2">
                        {SUGGESTIONS.map((s) => (
                          <button key={s} onClick={() => send(s)}
                            className="block w-full text-left text-xs text-stone-600 bg-white border border-stone-200 hover:border-amber-300 hover:bg-amber-50 rounded-xl px-3 py-2 transition-colors">
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((m) => <MessageBubble key={m.id} msg={m} />)
                  )}
                </div>
              </div>

              {/* Composer */}
              <div className="border-t border-stone-100 bg-white px-3 py-3">
                <div className={`${fullscreen ? 'max-w-3xl mx-auto' : ''}`}>
                  <div className="flex items-end gap-2">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                      placeholder="Ask about any data in the Hub…"
                      rows={1}
                      disabled={isStreaming}
                      className="flex-1 resize-none text-sm rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 max-h-32 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button onClick={submit} disabled={isStreaming || !input.trim()}
                      className="shrink-0 h-11 w-11 rounded-xl flex items-center justify-center text-white disabled:opacity-40"
                      style={{ background: 'linear-gradient(135deg, #92400e 0%, #b45309 100%)' }}>
                      {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                  </div>
                  <p className="text-[10px] text-stone-400 mt-1.5 text-center">
                    Answers come straight from the database. The assistant can only read — never change — data.
                  </p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
