-- founder_cps_pr_ageing — "which procurement head is a PR stuck with, and for how many days".
-- Mirrors founder_imprest_ageing's shape (as_of / kpis / grouped-lists / items) so the same
-- report-page pattern (PublicAgeingReport.tsx) can render both.
--
-- Scope: PRs in status 'pending' (raised, no RFQ yet) or 'rfq_created' (RFQ out, no PO yet).
-- po_issued / delivered / cancelled / duplicate_flagged are excluded — those aren't sitting
-- with a procurement head anymore.
--
-- Owner resolution: cps_purchase_requisitions.assigned_to_user_id is the PR's direct owner.
-- If that's ever null (legacy rows), fall back to the project's assigned procurement head via
-- cps_project_assignments. Only if both are null does it show "Unassigned — procurement pool".
--
-- Run this in the Supabase SQL editor (or via mcp__claude_ai_Supabase__execute_sql) against
-- project tpfvnerrjhqwipyonngf. Not auto-applied — no supabase/migrations/ in this repo; RPCs
-- here are managed by hand, same as founder_imprest_ageing.

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
      pr.id,
      pr.pr_number                                   AS ref,
      pr.project_code                                AS project,
      pr.project_site                                AS site,
      pr.status,
      pr.priority,
      pr.created_at,
      pr.required_by,
      req.name                                        AS requester,
      COALESCE(owner_direct.name, owner_proj.name, 'Unassigned — procurement pool') AS owner,
      COALESCE(owner_direct.id, owner_proj.id)         AS owner_id,
      GREATEST(EXTRACT(DAY FROM now() - pr.created_at)::int, 0) AS age_days
    FROM cps.cps_purchase_requisitions pr
    LEFT JOIN cps.cps_users req
      ON req.id = pr.requested_by
    LEFT JOIN cps.cps_users owner_direct
      ON owner_direct.id = pr.assigned_to_user_id
    LEFT JOIN cps.cps_project_assignments pa
      ON pa.project_code = pr.project_code
    LEFT JOIN cps.cps_users owner_proj
      ON owner_proj.id = pa.assigned_to_user_id
    WHERE pr.status IN ('pending', 'rfq_created')
      AND (p_project IS NULL OR pr.project_code = p_project)
  ),
  banded AS (
    SELECT *,
      CASE
        WHEN age_days <= 7  THEN '0-7'
        WHEN age_days <= 15 THEN '8-15'
        WHEN age_days <= 30 THEN '16-30'
        WHEN age_days <= 60 THEN '31-60'
        ELSE '60+'
      END AS band
    FROM stuck
  ),
  band_json AS (
    SELECT
      owner, status,
      jsonb_build_object(
        '0-7',   count(*) FILTER (WHERE band = '0-7'),
        '8-15',  count(*) FILTER (WHERE band = '8-15'),
        '16-30', count(*) FILTER (WHERE band = '16-30'),
        '31-60', count(*) FILTER (WHERE band = '31-60'),
        '60+',   count(*) FILTER (WHERE band = '60+')
      ) AS bands
    FROM banded
    GROUP BY GROUPING SETS ((owner), (status))
  ),
  by_owner AS (
    SELECT
      b.owner,
      count(*)                          AS count,
      max(b.age_days)                   AS oldest,
      round(avg(b.age_days))::int       AS avg,
      (SELECT bands FROM band_json j WHERE j.owner = b.owner AND j.status IS NULL) AS bands
    FROM banded b
    GROUP BY b.owner
  ),
  by_stage AS (
    SELECT
      b.status AS stage_key,
      CASE b.status
        WHEN 'pending'      THEN 'Pending review — no RFQ yet'
        WHEN 'rfq_created'  THEN 'RFQ sent — awaiting quotes'
        ELSE b.status
      END AS label,
      count(*)                          AS count,
      max(b.age_days)                   AS oldest,
      round(avg(b.age_days))::int       AS avg,
      (SELECT bands FROM band_json j WHERE j.status = b.status AND j.owner IS NULL) AS bands
    FROM banded b
    GROUP BY b.status
  ),
  oldest_item AS (
    SELECT ref, owner, age_days FROM banded ORDER BY age_days DESC LIMIT 1
  ),
  top_owner AS (
    SELECT owner, count FROM by_owner ORDER BY count DESC, oldest DESC LIMIT 1
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'kpis', jsonb_build_object(
      'stuck_count',      (SELECT count(*) FROM banded),
      'oldest_days',      COALESCE((SELECT age_days FROM oldest_item), 0),
      'oldest_ref',       (SELECT ref FROM oldest_item),
      'oldest_owner',     (SELECT owner FROM oldest_item),
      'breach_gt7',       (SELECT count(*) FROM banded WHERE age_days > 7),
      'breach_gt15',      (SELECT count(*) FROM banded WHERE age_days > 15),
      'breach_gt30',      (SELECT count(*) FROM banded WHERE age_days > 30),
      'top_owner',        (SELECT owner FROM top_owner),
      'top_owner_count',  COALESCE((SELECT count FROM top_owner), 0)
    ),
    'by_owner', COALESCE((SELECT jsonb_agg(to_jsonb(by_owner) ORDER BY (by_owner.count) DESC) FROM by_owner), '[]'::jsonb),
    'by_stage', COALESCE((SELECT jsonb_agg(to_jsonb(by_stage) ORDER BY (by_stage.count) DESC) FROM by_stage), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ref', ref, 'project', project, 'site', site, 'status', status,
        'stage_key', status, 'priority', priority, 'requester', requester,
        'owner', owner, 'created_at', created_at, 'required_by', required_by,
        'age_days', age_days, 'band', band
      ) ORDER BY age_days DESC)
      FROM banded
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.founder_cps_pr_ageing(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.founder_cps_pr_ageing(text) TO authenticated;

-- Verification (run after creating):
--   SELECT public.founder_cps_pr_ageing(NULL);
--   -- kpis.stuck_count should equal:
--   SELECT count(*) FROM cps.cps_purchase_requisitions WHERE status IN ('pending','rfq_created');
--   -- confirm no PR resolves to "Unassigned — procurement pool" (per Aniket, none should as of 2026-08):
--   SELECT ref, owner FROM jsonb_to_recordset(
--     (SELECT items FROM public.founder_cps_pr_ageing(NULL) ...)  -- or just eyeball the items array
--   ) AS x(ref text, owner text) WHERE owner = 'Unassigned — procurement pool';
