-- Snag management — post-handover client defect reports.
--
-- Clients report snags through a public, per-project secret form link (no login);
-- submissions land here and are worked in the Hub's /snags page. Apply via
-- Supabase MCP execute_sql against project tpfvnerrjhqwipyonngf (this repo has no
-- migrations runner — supabase/sql/ is the checked-in record of hand-applied DDL).
--
-- Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Access flags on public.employees
-- ─────────────────────────────────────────────────────────────────────────────
-- Three flags, not two: the notify set is not the write set. Saksham writes and
-- is notified; Ritu is notified but read-only; the founder/EA/admin only view.
-- Granted per-employee from the admin Edit Employee page, so changing who is
-- involved never needs a deploy (same precedent as del_super).

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS snag_viewer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snag_owner  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snag_notify boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.employees.snag_viewer IS 'Read-only access to the Snags page.';
COMMENT ON COLUMN public.employees.snag_owner  IS 'Snags page access PLUS the right to update status and close.';
COMMENT ON COLUMN public.employees.snag_notify IS 'Receives the WhatsApp alert when a new snag is submitted.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Per-project form links
-- ─────────────────────────────────────────────────────────────────────────────
-- A table rather than a column on projects, so a leaked link can be revoked and
-- reissued without disturbing the project row, and so we keep the history.

CREATE TABLE IF NOT EXISTS public.snag_form_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- URL-safe, unguessable. encode(...,'base64') then made URL-safe and trimmed.
  -- pgcrypto lives in the `extensions` schema on Supabase, so qualify it rather
  -- than depend on whatever search_path happens to be in effect.
  token       text NOT NULL UNIQUE
                DEFAULT translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'),
  label       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

CREATE INDEX IF NOT EXISTS snag_form_links_project_idx ON public.snag_form_links (project_id);
-- Token lookup is the hot path on every public form hit; UNIQUE already indexes it.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Snag reports
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.snag_reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            text NOT NULL UNIQUE,
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  form_link_id   uuid REFERENCES public.snag_form_links(id) ON DELETE SET NULL,

  -- The client. There is no clients/customers table in this system, so identity
  -- is captured on the report itself.
  reporter_name  text NOT NULL,
  reporter_phone text,
  reporter_email text,

  category       text,
  priority       text NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('low','medium','high','urgent')),
  title          text NOT NULL,
  description    text NOT NULL,
  -- [{url,type,name,size}] — the exact shape uploadAttachment() returns, so the
  -- existing attachment-rendering UI carries over unchanged.
  attachments    jsonb NOT NULL DEFAULT '[]'::jsonb,

  status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to    uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  resolution_note     text,
  closure_attachments jsonb NOT NULL DEFAULT '[]'::jsonb,

  source         text NOT NULL DEFAULT 'form',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  first_response_at timestamptz,
  resolved_at    timestamptz,
  closed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS snag_reports_status_idx  ON public.snag_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS snag_reports_project_idx ON public.snag_reports (project_id);

CREATE OR REPLACE FUNCTION public.snag_reports_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END; $$;

DROP TRIGGER IF EXISTS snag_reports_updated_at ON public.snag_reports;
CREATE TRIGGER snag_reports_updated_at
  BEFORE UPDATE ON public.snag_reports
  FOR EACH ROW EXECUTE FUNCTION public.snag_reports_touch_updated_at();

-- Reference number SNG-YYYYMMDD-000N, matching the HSE-/IMP- convention used in
-- finance. Assigned in a BEFORE trigger so concurrent inserts can't collide on a
-- read-then-write race; the UNIQUE constraint is the final backstop.
CREATE OR REPLACE FUNCTION public.snag_reports_assign_ref()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  day_key text := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD');
  next_n  integer;
BEGIN
  IF new.ref IS NOT NULL AND new.ref <> '' THEN RETURN new; END IF;

  SELECT coalesce(max(split_part(ref, '-', 3)::integer), 0) + 1
    INTO next_n
    FROM public.snag_reports
   WHERE ref LIKE 'SNG-' || day_key || '-%';

  new.ref := 'SNG-' || day_key || '-' || lpad(next_n::text, 4, '0');
  RETURN new;
END; $$;

