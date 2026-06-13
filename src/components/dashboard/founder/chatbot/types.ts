// Shared types for the Founder analytics chatbot widget.

export interface ChartSpec {
  kind: 'bar' | 'line' | 'doughnut'
  title?: string
  labels: string[]
  datasets: { label: string; data: number[] }[]
}

export interface TableSpec {
  columns: string[]
  rows: (string | number | null)[][]
}

export interface SqlLogEntry {
  sql: string
  rows: number | null
  error: string | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  sqlLog: SqlLogEntry[]
  table: TableSpec | null
  chart: ChartSpec | null
  streaming: boolean
  errored?: boolean
}

// NDJSON event envelope streamed by the chatbot-query edge function.
export type ChatEvent =
  | { type: 'meta'; conversationId: string }
  | { type: 'text'; delta: string }
  | { type: 'sql'; sql: string; rows: number | null; error: string | null }
  | { type: 'result'; table: TableSpec | null; chart: ChartSpec | null }
  | { type: 'done'; conversationId: string; messageId: string | null }
  | { type: 'error'; message: string }
