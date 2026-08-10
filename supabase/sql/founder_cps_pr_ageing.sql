-- founder_cps_pr_ageing — "which procurement head is a PR stuck with, for how long, and what is
-- actually blocking it". Mirrors founder_imprest_ageing's shape (as_of / kpis / grouped-lists /
-- items) so PublicAgeingReport.tsx can render both. Also feeds founder-daily-digest (7 PM brief).
-- Per-person mirror consumed by the CPS app: public.cps_my_pr_ageing().
--
-- Scope: pending | validated | rfq_created. po_issued / delivered / cancelled /
-- duplicate_flagged are excluded — those aren't sitting with a procurement head anymore.
--
-- Owner resolution: assigned_to_user_id first, else the project's head via
-- cps_project_assignments, else "Unassigned — procurement pool".
--
-- FIX 2026-08-10 (a): cps_project_assignments.assigned_to_user_id is the project's site
-- REQUESTOR, not its procurement head — Mohit Sharma and Shubham Rajput (both role='requestor')
-- were being shown as "owners" via that fallback. Both fallback joins now require
-- role='procurement_head', so a requestor can never be mistaken for the head holding the PR.
--
-- FIX 2026-08-10 (b): 'validated' PRs (passed the two-gate verification, no RFQ yet) were
-- excluded entirely. 2 were live, averaging 80 days — invisible to the founder and to the head.
--
-- FIX 2026-08-10 (c): the stage was reported straight from pr.status, so 'rfq_created' was
-- labelled "RFQ sent — awaiting quotes". But cps_rfqs.status is frequently 'draft' — the RFQ was
-- never sent to any supplier. That told the founder vendors were slow when the work had not left
-- the building: of 41 live stuck PRs, 29 were draft RFQs and ZERO were truly awaiting quotes.
-- The stage is now derived from the latest non-cancelled RFQ + its quote count, and every row
-- carries needs_you (true = blocked on the head, false = genuinely waiting on a supplier).
--
-- Apply with mcp__claude_ai_Supabase__apply_migration against tpfvnerrjhqwipyonngf.
-- Live definition is authoritative; re-dump this file if it drifts.

