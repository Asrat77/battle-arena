-- Generic versioned key/value table; the Store moves onto it in a later stage.
create table if not exists kv (
  key        text primary key,
  value      jsonb not null,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);