DROP TRIGGER IF EXISTS snag_reports_ref ON public.snag_reports;
CREATE TRIGGER snag_reports_ref
  BEFORE INSERT ON public.snag_reports
  FOR EACH ROW EXECUTE FUNCTION public.snag_reports_assign_ref();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Event log — status history, comments, and notification outcomes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.snag_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snag_id     uuid NOT NULL REFERENCES public.snag_reports(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  event_type  text NOT NULL
                CHECK (event_type IN ('created','status_changed','comment','assigned','notified')),
  from_status text,
  to_status   text,
  note        text,

  -- 'notified' rows only. wa_message_id is the UUID the Plumbline gateway returns
  -- for a text send, which IS wa_messages.id — the join key for delivery status.
  -- The gateway queues and returns immediately, so a send that "succeeded" here
  -- may still end up failed; wa_messages.status is the only truth.
  recipient_phone text,
  wa_message_id   uuid,

  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS snag_events_snag_idx ON public.snag_events (snag_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Access helpers
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so they can read employees regardless of that table's own RLS.
-- These mirror the client-side route guards: the house rule is client guard for
-- UX, matching check server-side for actual security.

CREATE OR REPLACE FUNCTION public.can_view_snags()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
     WHERE e.auth_user_id = auth.uid()
       AND e.is_active
       AND (e.snag_viewer OR e.snag_owner OR e.role IN ('admin','founder'))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_snags()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
     WHERE e.auth_user_id = auth.uid()
       AND e.is_active
       AND (e.snag_owner OR e.role = 'admin')
  );
$$;

-- Delivery status for a set of snag notifications. A narrow reader rather than
-- granting snag viewers SELECT on wa_messages, which is service-role-only and
-- holds every message the company sends.
CREATE OR REPLACE FUNCTION public.snag_wa_status(p_ids uuid[])
RETURNS TABLE (id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.status
    FROM public.wa_messages m
   WHERE m.id = ANY(p_ids)
     AND public.can_view_snags();
$$;

-- These are signed-in gates. They already return false for an anonymous caller
-- (auth.uid() is null), but there is no reason to expose them on /rest/v1/rpc.
-- Revoke from PUBLIC, not just anon — anon INHERITS execute through PUBLIC, so
-- revoking from anon alone is a silent no-op.
REVOKE EXECUTE ON FUNCTION public.snag_wa_status(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_snags()       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_snags()     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snag_wa_status(uuid[])  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_snags()        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_snags()      TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- No anon policy anywhere: the public form never touches these tables directly.
-- Every client-side write goes through the snag-intake edge function under the
-- service-role key, which bypasses RLS.

ALTER TABLE public.snag_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snag_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snag_form_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS snag_reports_select ON public.snag_reports;
CREATE POLICY snag_reports_select ON public.snag_reports
  FOR SELECT TO authenticated USING (public.can_view_snags());

DROP POLICY IF EXISTS snag_reports_update ON public.snag_reports;
CREATE POLICY snag_reports_update ON public.snag_reports
  FOR UPDATE TO authenticated
  USING (public.can_manage_snags()) WITH CHECK (public.can_manage_snags());

DROP POLICY IF EXISTS snag_events_select ON public.snag_events;
CREATE POLICY snag_events_select ON public.snag_events
  FOR SELECT TO authenticated USING (public.can_view_snags());

DROP POLICY IF EXISTS snag_events_insert ON public.snag_events;
CREATE POLICY snag_events_insert ON public.snag_events
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_snags());

DROP POLICY IF EXISTS snag_form_links_select ON public.snag_form_links;
CREATE POLICY snag_form_links_select ON public.snag_form_links
  FOR SELECT TO authenticated USING (public.can_view_snags());

-- Link management is an admin action (it happens on the admin Projects page).
DROP POLICY IF EXISTS snag_form_links_insert ON public.snag_form_links;
CREATE POLICY snag_form_links_insert ON public.snag_form_links
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_snags());

DROP POLICY IF EXISTS snag_form_links_update ON public.snag_form_links;
CREATE POLICY snag_form_links_update ON public.snag_form_links
  FOR UPDATE TO authenticated
  USING (public.can_manage_snags()) WITH CHECK (public.can_manage_snags());

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Storage bucket
-- ─────────────────────────────────────────────────────────────────────────────
-- Public-read, consistent with delegation-uploads. Deliberately NO anon insert
-- policy: uploads require a signed upload URL minted by the edge function, so
-- finding the bucket is not enough to write to it.

INSERT INTO storage.buckets (id, name, public)
VALUES ('snag-uploads', 'snag-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Grant the initial people
-- ─────────────────────────────────────────────────────────────────────────────
-- Saksham owns and is alerted. Ritu is alerted on her EA account only — her
-- second account gets the page without a duplicate WhatsApp (the edge function
-- also de-dupes by phone, so this is belt and braces). Founder + admin view.
-- Adjust the Saksham lookup if his employees.email differs.

UPDATE public.employees SET snag_owner = true, snag_notify = true
 WHERE lower(name) LIKE 'saksham%' AND is_active;

UPDATE public.employees SET snag_viewer = true, snag_notify = true
 WHERE lower(email) = 'ea@hagerstone.com';

UPDATE public.employees SET snag_viewer = true
 WHERE lower(email) IN ('ritudesaiwal@gmail.com', 'world@hagerstone.com', 'ai@hagerstone.com');

-- Verify before relying on it — a zero-row UPDATE above is silent:
--   SELECT name, email, snag_viewer, snag_owner, snag_notify
--     FROM public.employees
--    WHERE snag_viewer OR snag_owner OR snag_notify;
