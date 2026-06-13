import { useCallback, useRef, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import type { ChatEvent, ChatMessage } from './types'

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chatbot-query`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

let idSeq = 0
const newId = () => `m${Date.now()}_${idSeq++}`

function emptyAssistant(): ChatMessage {
  return { id: newId(), role: 'assistant', text: '', sqlLog: [], table: null, chart: null, streaming: true }
}

/**
 * Streams a question to the chatbot-query edge function and incrementally builds
 * the assistant message from NDJSON events. Keeps the conversation id so follow-up
 * turns share context.
 */
export function useChatbotStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const conversationId = useRef<string | null>(null)

  const patchLast = useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev
      const next = prev.slice()
      next[next.length - 1] = fn(next[next.length - 1])
      return next
    })
  }, [])

  const send = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q || isStreaming) return
    setIsStreaming(true)
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: 'user', text: q, sqlLog: [], table: null, chart: null, streaming: false },
      emptyAssistant(),
    ])

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Your session expired — please sign in again.')

      const res = await fetch(EDGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ question: q, conversation_id: conversationId.current }),
      })

      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => res.statusText)
        throw new Error(msg || `Request failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const apply = (evt: ChatEvent) => {
        switch (evt.type) {
          case 'meta':
            conversationId.current = evt.conversationId
            break
          case 'text':
            patchLast((m) => ({ ...m, text: m.text + evt.delta }))
            break
          case 'sql':
            patchLast((m) => ({ ...m, sqlLog: [...m.sqlLog, { sql: evt.sql, rows: evt.rows, error: evt.error }] }))
            break
          case 'result':
            patchLast((m) => ({ ...m, table: evt.table, chart: evt.chart }))
            break
          case 'done':
            conversationId.current = evt.conversationId
            patchLast((m) => ({ ...m, streaming: false }))
            break
          case 'error':
            patchLast((m) => ({
              ...m,
              streaming: false,
              errored: true,
              text: m.text || `Sorry — ${evt.message}`,
            }))
            break
        }
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try { apply(JSON.parse(trimmed) as ChatEvent) } catch { /* skip partial */ }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      patchLast((m) => ({ ...m, streaming: false, errored: true, text: m.text || `Sorry — ${message}` }))
    } finally {
      setIsStreaming(false)
    }
  }, [isStreaming, patchLast])

  const reset = useCallback(() => {
    conversationId.current = null
    setMessages([])
  }, [])

  return { messages, isStreaming, send, reset }
}
