begin;

create extension if not exists pgcrypto;

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  status text not null default 'ativa' check (status in ('ativa', 'suspensa')),
  plano text not null default 'Padrão',
  vencimento date,
  created_at timestamptz not null default now()
);

create table if not exists public.membros (
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  papel text not null default 'usuario' check (papel in ('usuario', 'admin_empresa')),
  status text not null default 'ativo' check (status in ('ativo', 'bloqueado')),
  created_at timestamptz not null default now(),
  primary key (user_id, empresa_id)
);

create table if not exists public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  arquivo text not null,
  tipo text not null check (tipo in ('automatico', 'manual', 'pre_restauracao')),
  tamanho_bytes bigint not null default 0 check (tamanho_bytes >= 0),
  resumo jsonb not null default '{}'::jsonb,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.auditoria (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  empresa_id uuid references public.empresas(id) on delete set null,
  acao text not null,
  detalhes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.empresas (nome, status, plano)
values ('Avisnet System Informática LTDA', 'ativa', 'Padrão')
on conflict (nome) do nothing;

do $$
declare
  v_empresa_id uuid;
begin
  select id into strict v_empresa_id
  from public.empresas
  where nome = 'Avisnet System Informática LTDA';

  if not exists (select 1 from public.membros where empresa_id = v_empresa_id) then
    if (select count(*) from auth.users) <> 2 then
      raise exception 'Esperados exatamente 2 usuários em auth.users; encontrados %. Migração cancelada sem alterações.', (select count(*) from auth.users);
    end if;
  end if;
  if not exists (select 1 from auth.users where lower(email) = 'davi@avisnet.com.br') then
    raise exception 'O usuário davi@avisnet.com.br não existe em auth.users. Migração cancelada.';
  end if;
end
$$;

do $$
declare
  v_empresa_id uuid;
begin
  select id into strict v_empresa_id
  from public.empresas
  where nome = 'Avisnet System Informática LTDA';

  if not exists (select 1 from public.membros where empresa_id = v_empresa_id) then
    insert into public.membros (user_id, empresa_id, papel)
    select u.id, v_empresa_id,
           case when lower(u.email) = 'davi@avisnet.com.br' then 'admin_empresa' else 'usuario' end
    from auth.users u
    on conflict (user_id, empresa_id) do update
      set papel = excluded.papel;
  else
    insert into public.membros (user_id, empresa_id, papel)
    select id, v_empresa_id, 'admin_empresa'
    from auth.users
    where lower(email) = 'davi@avisnet.com.br'
    on conflict (user_id, empresa_id) do update
      set papel = 'admin_empresa';
  end if;

  insert into public.super_admins (user_id)
  select id from auth.users where lower(email) = 'davi@avisnet.com.br'
  on conflict (user_id) do nothing;
end
$$;

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

alter table public.agendamentos add column if not exists empresa_id uuid references public.empresas(id);
alter table public.categorias add column if not exists empresa_id uuid references public.empresas(id);
alter table public.tipos_agendamento add column if not exists empresa_id uuid references public.empresas(id);
alter table public.observacoes add column if not exists empresa_id uuid references public.empresas(id);
alter table public.contatos add column if not exists empresa_id uuid references public.empresas(id);
alter table public.telefones add column if not exists empresa_id uuid references public.empresas(id);
alter table public.push_subscriptions add column if not exists empresa_id uuid references public.empresas(id);
alter table public.aniversario_alertas_enviados add column if not exists empresa_id uuid references public.empresas(id);
alter table public.notas add column if not exists empresa_id uuid references public.empresas(id);

do $$
declare
  v_empresa_id uuid;
  v_table text;
  v_tables text[] := array[
    'agendamentos', 'categorias', 'tipos_agendamento', 'observacoes', 'contatos',
    'telefones', 'push_subscriptions', 'aniversario_alertas_enviados', 'notas'
  ];
begin
  select id into strict v_empresa_id
  from public.empresas
  where nome = 'Avisnet System Informática LTDA';

  foreach v_table in array v_tables loop
    execute format('update public.%I set empresa_id = $1 where empresa_id is null', v_table)
      using v_empresa_id;
    execute format('alter table public.%I alter column empresa_id set not null', v_table);
    execute format(
      'create index if not exists %I on public.%I (empresa_id)',
      v_table || '_empresa_id_idx',
      v_table
    );
    execute format('alter table public.%I drop constraint if exists %I', v_table, v_table || '_empresa_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (empresa_id) references public.empresas(id) on delete cascade',
      v_table,
      v_table || '_empresa_id_fkey'
    );
  end loop;
end
$$;

create unique index if not exists categorias_id_user_empresa_uidx
  on public.categorias (id, user_id, empresa_id);
create unique index if not exists categorias_id_empresa_uidx
  on public.categorias (id, empresa_id);
create unique index if not exists contatos_id_user_empresa_uidx
  on public.contatos (id, user_id, empresa_id);
create unique index if not exists contatos_id_empresa_uidx
  on public.contatos (id, empresa_id);

alter table public.tipos_agendamento add column if not exists tipo_base text;
alter table public.tipos_agendamento drop constraint if exists tipos_agendamento_tipo_base_check;
alter table public.tipos_agendamento
  add constraint tipos_agendamento_tipo_base_check
  check (tipo_base is null or tipo_base in ('compromisso', 'medico', 'tarefa'));

alter table public.categorias drop constraint if exists categorias_user_id_nome_key;
create unique index if not exists categorias_empresa_user_nome_uidx
  on public.categorias (empresa_id, user_id, nome);
alter table public.tipos_agendamento drop constraint if exists tipos_agendamento_user_id_nome_key;
create unique index if not exists tipos_agendamento_empresa_user_nome_uidx
  on public.tipos_agendamento (empresa_id, user_id, nome);
drop index if exists public.tipos_agendamento_user_tipo_base_idx;
drop index if exists public.tipos_agendamento_empresa_user_tipo_base_uidx;
create unique index tipos_agendamento_empresa_user_tipo_base_uidx
  on public.tipos_agendamento (empresa_id, user_id, tipo_base)
  where tipo_base is not null;
alter table public.observacoes drop constraint if exists observacoes_user_id_data_key;
create unique index if not exists observacoes_empresa_user_data_uidx
  on public.observacoes (empresa_id, user_id, data);

alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_key;
create unique index if not exists push_subscriptions_endpoint_empresa_uidx
  on public.push_subscriptions (endpoint, empresa_id);

alter table public.agendamentos drop constraint if exists agendamentos_categoria_id_user_id_fkey;
alter table public.agendamentos drop constraint if exists agendamentos_categoria_empresa_fkey;
alter table public.agendamentos
  add constraint agendamentos_categoria_empresa_fkey
  foreign key (categoria_id, empresa_id)
  references public.categorias(id, empresa_id)
  on delete set null (categoria_id);

alter table public.telefones drop constraint if exists telefones_contato_id_user_id_fkey;
alter table public.telefones drop constraint if exists telefones_contato_empresa_fkey;
alter table public.telefones
  drop constraint if exists telefones_contato_empresa_fkey;
alter table public.telefones
  add constraint telefones_contato_empresa_fkey
  foreign key (contato_id, empresa_id)
  references public.contatos(id, empresa_id)
  on delete cascade;

alter table public.aniversario_alertas_enviados
  drop constraint if exists aniversario_alertas_enviados_contato_id_fkey;
alter table public.aniversario_alertas_enviados
  drop constraint if exists aniversario_alertas_contato_empresa_fkey;
alter table public.aniversario_alertas_enviados
  add constraint aniversario_alertas_contato_empresa_fkey
  foreign key (contato_id, empresa_id)
  references public.contatos(id, empresa_id)
  on delete cascade;

create index if not exists backups_empresa_created_idx on public.backups (empresa_id, created_at desc);
create index if not exists auditoria_empresa_created_idx on public.auditoria (empresa_id, created_at desc);
create index if not exists membros_empresa_status_idx on public.membros (empresa_id, status);

create or replace function public.minhas_empresas()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.empresa_id
  from public.membros m
  where m.user_id = (select auth.uid())
    and m.status = 'ativo'
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.super_admins s
    where s.user_id = (select auth.uid())
  )
