-- ════════════════════════════════════════════════════════════════════
-- Delegation V2 — Department Task-Type Catalog (full)
-- Per SPEC-DELEGATION-TASK-TYPE-CATALOG-AND-MOBILE.md
-- ════════════════════════════════════════════════════════════════════

-- 1) scored_by column: agent (AI proposes) | external (CPS/Finance owns points)
ALTER TABLE public.del_task_types
  ADD COLUMN IF NOT EXISTS scored_by TEXT NOT NULL DEFAULT 'agent'
  CHECK (scored_by IN ('agent','external'));

-- 2) New roles for dormant departments (design / ea / sales / crm)
INSERT INTO public.roles (id, label, default_modules) VALUES
  ('design',  'Design',              ARRAY['attendance']::text[]),
  ('ea',      'Executive Assistant', ARRAY['attendance']::text[]),
  ('sales',   'Sales',               ARRAY['attendance']::text[]),
  ('crm',     'CRM',                 ARRAY['attendance']::text[])
ON CONFLICT (id) DO NOTHING;

-- 3) Catalog seed (idempotent via ON CONFLICT(code) DO NOTHING)
INSERT INTO public.del_task_types (code, label, role_group, effort_tier, daily_cap, active, scored_by) VALUES
  -- Sales
  ('sales_lead_capture',     'Lead capture',        'sales', 'S', null, true, 'agent'),
  ('sales_meeting_physical', 'Physical meeting',    'sales', 'M', null, true, 'agent'),
  ('sales_meeting_online',   'Online meeting',      'sales', 'S', null, true, 'agent'),
  ('sales_documentation',    'Documentation',       'sales', 'S', null, true, 'agent'),
  -- Design
  ('design_2d_layout',     'Layout planning (2D)',       'design', 'L',  null, true, 'agent'),
  ('design_boq_prep',      'BOQ preparation',            'design', 'XL', null, true, 'agent'),
  ('design_ppt_concept',   'PPT (concept)',              'design', 'M',  null, true, 'agent'),
  ('design_moodboard',     'Moodboard',                  'design', 'M',  null, true, 'agent'),
  ('design_ppt_3d_render', 'PPT (3D render)',            'design', 'M',  null, true, 'agent'),
  ('design_3d_render_prep','3D render preparation',      'design', 'L',  null, true, 'agent'),
  ('design_material_final','Material finalisation',      'design', 'M',  null, true, 'agent'),
  ('design_budget_sheet',  'Budget sheet preparation',   'design', 'L',  null, true, 'agent'),
  ('design_client_coord',  'Client coordination',        'design', 'S',  null, true, 'agent'),
  ('design_site_coord',    'Site coordination',          'design', 'S',  null, true, 'agent'),
  ('design_vendor_coord',  'Vendor coordination',        'design', 'S',  null, true, 'agent'),
  ('design_revision',      'Revision of PPT / designs',  'design', 'M',  null, true, 'agent'),
  -- HR
  ('hr_interview_schedule','Interview scheduling',  'hr', 'S', null, true, 'agent'),
  ('hr_onboarding',        'Onboarding',            'hr', 'M', null, true, 'agent'),
  ('hr_documentation',     'Documentation',         'hr', 'S', null, true, 'agent'),
  ('hr_hiring',            'Hiring',                'hr', 'L', null, true, 'agent'),
  ('hr_attendance_mgmt',   'Attendance management', 'hr', 'S', null, true, 'agent'),
  ('hr_daily_task',        'Daily task',            'hr', 'S', null, true, 'agent'),
  -- CRM
  ('crm_snag_mgmt',    'Snag management',             'crm', 'M', null, true, 'agent'),
  ('crm_client_coord', 'Client coordination',         'crm', 'S', null, true, 'agent'),
  ('crm_purchase',     'Purchase',                    'crm', 'M', null, true, 'external'),
  ('crm_site_payment', 'Payment from sites directly', 'crm', 'M', null, true, 'external'),
  -- EA
  ('ea_multi_task',              'Multiple task',                             'ea', 'S', null, true, 'agent'),
  ('ea_team_coord',              'Team coordination',                         'ea', 'S', null, true, 'agent'),
  ('ea_documentation',           'Documentation',                             'ea', 'S', null, true, 'agent'),
  ('ea_founder_director_issues', 'Founder & Director daily issue management', 'ea', 'M', null, true, 'agent'),
  ('ea_ticket_booking_hr',       'Tickets booking help to HR',                'ea', 'S', null, true, 'agent'),
  ('ea_other',                   'Other',                                     'ea', 'S', null, true, 'agent'),
  -- Finance (add to existing Phase-1)
  ('fin_bank_update',             'Bank update',                  'finance', 'S', null, true, 'agent'),
  ('fin_bill_update',             'Bill update',                  'finance', 'S', null, true, 'agent'),
  ('fin_client_payment_followup', 'Payment follow-up from client','finance', 'M', null, true, 'agent'),
  ('fin_gst_ims_weekly',          'Weekly GST / IMS portal',      'finance', 'M', null, true, 'agent'),
  ('fin_invoice_check',           'Invoice checking',             'finance', 'S', null, true, 'external'),
  ('fin_vendor_payment',          'Payment to vendor',            'finance', 'M', null, true, 'external'),
  ('fin_compliance_legal',        'Compliance / legal work',      'finance', 'L', null, true, 'agent'),
  -- Procurement (add to existing Phase-1)
  ('proc_site_coord',       'Site team coordination',                     'procurement', 'S', null, true, 'agent'),
  ('proc_quote_followup',   'Quotation follow-up (different vendors)',    'procurement', 'M', null, true, 'agent'),
  ('proc_material_closure', 'Material closure with best comparison rates','procurement', 'L', null, true, 'external'),
  ('proc_payments',         'Payments',                                   'procurement', 'M', null, true, 'external'),
  -- Site Engineer (add to existing Phase-1)
  ('site_day_to_day', 'Day-to-day problem', 'site_engineer', 'S', null, true, 'agent'),
  ('site_other',      'Other',              'site_engineer', 'S', null, true, 'agent')
ON CONFLICT (code) DO NOTHING;
