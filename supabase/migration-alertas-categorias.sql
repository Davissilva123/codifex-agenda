create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 60),
  cor text not null default '#6858d8' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  unique (user_id, nome),
  unique (id, user_id)
);

alter table public.agendamentos
  add column if not exists alertas jsonb not null default '[]'::jsonb,
  add column if not exists atrasado_notificado_em timestamptz,
  add column if not exists categoria_id uuid;

alter table public.agendamentos drop constraint if exists agendamentos_alerta_minutos_check;
alter table public.agendamentos add constraint agendamentos_alerta_minutos_check
  check (alerta_minutos is null or alerta_minutos in (0, 5, 10, 15, 30, 60, 120, 1440));
alter table public.agendamentos alter column categoria set default 'Normal';
alter table public.agendamentos alter column cor set default '#3676c8';

update public.agendamentos
set alertas = jsonb_build_array(jsonb_build_object(
  'minutos', alerta_minutos,
  'disparado_em', alerta_enviado_em,
  'disparado_para', alerta_enviado_para,
  'adiado_ate', adiado_ate
))
where alerta_minutos is not null
  and (alertas is null or alertas = '[]'::jsonb);

insert into public.categorias (user_id, nome, cor)
select distinct a.user_id, trim(a.categoria),
  case
    when lower(trim(a.categoria)) in ('médico', 'saúde') then '#e2537d'
    when lower(trim(a.categoria)) in ('normal', 'trabalho') then '#3676c8'
    else coalesce(nullif(a.cor, ''), '#6858d8')
  end
from public.agendamentos a
where trim(a.categoria) <> ''
on conflict (user_id, nome) do nothing;

insert into public.categorias (user_id, nome, cor)
select u.id, defaults.nome, defaults.cor
from auth.users u
cross join (values ('Normal', '#3676c8'), ('Médico', '#e2537d')) as defaults(nome, cor)
on conflict (user_id, nome) do nothing;

update public.agendamentos a
set categoria_id = c.id
from public.categorias c
where c.user_id = a.user_id
  and c.nome = trim(a.categoria)
  and a.categoria_id is null;

alter table public.agendamentos
  drop constraint if exists agendamentos_categoria_id_user_id_fkey;
alter table public.agendamentos
  add constraint agendamentos_categoria_id_user_id_fkey
  foreign key (categoria_id, user_id)
  references public.categorias(id, user_id)
  on delete set null (categoria_id);

create index if not exists categorias_user_nome_idx on public.categorias(user_id, nome);
create index if not exists agendamentos_categoria_idx on public.agendamentos(user_id, categoria_id);

alter table public.categorias enable row level security;
drop policy if exists "Usuário gerencia suas categorias" on public.categorias;
create policy "Usuário gerencia suas categorias" on public.categorias
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
