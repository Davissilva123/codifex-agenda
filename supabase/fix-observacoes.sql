create extension if not exists pgcrypto;

create table if not exists public.observacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data date not null,
  anotacao text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, data)
);

create index if not exists observacoes_user_data_idx
  on public.observacoes(user_id, data);

alter table public.observacoes enable row level security;

drop policy if exists "Usuário gerencia suas observações" on public.observacoes;
create policy "Usuário gerencia suas observações" on public.observacoes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.observacoes to authenticated;

notify pgrst, 'reload schema';
