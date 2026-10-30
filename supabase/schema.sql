create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 200),
  data date not null,
  hora_inicio time,
  hora_fim time,
  descricao text not null default '',
  local text not null default '',
  categoria text not null default 'Trabalho',
  cor text not null default '#6858d8',
  tipo text not null default 'compromisso' check (tipo in ('compromisso', 'tarefa')),
  prioridade text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  cliente text not null default '',
  alerta_minutos integer check (alerta_minutos is null or alerta_minutos in (5, 10, 15, 30, 60, 1440)),
  recorrencia text not null default 'none' check (recorrencia in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  concluido boolean not null default false,
  alerta_enviado_em timestamptz,
  alerta_enviado_para date,
  adiado_ate timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agendamentos_horario_valido check (
    hora_inicio is null or hora_fim is null or hora_fim > hora_inicio
  )
);

alter table public.agendamentos add column if not exists tipo text not null default 'compromisso';
alter table public.agendamentos add column if not exists prioridade text not null default 'normal';
alter table public.agendamentos add column if not exists cliente text not null default '';
alter table public.agendamentos drop constraint if exists agendamentos_tipo_check;
alter table public.agendamentos add constraint agendamentos_tipo_check check (tipo in ('compromisso', 'tarefa'));
alter table public.agendamentos drop constraint if exists agendamentos_prioridade_check;
alter table public.agendamentos add constraint agendamentos_prioridade_check check (prioridade in ('baixa', 'normal', 'alta', 'urgente'));

create table if not exists public.observacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data date not null,
  anotacao text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, data)
);

create table if not exists public.contatos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 200),
  email text not null default '',
  empresa text not null default '',
  endereco text not null default '',
  aniversario date,
  observacoes text not null default '',
  favorito boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.telefones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contato_id uuid not null,
  numero text not null check (length(trim(numero)) between 1 and 40),
  rotulo text not null default 'celular' check (rotulo in ('celular', 'casa', 'trabalho')),
  created_at timestamptz not null default now(),
  foreign key (contato_id, user_id) references public.contatos(id, user_id) on delete cascade
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aniversario_alertas_enviados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contato_id uuid not null references public.contatos(id) on delete cascade,
  data date not null,
  enviado_em timestamptz not null default now(),
  unique (contato_id, data)
);

create index if not exists agendamentos_user_data_idx on public.agendamentos(user_id, data);
create index if not exists agendamentos_user_tarefas_idx on public.agendamentos(user_id, tipo, concluido, data);
create index if not exists agendamentos_alertas_idx on public.agendamentos(data, alerta_minutos) where concluido = false and alerta_minutos is not null;
create index if not exists observacoes_user_data_idx on public.observacoes(user_id, data);
create index if not exists contatos_user_nome_idx on public.contatos(user_id, nome);
create index if not exists telefones_user_contato_idx on public.telefones(user_id, contato_id);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.agendamentos enable row level security;
alter table public.observacoes enable row level security;
alter table public.contatos enable row level security;
alter table public.telefones enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.aniversario_alertas_enviados enable row level security;

drop policy if exists "Usuário gerencia seus agendamentos" on public.agendamentos;
create policy "Usuário gerencia seus agendamentos" on public.agendamentos
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Usuário gerencia suas observações" on public.observacoes;
create policy "Usuário gerencia suas observações" on public.observacoes
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Usuário gerencia seus contatos" on public.contatos;
create policy "Usuário gerencia seus contatos" on public.contatos
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Usuário gerencia seus telefones" on public.telefones;
create policy "Usuário gerencia seus telefones" on public.telefones
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Usuário gerencia suas inscrições push" on public.push_subscriptions;
create policy "Usuário gerencia suas inscrições push" on public.push_subscriptions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Usuário consulta seus alertas de aniversário" on public.aniversario_alertas_enviados;
create policy "Usuário consulta seus alertas de aniversário" on public.aniversario_alertas_enviados
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- A Edge Function roda com service role e só aceita o segredo CRON_SECRET.
-- Salve cron_secret e project_url no Supabase Vault antes de executar esta parte:
-- select vault.create_secret('https://SEU-PROJETO.supabase.co', 'project_url');
-- select vault.create_secret('SEGREDO_ALEATORIO_FORTE', 'cron_secret');
select cron.unschedule(jobid)
from cron.job
where jobname = 'minha-agenda-alertas'
  and exists (select 1 from cron.job where jobname = 'minha-agenda-alertas');

select cron.schedule(
  'minha-agenda-alertas',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
  $job$
);
