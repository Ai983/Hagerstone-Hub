-- Snag site whitelist + grouped ("one link, many sites") form links.
--
-- Two things here:
--
--   1. Snag reporting is NOT offered for every project in the Hub. Only the
--      handed-over sites on Saksham's list get a client link, so the Client
--      Links tab is a short, deliberate list rather than all 40-odd projects.
--
--   2. Vinfast is one client with seven sites. They get ONE link; the client
--      picks their site on the form. That means a form link must be able to
--      point at a GROUP of projects rather than exactly one.
--
-- Apply via Supabase MCP execute_sql against tpfvnerrjhqwipyonngf (this repo has
-- no migrations runner — supabase/sql/ is the checked-in record of applied DDL).
--
-- Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Whitelist + grouping flags on public.projects
-- ─────────────────────────────────────────────────────────────────────────────
-- Columns on the shared projects table rather than a snag_sites side table, for
-- the same reason the snag_* flags live on employees: it keeps the join count
-- down and the flag next to the row it describes. Both default to off/null, so
-- delegation, GIE and every other consumer of public.projects is unaffected.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS snag_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snag_group   text;

COMMENT ON COLUMN public.projects.snag_enabled IS 'Site is offered for client snag reporting (shows on the Snags → Client Links tab).';
COMMENT ON COLUMN public.projects.snag_group   IS 'Sites sharing a group_key are reachable through one grouped form link; the client picks the site on the form.';

CREATE INDEX IF NOT EXISTS projects_snag_group_idx
  ON public.projects (snag_group) WHERE snag_group IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Let a form link target a group instead of a single project
-- ─────────────────────────────────────────────────────────────────────────────
-- project_id becomes nullable and gains an XOR partner. A link is either
-- "this one site" or "this group of sites", never both and never neither —
-- enforced by the CHECK so a half-built row can't reach the public form.

ALTER TABLE public.snag_form_links
  ADD COLUMN IF NOT EXISTS group_key text;

ALTER TABLE public.snag_form_links ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.snag_form_links DROP CONSTRAINT IF EXISTS snag_form_links_target_ck;
ALTER TABLE public.snag_form_links
  ADD CONSTRAINT snag_form_links_target_ck
  CHECK ((project_id IS NOT NULL) <> (group_key IS NOT NULL));

-- One live link per group, mirroring the "one active link per project" habit the
-- Client Links tab already assumes. Partial, so revoked rows keep their history.
CREATE UNIQUE INDEX IF NOT EXISTS snag_form_links_active_group_idx
  ON public.snag_form_links (group_key) WHERE group_key IS NOT NULL AND is_active;

-- snag_reports.project_id stays NOT NULL: a grouped link still resolves to one
-- concrete site at submit time. The site the client picked is the project the
-- report is filed against, so the Snag Queue needs no special case.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The site list
-- ─────────────────────────────────────────────────────────────────────────────
-- Reset first so re-running this file after the list changes REMOVES sites that
-- dropped off it — otherwise the whitelist only ever grows.

UPDATE public.projects SET snag_enabled = false, snag_group = NULL
 WHERE snag_enabled OR snag_group IS NOT NULL;

-- Vinfast — seven sites behind one client link.
UPDATE public.projects SET snag_enabled = true, snag_group = 'vinfast'
 WHERE code IN (
   'VINFAST-ND',   -- Vinfast Noida
   'VINFAST-PP',   -- Vinfast Patparganj
   'VINFAST-GZB',  -- Vinfast Ghaziabad
   'VINFAST-VSH',  -- Vinfast Vaishali, Jaipur
   'VINFAST-JP',   -- Vinfast Sikar Road, Jaipur
   'VINFAST-TNK',  -- Vinfast Tonk Road, Jaipur
   'VINFAST-JTW'   -- Vinfast Jotwara Workshop, Jaipur
 );

-- Everything else on the list gets its own link.
UPDATE public.projects SET snag_enabled = true
 WHERE code IN (
   'VST-COREB',    -- Vst Kotputli
   'DEE-FND',      -- Dee Foundation
   'MINEBEA',      -- Minebea Mitsumi
   'KOKO',         -- Koko Town
   'VANEET',       -- Vaneet Infra
   'HERO-RLT',     -- Hero Homes Ludhiana
   'HERO-MU',      -- Hero Homes MU, Greater Noida
   'THEON',        -- Theon Nalagarh
   'Consern ltd',  -- Consern Pharma Limited
   'HIMALAYA',     -- Himalaya Sultanpur
   'M3M',
   'MAX',          -- Max Hospital, Saket
   'MICROSAVE',
   'SAEL'          -- Sael Aerocity
 );

-- VINFAST-JP is Sikar Road — the bare name "Vinfast Jaipur" is unusable in a
-- picker that also lists Vaishali, Tonk Road and Jotwara. The alias already
-- recorded the real name; this promotes it.
UPDATE public.projects
   SET name = 'Vinfast Sikar Road Jaipur'
 WHERE code = 'VINFAST-JP' AND name = 'Vinfast Jaipur';

-- A whitelisted site that is inactive would silently vanish from the tab.
UPDATE public.projects SET is_active = true WHERE snag_enabled AND NOT is_active;

-- Verify — expect 21 rows, 7 of them group 'vinfast':
--   SELECT code, name, snag_group FROM public.projects
--    WHERE snag_enabled ORDER BY snag_group NULLS LAST, name;