CREATE OR REPLACE FUNCTION public.founder_cps_pr_ageing(p_project text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH stuck AS (
    SELECT
      pr.pr_number AS ref, pr.project_code AS project, pr.project_site AS site,
      pr.status, pr.priority, pr.created_at, pr.required_by,
      req.name AS requester,
      COALESCE(owner_direct.name, owner_proj.name, 'Unassigned — procurement pool') AS owner,
      rq.rfq_number, rq.status AS rfq_status, COALESCE(rq.quote_count, 0) AS quote_count,
      GREATEST(EXTRACT(DAY FROM now() - pr.created_at)::int, 0) AS age_days
    FROM cps.cps_purchase_requisitions pr
    LEFT JOIN cps.cps_users req ON req.id = pr.requested_by
    LEFT JOIN cps.cps_users owner_direct
      ON owner_direct.id = pr.assigned_to_user_id AND owner_direct.role = 'procurement_head'
    LEFT JOIN cps.cps_project_assignments pa ON pa.project_code = pr.project_code
    LEFT JOIN cps.cps_users owner_proj
      ON owner_proj.id = pa.assigned_to_user_id AND owner_proj.role = 'procurement_head'
    LEFT JOIN LATERAL (
      SELECT r.rfq_number, r.status,
             (SELECT count(*) FROM cps.cps_quotes q WHERE q.rfq_id = r.id) AS quote_count
      FROM cps.cps_rfqs r
      WHERE r.pr_id = pr.id AND r.status <> 'cancelled'
      ORDER BY r.created_at DESC LIMIT 1
    ) rq ON true
    WHERE pr.status IN ('pending', 'validated', 'rfq_created')
      AND (p_project IS NULL OR pr.project_code = p_project)
  ),
  banded AS (
    SELECT *,
      CASE WHEN age_days <= 7 THEN '0-7' WHEN age_days <= 15 THEN '8-15'
           WHEN age_days <= 30 THEN '16-30' WHEN age_days <= 60 THEN '31-60'
           ELSE '60+' END AS band,
      CASE WHEN status = 'pending'          THEN 'pr_raised'
           WHEN status = 'validated'        THEN 'pr_validated'
           WHEN rfq_number IS NULL          THEN 'rfq_missing'
           WHEN rfq_status = 'draft'        THEN 'rfq_draft'
           WHEN quote_count = 0             THEN 'awaiting_quotes'
           ELSE 'quotes_in' END AS stage_key
    FROM stuck
  ),
  labelled AS (
    SELECT *,
      CASE stage_key
        WHEN 'pr_raised'       THEN 'PR raised — RFQ not created yet'
        WHEN 'pr_validated'    THEN 'Verified — RFQ not created yet'
        WHEN 'rfq_missing'     THEN 'Marked RFQ-created, but no live RFQ exists'
        WHEN 'rfq_draft'       THEN 'RFQ drafted — NOT sent to suppliers'
        WHEN 'awaiting_quotes' THEN 'RFQ sent — awaiting supplier quotes'
        ELSE                        'Quotes received — comparison & PO pending'
      END AS stage_label,
      (stage_key <> 'awaiting_quotes') AS needs_you
    FROM banded
  ),
  band_json AS (
    SELECT owner, stage_key,
      jsonb_build_object(
        '0-7',   count(*) FILTER (WHERE band = '0-7'),
        '8-15',  count(*) FILTER (WHERE band = '8-15'),
        '16-30', count(*) FILTER (WHERE band = '16-30'),
        '31-60', count(*) FILTER (WHERE band = '31-60'),
        '60+',   count(*) FILTER (WHERE band = '60+')
      ) AS bands
    FROM labelled GROUP BY GROUPING SETS ((owner), (stage_key))
  ),
  by_owner AS (
    SELECT b.owner, count(*) AS count, max(b.age_days) AS oldest,
      round(avg(b.age_days))::int AS avg,
      count(*) FILTER (WHERE b.needs_you) AS needs_them,
      (SELECT bands FROM band_json j WHERE j.owner = b.owner AND j.stage_key IS NULL) AS bands
    FROM labelled b GROUP BY b.owner
  ),
  by_stage AS (
    SELECT b.stage_key, min(b.stage_label) AS label, bool_or(b.needs_you) AS needs_you,
      count(*) AS count, max(b.age_days) AS oldest, round(avg(b.age_days))::int AS avg,
      (SELECT bands FROM band_json j WHERE j.stage_key = b.stage_key AND j.owner IS NULL) AS bands
    FROM labelled b GROUP BY b.stage_key
  ),
  oldest_item AS (SELECT ref, owner, age_days FROM labelled ORDER BY age_days DESC LIMIT 1),
  top_owner  AS (SELECT owner, count FROM by_owner ORDER BY count DESC, oldest DESC LIMIT 1)
  SELECT jsonb_build_object(
    'as_of', now(),
    'kpis', jsonb_build_object(
      'stuck_count',     (SELECT count(*) FROM labelled),
      'needs_action',    (SELECT count(*) FROM labelled WHERE needs_you),
      'oldest_days',     COALESCE((SELECT age_days FROM oldest_item), 0),
      'oldest_ref',      (SELECT ref FROM oldest_item),
      'oldest_owner',    (SELECT owner FROM oldest_item),
      'breach_gt7',      (SELECT count(*) FROM labelled WHERE age_days > 7),
      'breach_gt15',     (SELECT count(*) FROM labelled WHERE age_days > 15),
      'breach_gt30',     (SELECT count(*) FROM labelled WHERE age_days > 30),
      'top_owner',       (SELECT owner FROM top_owner),
      'top_owner_count', COALESCE((SELECT count FROM top_owner), 0)
    ),
    'by_owner', COALESCE((SELECT jsonb_agg(to_jsonb(by_owner) ORDER BY (by_owner.count) DESC) FROM by_owner), '[]'::jsonb),
    'by_stage', COALESCE((SELECT jsonb_agg(to_jsonb(by_stage) ORDER BY (by_stage.count) DESC) FROM by_stage), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ref', ref, 'project', project, 'site', site, 'status', status,
        'stage_key', stage_key, 'stage_label', stage_label, 'needs_you', needs_you,
        'priority', priority, 'requester', requester, 'owner', owner,
        'rfq_number', rfq_number, 'quote_count', quote_count,
        'created_at', created_at, 'required_by', required_by,
        'age_days', age_days, 'band', band
      ) ORDER BY age_days DESC) FROM labelled
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.founder_cps_pr_ageing(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.founder_cps_pr_ageing(text) TO authenticated;

-- Verification:
--   SELECT public.founder_cps_pr_ageing(NULL);
--   -- kpis.stuck_count should equal:
--   SELECT count(*) FROM cps.cps_purchase_requisitions
--    WHERE status IN ('pending','validated','rfq_created');
--   -- by_owner should only contain role='procurement_head' names or the literal
--   -- "Unassigned — procurement pool". Any other name means a role check regressed.
