-- Migration: add is_admin helper and RLS policies for agendamentos (appointments)

-- 1. Helper function to check if a user is admin (empresa admin or super admin)
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN (
        EXISTS (SELECT 1 FROM public.membros m WHERE m.user_id = p_user_id AND m.papel = 'admin_empresa')
        OR EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = p_user_id)
    );
END;
$$;

-- 2. Enable Row Level Security on the appointments table (agendamentos)
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;

-- 3. Policies
-- SELECT: owners can see their own rows; admins can see all rows
CREATE POLICY "users can see own appointments or admin sees all"
    ON public.agendamentos
    FOR SELECT
    USING (
        auth.uid() = user_id
        OR public.is_admin(auth.uid())
    );

-- INSERT: a user may only insert rows for themselves
CREATE POLICY "users can insert own appointments"
    ON public.agendamentos
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- UPDATE: owners or admins may update rows
CREATE POLICY "users can update own or admin can update any"
    ON public.agendamentos
    FOR UPDATE
    USING (
        auth.uid() = user_id
        OR public.is_admin(auth.uid())
    )
    WITH CHECK (
        auth.uid() = user_id
        OR public.is_admin(auth.uid())
    );

-- DELETE: owners or admins may delete rows
CREATE POLICY "users can delete own or admin can delete any"
    ON public.agendamentos
    FOR DELETE
    USING (
        auth.uid() = user_id
        OR public.is_admin(auth.uid())
    );

-- Optional: index on user_id for better performance of RLS checks
CREATE INDEX IF NOT EXISTS agendamentos_user_id_idx ON public.agendamentos (user_id);
