-- cps_team_pr_ageing — the WHOLE team's stuck PRs, for the CPS admin dashboard.
-- Consumed by the CPS app (Ai983/hagerstone-cps):
-- src/components/procurement/TeamStuckPRsCard.tsx on /dashboard.
--
-- cps_my_pr_ageing() answers "what is stuck with ME"; this answers "what is stuck across the
-- team, and with whom". Admins own no PRs, so the personal card is permanently green for them
-- and gave them no visibility at all — this is the counterpart.
--
-- Delegates to public.founder_cps_pr_ageing(NULL) instead of restating the query, so owner
-- resolution, stage derivation and age bands can never drift between the founder's 7 PM brief,
-- the Hub report and this card. The role gate is the only thing this function adds.
--
-- Gated to it_head + management (CPS's admin roles) via the caller's cps_users.role, checked
-- SERVER-side — hiding the card in the UI alone would leave the data callable over the API.
-- Returns NULL for everyone else; the component treats NULL as "render nothing".
--
-- Verified 2026-08-10: it_head (admin@hagerstone.com) receives all 41 PRs; Ajit
-- (procurement_head) is denied and gets NULL.
--
-- NOTE / open item: public.founder_cps_pr_ageing itself is granted to `authenticated` with no
-- internal role check — the Hub gates it at the route level, not in the RPC. Any logged-in user
-- could therefore call it directly and read the company-wide PR backlog. Tightening it means
-- adding a gate that still admits the Hub's founder/admin/management (public.employees.role)
-- AND the service_role used by founder-daily-digest, so it was left alone rather than risk
-- breaking the live founder dashboard. Worth doing deliberately.
--
-- Apply with mcp__claude_ai_Supabase__apply_migration against tpfvnerrjhqwipyonngf.

CREATE OR REPLACE FUNCTION public.cps_team_pr_ageing()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  SELECT cu.role INTO v_role
  FROM cps.cps_users cu
  WHERE cu.auth_uid = auth.uid() AND cu.active
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('it_head', 'management') THEN
    RETURN NULL;
  END IF;

  RETURN public.founder_cps_pr_ageing(NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.cps_team_pr_ageing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cps_team_pr_ageing() TO authenticated;

-- Verification (simulate a session; auth.uid() reads request.jwt.claims->>'sub'):
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub','<auth_uid>','role','authenticated')::text, true);
--   SELECT public.cps_team_pr_ageing() IS NOT NULL;   -- true only for it_head / management