$$;

create or replace function public.admin_restaurar_empresa(
  p_empresa_id uuid,
  p_actor uuid,
  p_tabelas jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_rows jsonb;
  v_tables text[] := array[
    'contatos', 'categorias', 'tipos_agendamento', 'agendamentos', 'telefones',
    'observacoes', 'notas', 'push_subscriptions', 'aniversario_alertas_enviados'
  ];
begin
  if not exists (select 1 from public.super_admins where user_id = p_actor) then
    raise exception 'Acesso não autorizado.';
  end if;
  if not exists (select 1 from public.empresas where id = p_empresa_id) then
    raise exception 'Empresa não encontrada.';
  end if;
  if jsonb_typeof(p_tabelas) <> 'object' then
    raise exception 'Formato de backup inválido.';
  end if;

  foreach v_table in array v_tables loop
    v_rows := p_tabelas -> v_table;
    if jsonb_typeof(v_rows) <> 'array' then
      raise exception 'Backup inválido: a tabela % deve ser uma lista.', v_table;
    end if;
  end loop;

  delete from public.aniversario_alertas_enviados where empresa_id = p_empresa_id;
  delete from public.telefones where empresa_id = p_empresa_id;
  delete from public.agendamentos where empresa_id = p_empresa_id;
  delete from public.observacoes where empresa_id = p_empresa_id;
  delete from public.notas where empresa_id = p_empresa_id;
  delete from public.push_subscriptions where empresa_id = p_empresa_id;
  delete from public.categorias where empresa_id = p_empresa_id;
  delete from public.tipos_agendamento where empresa_id = p_empresa_id;
  delete from public.contatos where empresa_id = p_empresa_id;

  foreach v_table in array v_tables loop
    select coalesce(
      jsonb_agg(jsonb_set(row_value, '{empresa_id}', to_jsonb(p_empresa_id), true)),
      '[]'::jsonb
    )
    into v_rows
    from jsonb_array_elements(p_tabelas -> v_table) as rows(row_value);

    execute format(
      'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)',
      v_table,
      v_table
    ) using v_rows;
  end loop;

  insert into public.auditoria (user_id, empresa_id, acao, detalhes)
  values (p_actor, p_empresa_id, 'backup.restaurado', jsonb_build_object('tabelas', v_tables));
end
$$;

create or replace function public.impedir_mudanca_dono_ou_empresa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.empresa_id is distinct from old.empresa_id
     or new.user_id is distinct from old.user_id then
    raise exception 'Não é permitido transferir registros entre empresas ou usuários.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function public.minhas_empresas() from public;
revoke all on function public.is_super_admin() from public;
grant execute on function public.minhas_empresas() to authenticated, service_role;
grant execute on function public.is_super_admin() to authenticated, service_role;
revoke all on function public.admin_restaurar_empresa(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_restaurar_empresa(uuid, uuid, jsonb) to service_role;
revoke all on function public.impedir_mudanca_dono_ou_empresa() from public, anon, authenticated;

alter table public.empresas enable row level security;
alter table public.membros enable row level security;
alter table public.super_admins enable row level security;
alter table public.backups enable row level security;
alter table public.auditoria enable row level security;

grant select on public.empresas, public.membros, public.super_admins to authenticated;
grant all on public.empresas, public.membros, public.super_admins, public.backups, public.auditoria to service_role;
grant select, insert, update, delete on
  public.agendamentos, public.categorias, public.tipos_agendamento, public.observacoes,
  public.contatos, public.telefones, public.push_subscriptions,
  public.aniversario_alertas_enviados, public.notas
to authenticated;
grant all on
  public.agendamentos, public.categorias, public.tipos_agendamento, public.observacoes,
  public.contatos, public.telefones, public.push_subscriptions,
  public.aniversario_alertas_enviados, public.notas
to service_role;

do $$
declare
  v_table text;
  v_policy record;
  v_tables text[] := array[
    'agendamentos', 'categorias', 'tipos_agendamento', 'observacoes', 'contatos',
    'telefones', 'push_subscriptions', 'aniversario_alertas_enviados', 'notas',
    'empresas', 'membros', 'super_admins', 'backups', 'auditoria'
  ];
begin
  foreach v_table in array v_tables loop
    for v_policy in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
end
$$;

create policy "Membros consultam suas empresas" on public.empresas
  for select to authenticated
  using (id in (select public.minhas_empresas()));

create policy "Usuários consultam seus vínculos" on public.membros
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Super admins consultam seu próprio vínculo" on public.super_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

do $$
declare
  v_table text;
  v_tables text[] := array[
    'agendamentos', 'categorias', 'tipos_agendamento', 'observacoes', 'contatos',
    'telefones', 'push_subscriptions', 'aniversario_alertas_enviados', 'notas'
  ];
begin
  foreach v_table in array v_tables loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_empresa_owner_immutable', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.impedir_mudanca_dono_ou_empresa()',
      v_table || '_empresa_owner_immutable', v_table
    );

    if v_table = 'push_subscriptions' then
      execute format(
        'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()) and empresa_id in (select public.minhas_empresas()))',
        v_table || '_empresa_select', v_table
      );
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()) and empresa_id in (select public.minhas_empresas()) and exists (select 1 from public.empresas e where e.id = empresa_id and e.status = ''ativa''))',
        v_table || '_empresa_insert', v_table
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid()) and empresa_id in (select public.minhas_empresas()) and exists (select 1 from public.empresas e where e.id = empresa_id and e.status = ''ativa'')) with check (user_id = (select auth.uid()) and empresa_id in (select public.minhas_empresas()) and exists (select 1 from public.empresas e where e.id = empresa_id and e.status = ''ativa''))',
        v_table || '_empresa_update', v_table
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()) and empresa_id in (select public.minhas_empresas()) and exists (select 1 from public.empresas e where e.id = empresa_id and e.status = ''ativa''))',
        v_table || '_empresa_delete', v_table
      );
    else
      execute format(
        'create policy %I on public.%I for select to authenticated using (empresa_id in (select public.minhas_empresas()))',
        v_table || '_empresa_select', v_table
      );
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()) and empresa_id in (select public.minhas_empresas()) and exists (select 1 from public.empresas e where e.id = empresa_id and e.status = ''ativa''))',
        v_table || '_empresa_insert', v_table
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (empresa_id in (select public.minhas_empresas()) and exists (select 1 from public.empresas e where e.id = empresa_id and e.status = ''ativa'')) with check (empresa_id in (select public.minhas_empresas()) and exists (select 1 from public.empresas e where e.id = empresa_id and e.status = ''ativa''))',
        v_table || '_empresa_update', v_table
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (empresa_id in (select public.minhas_empresas()) and exists (select 1 from public.empresas e where e.id = empresa_id and e.status = ''ativa''))',
        v_table || '_empresa_delete', v_table
      );
    end if;
  end loop;
end
$$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('empresa-backups', 'empresa-backups', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

notify pgrst, 'reload schema';
commit;
