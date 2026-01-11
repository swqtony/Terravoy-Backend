begin;

create index if not exists orders_experience_id_idx
  on orders (experience_id);

create index if not exists reviews_created_at_id_idx
  on reviews (created_at desc, id desc);

commit;
