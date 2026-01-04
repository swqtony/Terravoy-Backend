alter table device_tokens
  drop constraint if exists device_tokens_pkey;

alter table device_tokens
  drop column if exists id;

alter table device_tokens
  alter column user_id set not null,
  alter column platform set not null,
  alter column token set not null;

alter table device_tokens
  drop constraint if exists device_tokens_platform_check;

alter table device_tokens
  add constraint device_tokens_platform_check check (platform in ('android'));

drop index if exists device_tokens_user_platform_idx;
drop index if exists device_tokens_platform_token_idx;

delete from device_tokens a
using device_tokens b
where a.platform = b.platform
  and a.token = b.token
  and a.ctid < b.ctid;

create unique index if not exists device_tokens_platform_token_idx
  on device_tokens (platform, token);
