import type { TableSpec } from './types'

interface ReportInput {
  question?: string
  answer: string
  table: TableSpec | null
  chartPng?: string | null // dataURL from chart.js toBase64Image()
}

// One-click PDF report: question + answer prose + optional chart image + optional
// table. Lazy-imports jsPDF + autotable so they don't bloat the initial bundle.
export async function downloadReport(filename: string, input: ReportInput) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 40
  const pageW = doc.internal.pageSize.getWidth()
  let y = margin

  doc.setFontSize(16); doc.setTextColor('#92400e')
  doc.text('Hagerstone Hub — Analytics', margin, y); y += 22

  if (input.question) {
    doc.setFontSize(11); doc.setTextColor('#78716c')
    const q = doc.splitTextToSize(`Q: ${input.question}`, pageW - margin * 2)
    doc.text(q, margin, y); y += q.length * 14 + 6
  }

  doc.setFontSize(11); doc.setTextColor('#1c1917')
  const ans = doc.splitTextToSize(input.answer || '', pageW - margin * 2)
  doc.text(ans, margin, y); y += ans.length * 14 + 10

  if (input.chartPng) {
    try {
      const w = pageW - margin * 2
      const h = w * 0.5
      if (y + h > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin }
      doc.addImage(input.chartPng, 'PNG', margin, y, w, h); y += h + 12
    } catch { /* skip chart if it can't be embedded */ }
  }

  if (input.table && input.table.columns.length) {
    autoTable(doc, {
      startY: y,
      head: [input.table.columns],
      body: input.table.rows.map((r) => r.map((c) => (c === null ? '' : String(c)))),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [146, 64, 14] },
      margin: { left: margin, right: margin },
    })
  }

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}
