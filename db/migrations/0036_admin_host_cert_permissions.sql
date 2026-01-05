insert into admin_permissions (key, name)
values
  ('host_certification.read', 'Read host certifications'),
  ('host_certification.write', 'Review host certifications')
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
  'host_certification.read', 'host_certification.write'
)
where r.key = 'ops'
on conflict do nothing;

-- CS permissions (read only)
insert into admin_role_permissions (role_id, permission_id)
select r.id, p.id
from admin_roles r
join admin_permissions p on p.key in ('host_certification.read')
where r.key = 'cs'
on conflict do nothing;
