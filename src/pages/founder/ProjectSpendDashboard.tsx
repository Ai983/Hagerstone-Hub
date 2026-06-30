import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

/* ───────────────────────── types (shape of the RPC payload) ───────────────────────── */
type Recipient = { name: string; n: number; amount: number }
type Raiser = { name: string; role: string; n: number; latest: string | null }
type Project = {
  code: string
  name: string
  budget: number | null
  po_made: number; po_made_n: number
  po_paid: number; po_paid_n: number
  wo_made: number; wo_paid: number; wo_n: number
  imprest: number; imprest_n: number
  spent: number
  pct: number | null
  pr_total: number; pr_30d: number
  pr_raisers: Raiser[]
  imprest_recipients: Recipient[]
}
type SpendData = {
  as_of: string
  projects: Project[]
  unmapped: { total: number; count: number; recipients: Recipient[] }
}

/* ───────────────────────── formatting helpers (Indian grouping + lakh/crore) ───────────────────────── */
function grp(n: number): string {
  return Math.round(n || 0).toLocaleString('en-IN')
}
/** Full grouped rupees, e.g. ₹16,88,956 */
function inr(n: number): string {
  return '₹' + grp(n)
}
/** Compact rupees: ₹7.00 Cr · ₹80.0 L · ₹34,500 */
function compactINR(n: number): string {
  const v = Math.round(n || 0)
  const a = Math.abs(v)
  if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr'
  if (a >= 1e5) return '₹' + (v / 1e5).toFixed(1) + ' L'
  return '₹' + v.toLocaleString('en-IN')
}
function utilClass(pct: number | null): string {
  if (pct == null) return 'u-none'
  if (pct > 100) return 'u-over'
  if (pct >= 90) return 'u-90'
  if (pct >= 70) return 'u-70'
  return 'u-ok'
}
function barWidth(pct: number | null): string {
  if (pct == null) return '0%'
  return Math.min(pct, 100) + '%'
}
function fmtAsOf(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

/* ───────────────────────── styles (ported verbatim from Hagerstone-Project-Spend-Budget-Report.html,
   scoped under .fsd so the global body / universal / h2 rules don't leak into the rest of the SPA) ───────────────────────── */
const STYLE = `
.fsd{--ink:#0F1E33;--ink2:#14213D;--paper:#F3F5F7;--card:#FFF;--line:#D9DEE6;--line2:#E8ECF1;--muted:#5C6B80;--muted2:#8794A6;
--ok:#1B9E8A;--c70:#E0B43A;--c90:#E07B2E;--over:#C24A30;--none:#8794A6;--accent:#14213D;
background:var(--paper);color:var(--ink);font-family:'IBM Plex Sans',system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;min-height:100vh}
.fsd *{box-sizing:border-box}
.fsd .mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.fsd .wrap{max-width:1240px;margin:0 auto;padding:26px 22px 80px}
.fsd .na{color:var(--muted2);font-style:italic;font-weight:400}
.fsd .topbar{max-width:1240px;margin:0 auto;padding:14px 22px 0;display:flex;gap:10px;justify-content:flex-end}
.fsd .topbtn{font-family:'IBM Plex Sans';font-size:12.5px;cursor:pointer;background:var(--card);border:1px solid var(--line);color:var(--ink2);padding:7px 13px;border-radius:7px}
.fsd .topbtn:hover{border-color:var(--muted2)}
.fsd .mast{background:var(--ink);color:#fff;border-radius:10px;padding:24px 28px;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
.fsd .mast h1{font-family:'IBM Plex Sans Condensed';font-weight:700;font-size:26px;margin:0 0 5px}
.fsd .mast .sys{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#9FB2CC;font-weight:600;margin-bottom:12px}
.fsd .mast .scope{font-size:13px;color:#C7D2E0;max-width:680px}
.fsd .mast-r{text-align:right;font-size:12px;color:#9FB2CC;line-height:1.7;white-space:nowrap}
.fsd .asof{display:inline-block;margin-top:4px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:5px 11px;font-family:'IBM Plex Mono';font-size:12px;color:#fff}
.fsd .btnbar{display:flex;gap:7px;flex-wrap:wrap;margin:20px 0 8px}
.fsd .pbtn{font-family:'IBM Plex Sans';font-size:12.5px;font-weight:500;cursor:pointer;background:var(--card);border:1px solid var(--line);color:var(--ink2);padding:7px 13px;border-radius:7px}
.fsd .pbtn:hover{border-color:var(--muted2)} .fsd .pbtn.active{background:var(--ink2);color:#fff;border-color:var(--ink2)}
.fsd .pbtn:focus-visible,.fsd .ovrow:focus-visible{outline:2px solid var(--ok);outline-offset:2px}
.fsd h2{font-family:'IBM Plex Sans Condensed'}
.fsd .sec-h{font-family:'IBM Plex Sans Condensed';font-weight:700;font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2);margin:26px 0 12px;padding-bottom:8px;border-bottom:2px solid var(--ink2);display:flex;gap:10px;align-items:baseline}
.fsd .sec-h .n{font-family:'IBM Plex Sans';font-weight:500;font-size:12px;text-transform:none;letter-spacing:0;color:var(--muted)}
.fsd .ovwrap{overflow-x:auto;border:1px solid var(--line);border-radius:9px;background:var(--card)}
.fsd table.ov{width:100%;border-collapse:collapse;font-size:13px;min-width:820px}
.fsd .ov thead th{background:#EDF1F6;text-align:right;font-family:'IBM Plex Sans Condensed';font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:10px 12px;border-bottom:1px solid var(--line)}
.fsd .ov thead th:first-child{text-align:left}
.fsd .ov td{padding:10px 12px;border-bottom:1px solid var(--line2);text-align:right}
.fsd .ov td.pname{text-align:left}
.fsd .ovrow{cursor:pointer} .fsd .ovrow:hover{background:#F7F9FB}
.fsd .pn{font-weight:600;color:var(--ink2)} .fsd .ploc{display:block;font-size:11px;color:var(--muted2)}
.fsd .spent{font-weight:700;color:var(--ink)}
.fsd .badge.nb{display:inline-block;margin-left:7px;font-size:10px;font-weight:600;background:#FCEEE6;color:#B5521F;border:1px solid #F6D6C4;border-radius:10px;padding:1px 7px;vertical-align:middle}
.fsd .util{min-width:140px}
.fsd .ubar{display:inline-block;width:78px;height:8px;border-radius:5px;background:var(--line2);overflow:hidden;vertical-align:middle;margin-right:8px}
.fsd .ubar span{display:block;height:100%}
.fsd .upct{font-family:'IBM Plex Mono';font-weight:600;font-size:12px}
.fsd .ovtot td{background:var(--ink2);color:#fff;font-weight:600;border:none} .fsd .ovtot td.spent{color:#fff}
.fsd .u-ok span,.fsd .u-ok.ubar span{background:var(--ok)} .fsd .u-ok{color:var(--ok)}
.fsd .u-70 span{background:var(--c70)} .fsd .u-70{color:#9a7d18}
.fsd .u-90 span{background:var(--c90)} .fsd .u-90{color:var(--c90)}
.fsd .u-over span{background:var(--over)} .fsd .u-over{color:var(--over)}
.fsd .u-none span{background:var(--none)} .fsd .u-none{color:var(--muted2)}
.fsd .ubar.u-ok span{background:var(--ok)}.fsd .ubar.u-70 span{background:var(--c70)}.fsd .ubar.u-90 span{background:var(--c90)}.fsd .ubar.u-over span{background:var(--over)}.fsd .ubar.u-none span{background:var(--none)}
.fsd .panel{margin-top:18px}
.fsd .phead{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px}
.fsd .ptitle{font-family:'IBM Plex Sans Condensed';font-weight:700;font-size:23px;color:var(--ink);margin:0}
.fsd .psub{font-size:12.5px;color:var(--muted)}
.fsd .back{font-family:'IBM Plex Sans';font-size:12.5px;cursor:pointer;background:var(--card);border:1px solid var(--line);color:var(--ink2);padding:7px 12px;border-radius:7px;white-space:nowrap}
.fsd .back:hover{border-color:var(--muted2)}
.fsd .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.fsd .kpi{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:14px 16px;border-top:3px solid var(--ink2)}
.fsd .kl{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;min-height:26px}
.fsd .kv{font-family:'IBM Plex Sans Condensed';font-weight:700;font-size:26px;color:var(--ink);line-height:1;margin:7px 0 5px}
.fsd .ks{font-size:11px;color:var(--muted2)}
.fsd .bvs{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:16px 18px;margin-top:13px}
.fsd .bvs.nobud{border-left:4px solid var(--none)}
.fsd .bvs-row{display:flex;justify-content:space-between;font-size:13px;margin:2px 0}
.fsd .bold{font-weight:700}
.fsd .bigbar{height:14px;border-radius:7px;background:var(--line2);overflow:hidden;margin:9px 0}
.fsd .bigbar span{display:block;height:100%}
.fsd .bigbar .u-ok{background:var(--ok)}.fsd .bigbar .u-70{background:var(--c70)}.fsd .bigbar .u-90{background:var(--c90)}.fsd .bigbar .u-over{background:var(--over)}
.fsd .nb-note{font-size:12px;color:var(--muted);margin-top:7px}
.fsd .splits{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:13px}
.fsd .split{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:15px 17px}
.fsd .sp-h{font-family:'IBM Plex Sans Condensed';font-weight:600;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.fsd .sp-main{font-family:'IBM Plex Sans Condensed';font-weight:700;font-size:25px;color:var(--ink);margin:7px 0 6px;font-variant-numeric:tabular-nums}
.fsd .sp-tag{font-family:'IBM Plex Sans';font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#1C7A48;background:#E5F3EC;border-radius:10px;padding:2px 8px;margin-left:9px;vertical-align:middle}
.fsd .sp-tag.made{color:#8A6A12;background:#FFF6E0}
.fsd .sp-sub{font-size:11.5px;color:var(--muted2)}
.fsd .ptables{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}
.fsd .tcard{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:16px 18px}
.fsd .tcard h3{font-family:'IBM Plex Sans Condensed';font-weight:600;font-size:13px;letter-spacing:.03em;text-transform:uppercase;color:var(--ink2);margin:0 0 10px;display:flex;justify-content:space-between;align-items:baseline}
.fsd .th-note{font-family:'IBM Plex Mono';font-weight:500;font-size:11px;text-transform:none;letter-spacing:0;color:var(--muted)}
.fsd table.dt{width:100%;border-collapse:collapse;font-size:12.5px}
.fsd .dt th{text-align:left;font-family:'IBM Plex Sans Condensed';font-weight:600;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:5px 8px;border-bottom:1px solid var(--line)}
.fsd .dt th.num,.fsd .dt td.num{text-align:right}
.fsd .dt td{padding:6px 8px;border-bottom:1px solid var(--line2)}
.fsd .dt tr:last-child td{border-bottom:none}
.fsd .rrole{color:var(--muted);font-size:11.5px;text-transform:capitalize}
.fsd .dt td.dt,.fsd .mono.dt{color:var(--muted);font-size:11.5px}
.fsd .empty{color:var(--muted2);font-style:italic;text-align:center;padding:12px}
.fsd .muted2{color:var(--muted2);font-size:11px}
.fsd .editbtn{font-family:'IBM Plex Sans';font-size:11px;cursor:pointer;background:transparent;border:1px solid var(--line);color:var(--muted);padding:4px 9px;border-radius:6px;margin-left:10px}
.fsd .editbtn:hover{border-color:var(--muted2);color:var(--ink2)}
.fsd .method{margin-top:34px;padding:20px 22px;background:#ECEFF3;border:1px solid var(--line);border-radius:9px;font-size:12.5px;color:var(--muted);line-height:1.65}
.fsd .method h3{font-family:'IBM Plex Sans Condensed';color:var(--ink2);margin:0 0 8px}
.fsd .method b{color:var(--ink2)} .fsd .method code{font-family:'IBM Plex Mono';font-size:11.5px;background:#fff;padding:1px 5px;border-radius:4px;border:1px solid var(--line)}
.fsd .method ul{margin:6px 0 0;padding-left:18px} .fsd .method li{margin:5px 0}
.fsd .flagcard{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--c90);border-radius:9px;padding:14px 18px;margin-top:14px}
.fsd .foot{margin-top:24px;text-align:center;font-size:11.5px;color:var(--muted2)}
@media (max-width:1000px){.fsd .kpis,.fsd .splits,.fsd .ptables{grid-template-columns:1fr 1fr}}
@media (max-width:620px){.fsd .kpis,.fsd .splits,.fsd .ptables{grid-template-columns:1fr}.fsd .mast{padding:18px}}
@media (prefers-reduced-motion:reduce){.fsd *{transition:none!important}}
`

/* ───────────────────────── sub-components ───────────────────────── */
function RaiserRows({ raisers }: { raisers: Raiser[] }) {
  if (!raisers.length) return <tr><td colSpan={4} className="empty">No PRs recorded.</td></tr>
  return <>{raisers.map((r, i) => (
    <tr key={i}>
      <td>{r.name === '(unknown)'
        ? <>(unknown) <span className="muted2">(login/unattributed)</span></>
        : r.name}</td>
      <td className="rrole">{r.role}</td>
      <td className="num mono">{r.n}</td>
      <td className="mono dt">{r.latest ?? ''}</td>
    </tr>
  ))}</>
}

function RecipientRows({ recipients }: { recipients: Recipient[] }) {
  if (!recipients.length) return <tr><td colSpan={3} className="empty">No imprest disbursed on this site.</td></tr>
  return <>{recipients.map((r, i) => (
    <tr key={i}>
      <td>{r.name}</td>
      <td className="num mono">{r.n}</td>
      <td className="num mono">{inr(r.amount)}</td>
    </tr>
  ))}</>
}

function ProjectPanel({ p, onBack, onEditBudget }: { p: Project; onBack: () => void; onEditBudget: (p: Project) => void }) {
  const hasBudget = p.budget != null && p.budget > 0
  const balance = hasBudget ? (p.budget as number) - p.spent : 0
  const uc = utilClass(p.pct)

  return (
    <section className="panel">
      <div className="phead">
        <div>
          <h2 className="ptitle">{p.name}</h2>
          <div className="psub"><span className="mono">{p.code}</span>
            <button className="editbtn" onClick={() => onEditBudget(p)}>Edit budget</button>
          </div>
        </div>
        <button className="back" onClick={onBack}>← All projects</button>
      </div>

      <div className="kpis">
        {hasBudget ? (
          <>
            <div className="kpi"><div className="kl">Budget</div><div className="kv">{compactINR(p.budget as number)}</div><div className="ks"></div></div>
            <div className="kpi"><div className="kl">Total spent</div><div className="kv">{compactINR(p.spent)}</div><div className="ks">PO paid + WO made + imprest</div></div>
            <div className="kpi"><div className="kl">% of budget used</div><div className="kv"><span className={uc}>{p.pct}%</span></div><div className="ks"></div></div>
            <div className="kpi"><div className="kl">Balance</div><div className="kv">{inr(balance)}</div><div className="ks"></div></div>
          </>
        ) : (
          <>
            <div className="kpi"><div className="kl">Budget</div><div className="kv"><span className="na">not set</span></div><div className="ks"></div></div>
            <div className="kpi"><div className="kl">Total spent</div><div className="kv">{compactINR(p.spent)}</div><div className="ks">PO paid + WO made + imprest</div></div>
            <div className="kpi"><div className="kl">PRs raised</div><div className="kv">{p.pr_total}</div><div className="ks">all-time</div></div>
            <div className="kpi"><div className="kl">PRs last 30d</div><div className="kv">{p.pr_30d}</div><div className="ks"></div></div>
          </>
        )}
      </div>

      {hasBudget ? (
        <div className="bvs">
          <div className="bvs-row"><span>Budget</span><span className="mono">{inr(p.budget as number)}</span></div>
          <div className="bigbar"><span className={uc} style={{ width: barWidth(p.pct) }}></span></div>
          <div className="bvs-row">
            <span className={`${uc} bold`}>Spent {p.pct}% · {inr(p.spent)}</span>
            <span>Balance {inr(balance)}</span>
          </div>
        </div>
      ) : (
        <div className="bvs nobud">
          <div className="bvs-row"><span>Budget not set</span><span className="mono">Spent {inr(p.spent)}</span></div>
          <div className="nb-note">No founder budget on record for this project{p.pr_30d > 0 ? ' — but it has recent PR activity' : ''}. Spend shown is system actuals only.</div>
        </div>
      )}

      <div className="splits">
        <div className="split">
          <div className="sp-h">Purchase Orders</div>
          <div className="sp-main">{inr(p.po_paid)}<span className="sp-tag">paid</span></div>
          <div className="sp-sub">Total PO made: <b>{inr(p.po_made)}</b> ({p.po_made_n} {p.po_made_n === 1 ? 'PO' : 'POs'}) · paid on {p.po_paid_n}</div>
        </div>
        <div className="split">
          <div className="sp-h">Work Orders</div>
          <div className="sp-main">{inr(p.wo_made)}<span className="sp-tag made">made</span></div>
          <div className="sp-sub">{p.wo_n} {p.wo_n === 1 ? 'WO' : 'WOs'} · paid so far: {inr(p.wo_paid)}</div>
        </div>
        <div className="split">
          <div className="sp-h">Site Imprest</div>
          <div className="sp-main">{inr(p.imprest)}<span className="sp-tag">paid</span></div>
          <div className="sp-sub">{p.imprest_n} {p.imprest_n === 1 ? 'imprest' : 'imprests'} disbursed</div>
        </div>
      </div>

      <div className="ptables">
        <div className="tcard">
          <h3>Who raised the PRs <span className="th-note">{p.pr_total} PRs total</span></h3>
          <table className="dt">
            <thead><tr><th>Person</th><th>Role</th><th className="num">PRs</th><th>Latest</th></tr></thead>
            <tbody><RaiserRows raisers={p.pr_raisers} /></tbody>
          </table>
        </div>
        <div className="tcard">
          <h3>Who received the imprest <span className="th-note">{inr(p.imprest)} · {p.imprest_n} payments</span></h3>
          <table className="dt">
            <thead><tr><th>Person</th><th className="num">Imprests</th><th className="num">Amount</th></tr></thead>
            <tbody><RecipientRows recipients={p.imprest_recipients} /></tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────── page ───────────────────────── */
export function ProjectSpendDashboard() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const [view, setView] = useState<string>('overview') // 'overview' | project code

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['founder-project-spend'],
    queryFn: async (): Promise<SpendData> => {
      const { data, error } = await supabase.rpc('get_founder_project_spend')
      if (error) throw error
      return data as SpendData
    },
  })

  async function handleEditBudget(p: Project) {
    const current = p.budget != null ? String(p.budget) : ''
    const raw = window.prompt(
      `Set budget for ${p.name} (${p.code}).\nEnter the full rupee amount (e.g. 70000000 for ₹7 Cr).`,
      current,
    )
    if (raw == null) return
    const cleaned = raw.replace(/[,\s₹]/g, '')
    const amount = Number(cleaned)
    if (!isFinite(amount) || amount < 0) { toast.error('Enter a valid non-negative number'); return }
    const note = window.prompt('Optional note (why / source):', p.budget != null ? '' : '') ?? null
    const { error } = await supabase.rpc('set_project_budget', { p_code: p.code, p_budget: amount, p_note: note || null })
    if (error) { toast.error(`Could not save budget: ${error.message}`); return }
    toast.success(`Budget updated for ${p.name}`)
    refetch()
  }

  if (isLoading) {
    return (
      <div className="fsd"><style>{STYLE}</style>
        <div className="wrap"><div className="sec-h">Loading project spend… <span className="n">computing live from the Hub DB</span></div></div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="fsd"><style>{STYLE}</style>
        <div className="topbar"><button className="topbtn" onClick={() => navigate('/dashboard')}>← Hub</button></div>
        <div className="wrap">
          <div className="flagcard"><b>Could not load the report.</b> {(error as Error)?.message ?? 'No data returned.'}</div>
        </div>
      </div>
    )
  }

  const projects = data.projects
  const totals = projects.reduce(
    (a, p) => ({
      budget: a.budget + (p.budget ?? 0),
      po_paid: a.po_paid + p.po_paid,
      wo_made: a.wo_made + p.wo_made,
      imprest: a.imprest + p.imprest,
      spent: a.spent + p.spent,
    }),
    { budget: 0, po_paid: 0, wo_made: 0, imprest: 0, spent: 0 },
  )
  const selected = view !== 'overview' ? projects.find((p) => p.code === view) : null
  const un = data.unmapped

  return (
    <div className="fsd">
      <style>{STYLE}</style>

      <div className="topbar">
        <button className="topbtn" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</button>
        <button className="topbtn" onClick={() => navigate('/dashboard')}>← Hub</button>
        <button className="topbtn" onClick={async () => { await signOut(); navigate('/login') }}>Sign out</button>
      </div>

      <div className="wrap">
        <div className="mast">
          <div>
            <div className="sys">Hagerstone Hub · Procurement &amp; Finance</div>
            <h1>Project Spend &amp; Budget</h1>
            <div className="scope">Per-project budget vs actual spend, recorded in the system. Spend is split into <b>PO paid</b>, <b>Work-order value (made)</b> and <b>site imprest paid</b> — with names of who raised each PR and who received each imprest. Click any project.</div>
          </div>
          <div className="mast-r">Position<br /><span className="asof">As of {fmtAsOf(data.as_of)}</span><br />
            <span style={{ fontSize: '11px' }}>Source: live Hub DB</span><br /><span style={{ fontSize: '11px' }}>{projects.length} projects</span></div>
        </div>

        {/* Project buttons */}
        <div className="btnbar">
          <button className={`pbtn ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Overview</button>
          {projects.map((p) => (
            <button key={p.code} className={`pbtn ${view === p.code ? 'active' : ''}`} onClick={() => setView(p.code)}>{p.name}</button>
          ))}
        </div>

        {/* Overview */}
        {view === 'overview' && (
          <section>
            <div className="sec-h">Portfolio overview <span className="n">budget vs spend across all projects — click a row to drill in</span></div>
            <div className="ovwrap">
              <table className="ov">
                <thead><tr>
                  <th>Project</th><th>Budget</th><th>PO paid</th><th>WO made</th><th>Imprest</th><th>Total spent</th><th>Budget used</th>
                </tr></thead>
                <tbody>
                  {projects.map((p) => {
                    const uc = utilClass(p.pct)
                    return (
                      <tr key={p.code} className="ovrow" tabIndex={0} role="button"
                        aria-label={`Open ${p.name}`}
                        onClick={() => setView(p.code)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView(p.code) } }}>
                        <td className="pname">
                          <span className="pn">{p.name}</span>
                          {p.budget == null && <span className="badge nb">no budget</span>}
                        </td>
                        <td className="num mono">{p.budget != null ? compactINR(p.budget) : <span className="na">not set</span>}</td>
                        <td className="num mono">{inr(p.po_paid)}</td>
                        <td className="num mono">{inr(p.wo_made)}</td>
                        <td className="num mono">{inr(p.imprest)}</td>
                        <td className="num mono spent">{inr(p.spent)}</td>
                        <td className="util">
                          <div className={`ubar ${uc}`}><span style={{ width: barWidth(p.pct) }}></span></div>
                          <span className={`upct ${uc}`}>{p.pct != null ? `${p.pct}%` : '—'}</span>
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="ovtot">
                    <td>All projects</td>
                    <td className="num mono">{compactINR(totals.budget)}</td>
                    <td className="num mono">{inr(totals.po_paid)}</td>
                    <td className="num mono">{inr(totals.wo_made)}</td>
                    <td className="num mono">{inr(totals.imprest)}</td>
                    <td className="num mono spent">{inr(totals.spent)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flagcard">
              <b>Not attributed to any project:</b> {inr(un.total)} of imprest ({un.count} payments) was booked to sites that don't resolve to a project — head-office / Bangalore / overhead or unmapped site names. It is excluded from the project figures above rather than guessed. Tell me the right project for any of these and I'll fold them in.
            </div>
          </section>
        )}

        {/* Per-project panel */}
        {selected && (
          <ProjectPanel p={selected} onBack={() => setView('overview')} onEditBudget={handleEditBudget} />
        )}

        {/* Methodology footer */}
        <div className="method">
          <h3>How this is built &amp; what to verify</h3>
          <ul>
            <li><b>Spend = system actuals</b>, pulled live from the Hub DB. <b>PO paid</b> from <code>cps.cps_purchase_orders.finance_paid_amount</code>; <b>PO made</b> = value of issued POs (<code>sent/closed/dispatched/delivered</code>, excludes draft &amp; cancelled). <b>WO made</b> = work-order order value (<code>cps_work_orders</code> grand total); WO paid shown separately. <b>Imprest</b> = approved amount of paid imprests, attributed to the site.</li>
            <li><b>"Total spent" = PO paid + WO made + imprest paid</b> (PO counted as paid, WO counted as made/ordered). The two bases are labelled separately on each card.</li>
            <li><b>Budgets are manual</b> (founder-set, stored in <code>cps.project_budgets</code>) — not derived from the system. They can be edited in-app via "Edit budget".</li>
            <li><b>Imprest site attribution</b> uses the site→project mapping tables; sites that don't resolve are shown in the "not attributed" box, not forced onto a project.</li>
            <li>Point-in-time snapshot; figures move as payments and approvals clear. Amounts rounded to whole rupees.</li>
          </ul>
          {un.recipients.length > 0 && (
            <details style={{ marginTop: '10px' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--ink2)', fontWeight: 600 }}>View the {un.count} unattributed imprest payments ({un.recipients.length} recipients)</summary>
              <table className="dt" style={{ marginTop: '8px' }}>
                <thead><tr><th>Recipient</th><th className="num">Imprests</th><th className="num">Amount</th></tr></thead>
                <tbody>{un.recipients.map((r, i) => (
                  <tr key={i}><td>{r.name}</td><td className="num mono">{r.n}</td><td className="num mono">{inr(r.amount)}</td></tr>
                ))}</tbody>
              </table>
            </details>
          )}
        </div>

        <div className="foot">Hagerstone International — internal spend &amp; budget report · generated live from the Hub DB</div>
      </div>
    </div>
  )
}
