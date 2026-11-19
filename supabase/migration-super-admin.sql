-- ==========================================================
--  MIGRAÇÃO: SUPER ADMIN, EMPRESAS, MEMBROS E BACKUPS
-- ==========================================================

-- 1. TABELA SUPER_ADMINS
CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_ve_proprio" ON public.super_admins;
CREATE POLICY "super_admin_ve_proprio" ON public.super_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "service_role_super_admins_all" ON public.super_admins;
CREATE POLICY "service_role_super_admins_all" ON public.super_admins
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. FUNÇÃO DE CHECAGEM DE SUPER ADMIN
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins
    WHERE user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

-- 3. VÍNCULO AUTOMÁTICO DO DAVI COMO SUPER ADMIN
INSERT INTO public.super_admins (user_id)
SELECT id FROM auth.users WHERE LOWER(email) = 'davi@avisnet.com.br'
ON CONFLICT (user_id) DO NOTHING;

-- 4. FUNÇÕES SEGURAS PARA LISTAR E VINCULAR MEMBROS COM E-MAIL REAL (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.listar_membros_empresa(p_empresa_id uuid)
RETURNS TABLE (
  user_id uuid,
  email text,
  papel text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT 
    m.user_id,
    COALESCE(u.email, 'Email não encontrado')::text AS email,
    m.papel,
    m.status,
    m.created_at
  FROM public.membros m
  LEFT JOIN auth.users u ON u.id = m.user_id
  WHERE m.empresa_id = p_empresa_id
  ORDER BY m.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.listar_membros_empresa(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.vincular_membro_por_email(
  p_empresa_id uuid,
  p_email text,
  p_papel text DEFAULT 'usuario'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE LOWER(email) = LOWER(TRIM(p_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Nenhum usuário cadastrado com o e-mail informado. O usuário deve criar a conta no app primeiro.'
    );
  END IF;

  IF EXISTS (SELECT 1 FROM public.membros WHERE empresa_id = p_empresa_id AND user_id = v_user_id AND status = 'ativo') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Esse e-mail já é membro desta empresa.'
    );
  END IF;

  INSERT INTO public.membros (empresa_id, user_id, papel, status)
  VALUES (p_empresa_id, v_user_id, p_papel, 'ativo')
  ON CONFLICT (user_id, empresa_id) DO UPDATE
  SET papel = EXCLUDED.papel, status = 'ativo';

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.vincular_membro_por_email(uuid, text, text) TO authenticated, service_role;

-- 5. POLÍTICAS RLS PARA A TABELA EMPRESAS
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_empresas_all" ON public.empresas;
CREATE POLICY "service_role_empresas_all" ON public.empresas
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "super_admin_empresas_all" ON public.empresas;
CREATE POLICY "super_admin_empresas_all" ON public.empresas
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Membros consultam suas empresas" ON public.empresas;
CREATE POLICY "Membros consultam suas empresas" ON public.empresas
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR id IN (SELECT empresa_id FROM public.membros WHERE user_id = auth.uid() AND status = 'ativo')
  );

-- 6. POLÍTICAS RLS PARA A TABELA MEMBROS
ALTER TABLE public.membros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_membros_all" ON public.membros;
CREATE POLICY "service_role_membros_all" ON public.membros
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "super_admin_membros_all" ON public.membros;
CREATE POLICY "super_admin_membros_all" ON public.membros
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Usuários consultam seus vínculos" ON public.membros;
CREATE POLICY "Usuários consultam seus vínculos" ON public.membros
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR user_id = auth.uid()
  );

-- 7. TABELA E POLÍTICAS DE BACKUPS
CREATE TABLE IF NOT EXISTS public.backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  arquivo text NOT NULL,
  tipo text NOT NULL CHECK (tipo in ('automatico', 'manual', 'pre_restauracao')),
  tamanho_bytes bigint NOT NULL DEFAULT 0,
  resumo jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_backups_all" ON public.backups;
CREATE POLICY "service_role_backups_all" ON public.backups
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "super_admin_backups_all" ON public.backups;
CREATE POLICY "super_admin_backups_all" ON public.backups
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 8. BUCKET DE BACKUPS E POLÍTICAS DE STORAGE
INSERT INTO storage.buckets (id, name, public)
VALUES ('empresa-backups', 'empresa-backups', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "super_admin_storage_insert" ON storage.objects;
CREATE POLICY "super_admin_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'empresa-backups' AND public.is_super_admin());

DROP POLICY IF EXISTS "super_admin_storage_select" ON storage.objects;
CREATE POLICY "super_admin_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'empresa-backups' AND public.is_super_admin());

DROP POLICY IF EXISTS "service_role_storage_all" ON storage.objects;
CREATE POLICY "service_role_storage_all" ON storage.objects
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 9. VALIDAÇÕES E CONSTRAINTS DE REGRAS DE NEGÓCIO
ALTER TABLE public.empresas
  DROP CONSTRAINT IF EXISTS chk_empresa_nome_min;
ALTER TABLE public.empresas
  ADD CONSTRAINT chk_empresa_nome_min CHECK (length(trim(nome)) >= 3);

CREATE UNIQUE INDEX IF NOT EXISTS idx_empresas_nome_lower
  ON public.empresas (lower(trim(nome)));

-- 10. FUNÇÃO COM PRIVILÉGIOS DE SEGURANÇA PARA EXCLUSÃO DEFINITIVA DE EMPRESA
CREATE OR REPLACE FUNCTION public.excluir_empresa_admin(p_empresa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_nome text;
BEGIN
  SELECT nome INTO v_nome FROM public.empresas WHERE id = p_empresa_id;
  IF v_nome IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Empresa não encontrada.');
  END IF;

  -- Remove dependências em cascata com privilégio de administrador
  DELETE FROM public.membros_empresa WHERE empresa_id = p_empresa_id;
  DELETE FROM public.membros WHERE empresa_id = p_empresa_id;
  DELETE FROM public.backups WHERE empresa_id = p_empresa_id;
  DELETE FROM public.auditoria WHERE empresa_id = p_empresa_id;
  DELETE FROM public.agendamentos WHERE empresa_id = p_empresa_id;
  DELETE FROM public.categorias WHERE empresa_id = p_empresa_id;
  DELETE FROM public.tipos_agendamento WHERE empresa_id = p_empresa_id;
  DELETE FROM public.observacoes WHERE empresa_id = p_empresa_id;
  DELETE FROM public.contatos WHERE empresa_id = p_empresa_id;
  DELETE FROM public.telefones WHERE empresa_id = p_empresa_id;
  DELETE FROM public.push_subscriptions WHERE empresa_id = p_empresa_id;
  DELETE FROM public.aniversario_alertas_enviados WHERE empresa_id = p_empresa_id;
  DELETE FROM public.notas WHERE empresa_id = p_empresa_id;

  -- Remove a empresa
  DELETE FROM public.empresas WHERE id = p_empresa_id;

  RETURN jsonb_build_object('success', true, 'message', 'Empresa excluída com sucesso.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_empresa_admin(uuid) TO authenticated, service_role, anon;

-- 11. POLÍTICAS RLS DE EXCLUSÃO PARA SUPER ADMIN NA TABELA EMPRESAS
DROP POLICY IF EXISTS "Super admins podem excluir empresas" ON public.empresas;
CREATE POLICY "Super admins podem excluir empresas" ON public.empresas
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = auth.uid())
    OR public.is_super_admin()
  );
