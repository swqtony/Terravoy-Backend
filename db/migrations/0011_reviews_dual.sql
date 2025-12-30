begin;

alter table reviews
  add column if not exists from_role text,
  add column if not exists to_role text;

update reviews r
set from_role = case when r.from_user_id = o.traveler_id then 'TRAVELER' else 'HOST' end,
    to_role = case when r.from_user_id = o.traveler_id then 'HOST' else 'TRAVELER' end
from orders o
where r.order_id = o.id
  and (r.from_role is null or r.to_role is null);

alter table reviews
  alter column from_role set default 'TRAVELER';

alter table reviews
  alter column from_role set not null;

alter table reviews
  drop constraint if exists reviews_order_id_unique;

create unique index if not exists reviews_order_from_user_unique
  on reviews(order_id, from_user_id);

create index if not exists reviews_order_from_role_idx
  on reviews(order_id, from_role);

commit;
