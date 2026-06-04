-- del_task_types is a reference table: all authenticated employees must read it.
-- Without a SELECT policy, RLS silently returns empty rows for all reads.
CREATE POLICY "del_task_types_authenticated_read"
  ON public.del_task_types FOR SELECT
  USING (auth.uid() IS NOT NULL);

INSERT INTO public.del_task_types (code, label, role_group, effort_tier, daily_cap, active)
VALUES
  ('it_system_build',  'System / feature built and deployed', 'ai', 'L', null, true),
  ('it_automation',    'Workflow / automation built',          'ai', 'M', null, true),
  ('it_integration',   'System integration completed',        'ai', 'M', null, true),
  ('it_bugfix',        'Bug fixed / issue resolved',          'ai', 'S', null, true),
  ('it_report',        'Technical report / documentation',   'ai', 'S', null, true),
  ('it_dashboard',     'Dashboard / UI built or updated',    'ai', 'M', null, true),
  ('it_db_migration',  'Database migration / schema change', 'ai', 'M', null, true),
  ('it_config_deploy', 'Config / deployment / infra change', 'ai', 'S', null, true)
ON CONFLICT (code) DO NOTHING;
