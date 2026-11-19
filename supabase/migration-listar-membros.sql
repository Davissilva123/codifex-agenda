-- ==========================================================
--  MIGRAÇÃO: LISTAGEM DE MEMBROS COM E-MAIL E ÚLTIMO ACESSO
-- ==========================================================

-- Remove a versão anterior para permitir a alteração segura do tipo de retorno (RETURNS TABLE)
DROP FUNCTION IF EXISTS public.listar_membros_empresa(uuid);

CREATE OR REPLACE FUNCTION public.listar_membros_empresa(p_empresa_id uuid)
RETURNS TABLE (
  user_id uuid,
  email text,
  papel text,
  status text,
  ultimo_acesso timestamptz,
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
    u.last_sign_in_at AS ultimo_acesso,
    m.created_at
  FROM public.membros m
  LEFT JOIN auth.users u ON u.id = m.user_id
  WHERE m.empresa_id = p_empresa_id
  ORDER BY m.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.listar_membros_empresa(uuid) TO authenticated, service_role;
