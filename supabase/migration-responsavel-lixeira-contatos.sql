alter table public.agendamentos
  add column if not exists responsavel text not null default '';

alter table public.contatos
  add column if not exists deleted_at timestamptz;

alter table public.agendamentos drop constraint if exists agendamentos_alerta_minutos_check;
alter table public.agendamentos add constraint agendamentos_alerta_minutos_check
  check (alerta_minutos is null or alerta_minutos in (5, 10, 15, 30, 60, 120, 1440));
