insert into admin_permissions (key, name)
values
  ('users.read', 'Read users'),
  ('users.write', 'Update user status'),
  ('admin_users.read', 'Read admin users'),
  ('admin_users.write', 'Update admin users')
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
  'users.read', 'users.write',
  'admin_users.read'
)
where r.key = 'ops'
on conflict do nothing;

-- CS permissions
insert into admin_role_permissions (role_id, permission_id)
select r.id, p.id
from admin_roles r
join admin_permissions p on p.key in (
  'users.read'
)
where r.key = 'cs'
on conflict do nothing;
