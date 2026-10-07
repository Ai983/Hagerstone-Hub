-- ============================================================================
-- Applied to the hub project (tpfvnerrjhqwipyonngf) on 2026-10-07.
--
-- Closes the two gaps between Hub onboarding and a complete employee setup.
-- The Add/Edit Employee pages could not set a posting, and never created the
-- attendance profile. Consequences, both seen in production:
--   * no site field at all => sync_module_access falls back to 'Head Office'
--     for finance.employees.site, so every hire filed imprest against Head
--     Office regardless of where they actually worked;
--   * no hr.employee_profile row => the person has no office_team flag and no
--     home site, so they are missing from the office/site split and cannot be
--     geofenced.
--
-- The Hub browser client is an anon-key client bound to the `public` schema and
-- hr.* has RLS on, so the page cannot write hr.employee_profile directly. Same
-- shape as sync_module_access/sync_employee_systems: SECURITY DEFINER, with the
-- caller proven to be a Hub admin (or the service role) before anything is
-- written.
-- Idempotent: safe to re-run.
-- ============================================================================

-- The site pick-list behind the Add/Edit dropdown. Read-only, names only, so it
-- is open to any signed-in user rather than admin-gated — a site list is not
-- sensitive and other panels may want it later.
create or replace function public.attendance_sites()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name
  from hr.sites s
  where s.active
  order by s.name;
$$;

grant execute on function public.attendance_sites() to authenticated, service_role;

-- Posting + attendance profile in one call, so the page cannot do half of it.
--   p_site_name    — written to public.employees.department AND propagated to
--                    finance.employees.site (the imprest filter). NULL leaves
--                    both untouched.
--   p_home_site_id — hr.sites row used for geofencing. NULL keeps any existing.
-- office_team is derived from staff_type rather than passed in: it is what
-- exempts office staff from the site location check, and letting a form send it
-- independently of staff_type is how the two drift apart.
create or replace function public.provision_employee_attendance(
  p_employee_id  uuid,
  p_site_name    text default null,
  p_home_site_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role   text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_is_admin   boolean := false;
  v_emp        public.employees%ROWTYPE;
  v_office     boolean;
  v_fin_id     uuid;
begin
  if v_jwt_role = 'service_role' then
    v_is_admin := true;
  else
    select exists (
      select 1 from public.employees
      where auth_user_id = auth.uid() and role = 'admin' and is_active
    ) into v_is_admin;
  end if;

  if not v_is_admin then
    raise exception 'provision_employee_attendance: caller is not an admin';
  end if;

  select * into v_emp from public.employees where id = p_employee_id;
  if not found then
    raise exception 'provision_employee_attendance: employee % not found', p_employee_id;
  end if;

  -- 'both' counts as office: office_team=false is what turns ON the site
  -- location check, and applying that to someone who is partly office-based
  -- would flag their office days as off-site.
  v_office := (coalesce(v_emp.staff_type, 'office') <> 'site');

  insert into hr.employee_profile (
    employee_id, office_team, roster, planned_days_per_week, works_sunday,
    track_location, home_site_id
  )
  values (p_employee_id, v_office, 'general', 6, false, false, p_home_site_id)
  on conflict (employee_id) do update
    set office_team  = excluded.office_team,
        -- never blank an existing pin just because the caller passed nothing
        home_site_id = coalesce(excluded.home_site_id, hr.employee_profile.home_site_id),
        updated_at   = now();

  if p_site_name is not null and btrim(p_site_name) <> '' then
    update public.employees
       set department = btrim(p_site_name), updated_at = now()
     where id = p_employee_id;

    -- finance.employees.site is only set when that row is first created, so an
    -- edit has to push the change across or imprest keeps the stale posting.
    select id into v_fin_id
      from finance.employees
     where (v_emp.auth_user_id is not null and auth_id = v_emp.auth_user_id)
        or lower(email) = lower(v_emp.email)
     order by (auth_id = v_emp.auth_user_id) desc
     limit 1;

    if v_fin_id is not null then
      update finance.employees
         set site = btrim(p_site_name), updated_at = now()
       where id = v_fin_id;
    end if;
  end if;
end;
$$;

grant execute on function public.provision_employee_attendance(uuid, text, uuid) to authenticated, service_role;
