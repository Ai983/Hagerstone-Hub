import type { ImprestAgeing } from './types'

const inr0 = (n: unknown) =>
  'Rs.' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })

const lakh = (n: number) =>
  Math.abs(n) >= 100000 ? `Rs.${(n / 100000).toFixed(2)} L` : inr0(n)

// One-click PDF of the full Imprest & Finance Ageing report. Lazy-imports
// jsPDF + autotable so they stay out of the initial bundle (same pattern as the
// chatbot report exporter).
export async function downloadImprestAgeingPdf(data: ImprestAgeing) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 40
  const pageW = doc.internal.pageSize.getWidth()
  const ink: [number, number, number] = [20, 33, 61]
  const brand: [number, number, number] = [146, 64, 14]
  let y = margin

  const asOf = new Date(data.as_of).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  // ── Header ──
  doc.setFontSize(17); doc.setTextColor(...ink)
  doc.text('Hagerstone — Imprest & Finance Ageing Report', margin, y); y += 20
  doc.setFontSize(9); doc.setTextColor('#6b7280')
  doc.text(`Live snapshot as of ${asOf}  ·  every in-flight imprest & PO not yet paid`, margin, y); y += 18

  // ── KPI summary band ──
  const k = data.kpis
  autoTable(doc, {
    startY: y,
    body: [
      ['Imprests stuck', String(k.stuck_count), 'Gross value tied up', lakh(k.gross_value)],
      ['Approved, awaiting payout', lakh(k.approved_awaiting_payout), 'Oldest stuck item', `${k.oldest_days}d`],
      ['Breach >7d / >30d / >60d', `${k.breach_gt7} / ${k.breach_gt30} / ${k.breach_gt60}`, 'Primary bottleneck', `${k.bottleneck_stage ?? '-'} (${k.bottleneck_count})`],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5, textColor: ink },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [243, 245, 247] },
      2: { fontStyle: 'bold', fillColor: [243, 245, 247] },
    },
    margin: { left: margin, right: margin },
  })
  // @ts-expect-error lastAutoTable is augmented onto the jsPDF instance by autotable
  y = doc.lastAutoTable.finalY + 16

  // ── Pipeline / ageing-by-stage matrix ──
  doc.setFontSize(11); doc.setTextColor(...brand)
  doc.text('Ageing by stage', margin, y); y += 8
  autoTable(doc, {
    startY: y,
    head: [['Stage', 'Owner', '0-7d', '8-15d', '16-30d', '31-60d', '60+d', 'Total', 'Value']],
    body: data.pipeline.map((s) => [
      s.label, s.owner,
      s.bands['0-7'] || '·', s.bands['8-15'] || '·', s.bands['16-30'] || '·',
      s.bands['31-60'] || '·', s.bands['60+'] || '·', s.count, inr0(s.value),
    ]),
    styles: { fontSize: 7.5, cellPadding: 3, textColor: ink },
    headStyles: { fillColor: ink, fontSize: 7.5 },
    columnStyles: { 8: { halign: 'right' }, 7: { halign: 'right' } },
    margin: { left: margin, right: margin },
  })
  // @ts-expect-error augmented
  y = doc.lastAutoTable.finalY + 16

  // ── Stuck items ──
  doc.setFontSize(11); doc.setTextColor(...brand)
  doc.text(`All stuck imprests (${data.items.length})`, margin, y); y += 8
  autoTable(doc, {
    startY: y,
    head: [['Ref', 'Stage', 'Site', 'Requester', 'Category', 'Requested', 'Net payable', 'Submitted', 'Waiting']],
    body: data.items.map((it) => [
      it.ref + (it.flag ? ' (!)' : ''),
      it.stage_key,
      it.site ?? '-', it.requester, it.category ?? '-',
      inr0(it.amount), it.net_payable === null ? '-' : inr0(it.net_payable),
      it.submitted_at, `${it.age_days}d`,
    ]),
    styles: { fontSize: 7, cellPadding: 2.5, textColor: ink },
    headStyles: { fillColor: ink, fontSize: 7 },
    columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 8: { halign: 'right' } },
    margin: { left: margin, right: margin },
  })
  // @ts-expect-error augmented
  y = doc.lastAutoTable.finalY + 16

  // ── PO payments ──
  if (data.po_payments.length) {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = margin }
    doc.setFontSize(11); doc.setTextColor(...brand)
    doc.text('PO payments — vendor settlements not yet cleared', margin, y); y += 8
    autoTable(doc, {
      startY: y,
      head: [['PO ref', 'Supplier', 'Project', 'Status', 'PO value', 'Paid', 'Outstanding', 'Waiting']],
      body: data.po_payments.map((r) => [
        r.ref + (r.is_test ? ' (test)' : ''),
        r.supplier ?? '-', (r.project ?? '-').slice(0, 40),
        r.status === 'partially_paid' ? 'Partially paid' : 'Pending',
        inr0(r.po_value), r.paid ? inr0(r.paid) : '-', inr0(r.outstanding), `${r.age_days}d`,
      ]),
      styles: { fontSize: 7, cellPadding: 2.5, textColor: ink },
      headStyles: { fillColor: ink, fontSize: 7 },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
      margin: { left: margin, right: margin },
    })
    // @ts-expect-error augmented
    y = doc.lastAutoTable.finalY + 14
  }

  // ── Integrity notes ──
  const g = data.integrity
  if (g.paid_not_closed.length || g.rejected_in_pipeline.length || g.zero_net_count) {
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = margin }
    doc.setFontSize(10); doc.setTextColor(...brand)
    doc.text('Data integrity & caveats', margin, y); y += 14
    doc.setFontSize(8); doc.setTextColor('#6b7280')
    const notes: string[] = []
    if (g.paid_not_closed.length) notes.push(`- ${g.paid_not_closed.length} marked paid but stage not closed: ${g.paid_not_closed.join(', ')}`)
    if (g.rejected_in_pipeline.length) notes.push(`- ${g.rejected_in_pipeline.length} rejected but still in pipeline: ${g.rejected_in_pipeline.join(', ')}`)
    if (g.zero_net_count) notes.push(`- ${g.zero_net_count} approved items have Rs.0 net payable (offset against earlier unpaid balance)`)
    notes.push('- Ageing is computed from submission date, not updated_at (collapsed by a bulk back-data update).')
    for (const n of notes) {
      const lines = doc.splitTextToSize(n, pageW - margin * 2)
      doc.text(lines, margin, y); y += lines.length * 11 + 2
    }
  }

  doc.save(`hagerstone-imprest-ageing-${new Date(data.as_of).toISOString().slice(0, 10)}.pdf`)
}
