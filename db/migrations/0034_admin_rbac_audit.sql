-- RBAC tables
create table if not exists admin_roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists admin_permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists admin_user_roles (
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  role_id uuid not null references admin_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (admin_user_id, role_id)
);

create table if not exists admin_role_permissions (
  role_id uuid not null references admin_roles(id) on delete cascade,
  permission_id uuid not null references admin_permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

-- Audit logs
create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references admin_users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  before_json jsonb,
  after_json jsonb,
  reason text not null,
  ip text,
  ua text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_admin_user_id on admin_audit_logs(admin_user_id);
create index if not exists idx_admin_audit_logs_action on admin_audit_logs(action);
create index if not exists idx_admin_audit_logs_resource on admin_audit_logs(resource_type, resource_id);
create index if not exists idx_admin_audit_logs_created_at on admin_audit_logs(created_at);

-- Reports admin fields
alter table reports add column if not exists resolution text;
alter table reports add column if not exists handling_note text;
alter table reports add column if not exists updated_at timestamptz;

-- Seed roles
insert into admin_roles (key, name)
values
  ('super_admin', 'Super Admin'),
  ('ops', 'Operations'),
  ('cs', 'Customer Support')
on conflict (key) do nothing;

-- Seed permissions
insert into admin_permissions (key, name)
values
  ('reports.read', 'Read reports'),
  ('reports.write', 'Update reports'),
  ('media.read_private', 'Read private media'),
  ('audit.read', 'Read audit logs')
on conflict (key) do nothing;

-- Map permissions to roles
insert into admin_role_permissions (role_id, permission_id)
select r.id, p.id
from admin_roles r
join admin_permissions p on p.key in ('reports.read', 'reports.write', 'media.read_private', 'audit.read')
where r.key = 'super_admin'
on conflict do nothing;

insert into admin_role_permissions (role_id, permission_id)
select r.id, p.id
from admin_roles r
join admin_permissions p on p.key in ('reports.read', 'reports.write')
where r.key = 'ops'
on conflict do nothing;

insert into admin_role_permissions (role_id, permission_id)
select r.id, p.id
from admin_roles r
join admin_permissions p on p.key in ('reports.read')
where r.key = 'cs'
on conflict do nothing;

-- Bind default admin email to super_admin if exists
insert into admin_user_roles (admin_user_id, role_id)
select u.id, r.id
from admin_users u
join admin_roles r on r.key = 'super_admin'
where u.email = 'admin@example.com'
on conflict do nothing;
