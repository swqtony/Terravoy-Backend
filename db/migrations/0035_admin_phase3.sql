-- Phase 3 RBAC permissions
insert into admin_permissions (key, name)
values
  ('posts.read', 'Read posts'),
  ('posts.write', 'Update posts'),
  ('experiences.read', 'Read experiences'),
  ('experiences.write', 'Update experiences'),
  ('orders.read', 'Read orders'),
  ('orders.write', 'Update orders')
on conflict (key) do nothing;

-- Super admin gets all permissions
insert into admin_role_permissions (role_id, permission_id)
select r.id, p.id
from admin_roles r
join admin_permissions p on true
where r.key = 'super_admin'
on conflict do nothing;

-- Ops permissions
insert into admin_role_permissions (role_id, permission_id)
select r.id, p.id
from admin_roles r
join admin_permissions p on p.key in (
  'posts.read', 'posts.write',
  'experiences.read', 'experiences.write',
  'reports.read', 'reports.write',
  'media.read_private',
  'audit.read'
)
where r.key = 'ops'
on conflict do nothing;

-- CS permissions
insert into admin_role_permissions (role_id, permission_id)
select r.id, p.id
from admin_roles r
join admin_permissions p on p.key in (
  'orders.read', 'orders.write',
  'reports.read',
  'audit.read'
)
where r.key = 'cs'
on conflict do nothing;

-- Admin fields for moderation/support
alter table discover_posts add column if not exists admin_note text;

alter table experiences add column if not exists admin_note text;

alter table orders add column if not exists dispute_status text not null default 'none';
alter table orders add column if not exists cs_note text;
