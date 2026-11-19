-- Migration: enforce per‑user visibility on agendamentos (appointments)

-- Ensure RLS is enabled
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;

-- Remove any existing policies that may conflict (safety net)
DROP POLICY IF EXISTS "users can see own appointments or admin sees all" ON public.agendamentos;
DROP POLICY IF EXISTS "users can insert own appointments" ON public.agendamentos;
DROP POLICY IF EXISTS "users can update own or admin can update any" ON public.agendamentos;
DROP POLICY IF EXISTS "users can delete own or admin can delete any" ON public.agendamentos;
DROP POLICY IF EXISTS "user can see own appointments" ON public.agendamentos;
DROP POLICY IF EXISTS "user can insert own appointments" ON public.agendamentos;
DROP POLICY IF EXISTS "user can update own appointments" ON public.agendamentos;
DROP POLICY IF EXISTS "user can delete own appointments" ON public.agendamentos;

-- Policy: users may SELECT only their own rows
CREATE POLICY "user can see own appointments"
    ON public.agendamentos
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: users may INSERT rows only for themselves
CREATE POLICY "user can insert own appointments"
    ON public.agendamentos
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: users may UPDATE only their own rows
CREATE POLICY "user can update own appointments"
    ON public.agendamentos
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: users may DELETE only their own rows
CREATE POLICY "user can delete own appointments"
    ON public.agendamentos
    FOR DELETE
    USING (auth.uid() = user_id);

-- Optional index for performance (if not already present)
CREATE INDEX IF NOT EXISTS agendamentos_user_id_idx ON public.agendamentos (user_id);
