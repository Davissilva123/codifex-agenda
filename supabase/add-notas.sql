-- Tabela de notas livres / caderno de anotações
create table if not exists public.notas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null default '',
  conteudo text not null default '',
  cor text not null default '#6858d8',
  fixada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notas_user_idx on public.notas(user_id, fixada desc, updated_at desc);

alter table public.notas enable row level security;

drop policy if exists "Usuário gerencia suas notas" on public.notas;
create policy "Usuário gerencia suas notas" on public.notas
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Recarregar cache do PostgREST
notify pgrst, 'reload schema';
