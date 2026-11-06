alter table public.agendamentos
  add column if not exists tipo_personalizado text;

create table if not exists public.tipos_agendamento (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 60),
  tipo_base text check (tipo_base is null or tipo_base in ('compromisso', 'medico', 'tarefa')),
  created_at timestamptz not null default now(),
  unique (user_id, nome)
);

alter table public.tipos_agendamento add column if not exists tipo_base text;
alter table public.tipos_agendamento drop constraint if exists tipos_agendamento_tipo_base_check;
alter table public.tipos_agendamento
  add constraint tipos_agendamento_tipo_base_check
  check (tipo_base is null or tipo_base in ('compromisso', 'medico', 'tarefa'));

create index if not exists tipos_agendamento_user_nome_idx
  on public.tipos_agendamento(user_id, nome);
create unique index if not exists tipos_agendamento_user_tipo_base_idx
  on public.tipos_agendamento(user_id, tipo_base)
  where tipo_base is not null;

alter table public.tipos_agendamento enable row level security;

drop policy if exists "Usuário gerencia seus tipos de agendamento" on public.tipos_agendamento;
create policy "Usuário gerencia seus tipos de agendamento" on public.tipos_agendamento
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
