import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Renders the assistant's prose as light markdown (bold headline, bullets, inline
// tables) with compact, on-brand styling.
export function MarkdownAnswer({ text, errored }: { text: string; errored?: boolean }) {
  return (
    <div className={`text-sm leading-relaxed break-words ${errored ? 'text-red-600' : 'text-stone-700'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-stone-900">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="marker:text-amber-600">{children}</li>,
          h1: ({ children }) => <h3 className="font-semibold text-stone-900 mb-1">{children}</h3>,
          h2: ({ children }) => <h3 className="font-semibold text-stone-900 mb-1">{children}</h3>,
          h3: ({ children }) => <h4 className="font-semibold text-stone-800 mb-1">{children}</h4>,
          code: ({ children }) => <code className="bg-stone-100 text-stone-800 rounded px-1 py-0.5 text-[12px] font-mono">{children}</code>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-amber-700 underline">{children}</a>,
          table: ({ children }) => <div className="overflow-auto my-2"><table className="text-xs border-collapse">{children}</table></div>,
          th: ({ children }) => <th className="border border-stone-200 bg-stone-50 px-2 py-1 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border border-stone-100 px-2 py-1">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
