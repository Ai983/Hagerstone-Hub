-- cps_my_pr_ageing — the caller's OWN stuck PRs, and what is actually blocking each one.
-- Consumed by the CPS app (Ai983/hagerstone-cps): src/components/procurement/MyStuckPRsCard.tsx,
-- rendered at the top of /dashboard. Kept here beside founder_cps_pr_ageing so both ageing RPCs
-- live in one place; the CPS repo holds no copy.
--
-- Scoped by auth.uid() and takes NO parameters, so a procurement head cannot request another
-- head's queue — there is no input by which to do so. Safe to grant to `authenticated`.
--
-- Owner resolution matches founder_cps_pr_ageing: direct assigned_to_user_id first, then the
-- project's head via cps_project_assignments — both restricted to role='procurement_head' so a
-- site requestor is never mistaken for the owner.
--
-- WHY THE STAGE IS NOT JUST pr.status:
-- cps_rfqs.status is frequently 'draft' — the RFQ row exists but was never sent to a supplier.
-- A PR therefore reads pr.status='rfq_created' while nothing has left the building. Of 41 live
-- stuck PRs on 2026-08-10, 29 were draft RFQs and ZERO were genuinely awaiting supplier quotes.
-- Each stage carries needs_you: true = blocked on the head, false = really waiting on a vendor.
--
-- Status scope is pending | validated | rfq_created. 'validated' (passed the two-gate PR
-- verification, no RFQ yet) was missing from both reports until 2026-08-10 — 2 were live,
-- averaging 80 days, invisible to everyone.
--
-- Apply with mcp__claude_ai_Supabase__apply_migration against tpfvnerrjhqwipyonngf.
-- Live definition is authoritative; re-dump this file if it drifts.

CREATE OR REPLACE FUNCTION public.cps_my_pr_ageing()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_me uuid; v_name text; result jsonb;
  empty jsonb := jsonb_build_object('as_of', now(), 'me', NULL,
    'kpis', jsonb_build_object('total',0,'needs_you',0,'oldest_days',0,
                               'breach_gt7',0,'breach_gt15',0,'breach_gt30',0),
    'by_stage', '[]'::jsonb, 'items', '[]'::jsonb);
BEGIN
  IF v_uid IS NULL THEN RETURN empty; END IF;

  SELECT cu.id, cu.name INTO v_me, v_name
  FROM cps.cps_users cu WHERE cu.auth_uid = v_uid AND cu.active LIMIT 1;

  IF v_me IS NULL THEN RETURN empty; END IF;

  WITH mine AS (
    SELECT
      pr.pr_number AS ref, pr.project_code AS project, pr.project_site AS site,
      pr.status, pr.priority, pr.created_at, pr.required_by, req.name AS requester,
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
      FROM cps.cps_rfqs r WHERE r.pr_id = pr.id AND r.status <> 'cancelled'
      ORDER BY r.created_at DESC LIMIT 1
    ) rq ON true
    WHERE pr.status IN ('pending', 'validated', 'rfq_created')
      AND COALESCE(owner_direct.id, owner_proj.id) = v_me
  ),
  staged AS (
    SELECT *,
      CASE WHEN age_days <= 7 THEN '0-7' WHEN age_days <= 15 THEN '8-15'
           WHEN age_days <= 30 THEN '16-30' WHEN age_days <= 60 THEN '31-60'
           ELSE '60+' END AS band,
      CASE WHEN status = 'pending'   THEN 'pr_raised'
           WHEN status = 'validated' THEN 'pr_validated'
           WHEN rfq_number IS NULL   THEN 'rfq_missing'
           WHEN rfq_status = 'draft' THEN 'rfq_draft'
           WHEN quote_count = 0      THEN 'awaiting_quotes'
           ELSE 'quotes_in' END AS stage_key
    FROM mine
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
    FROM staged
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'me', jsonb_build_object('cps_user_id', v_me, 'name', v_name),
    'kpis', jsonb_build_object(
      'total', (SELECT count(*) FROM labelled),
      'needs_you', (SELECT count(*) FROM labelled WHERE needs_you),
      'oldest_days', COALESCE((SELECT max(age_days) FROM labelled), 0),
      'breach_gt7', (SELECT count(*) FROM labelled WHERE age_days > 7),
      'breach_gt15', (SELECT count(*) FROM labelled WHERE age_days > 15),
      'breach_gt30', (SELECT count(*) FROM labelled WHERE age_days > 30)
    ),
    'by_stage', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'needs_you')::boolean DESC, (x->>'count')::int DESC)
      FROM (SELECT jsonb_build_object('stage_key', stage_key, 'label', min(stage_label),
                     'needs_you', bool_or(needs_you), 'count', count(*), 'oldest', max(age_days)) AS x
            FROM labelled GROUP BY stage_key) s
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ref', ref, 'project', project, 'site', site, 'priority', priority,
        'requester', requester, 'rfq_number', rfq_number, 'rfq_status', rfq_status,
        'quote_count', quote_count, 'required_by', required_by, 'created_at', created_at,
        'age_days', age_days, 'band', band, 'stage_key', stage_key,
        'stage_label', stage_label, 'needs_you', needs_you
      ) ORDER BY needs_you DESC, age_days DESC) FROM labelled
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.cps_my_pr_ageing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cps_my_pr_ageing() TO authenticated;

-- Verification:
--   SELECT public.cps_my_pr_ageing();   -- as an authenticated user: own queue only, else empty
