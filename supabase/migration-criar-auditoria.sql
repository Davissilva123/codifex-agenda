-- ==============================================================================
-- Migração para liberar e ativar a Auditoria no Supabase
-- Execute este script no SQL Editor do painel do seu Supabase
-- Link: https://supabase.com/dashboard/project/rokyburvnyeqhdjsiqbm/sql
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  acao text NOT NULL,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índices para buscas rápidas
CREATE INDEX IF NOT EXISTS auditoria_created_at_idx ON public.auditoria (created_at DESC);
CREATE INDEX IF NOT EXISTS auditoria_empresa_idx ON public.auditoria (empresa_id);
CREATE INDEX IF NOT EXISTS auditoria_acao_idx ON public.auditoria (acao);

-- Desativa RLS para permitir que o servidor da agenda grave os logs de auditoria
ALTER TABLE public.auditoria DISABLE ROW LEVEL SECURITY;

-- Garante todas as permissões para o sistema
GRANT ALL ON public.auditoria TO anon, authenticated, service_role;

-- Insere o registro de confirmação para verificar que funcionou
INSERT INTO public.auditoria (acao, detalhes)
VALUES ('sistema.inicializado', '{"mensagem": "Auditoria ativada com sucesso."}'::jsonb);
