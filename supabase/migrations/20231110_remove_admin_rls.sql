-- Migration: revert admin/RLS changes for agendamentos (appointments)

-- 1. Remove RLS policies
DROP POLICY IF EXISTS "users can see own appointments or admin sees all" ON public.agendamentos;
DROP POLICY IF EXISTS "users can insert own appointments" ON public.agendamentos;
DROP POLICY IF EXISTS "users can update own or admin can update any" ON public.agendamentos;
DROP POLICY IF EXISTS "users can delete own or admin can delete any" ON public.agendamentos;

-- 2. Disable Row Level Security on the table
ALTER TABLE public.agendamentos DISABLE ROW LEVEL SECURITY;

-- 3. Drop the helper function (if it exists)
DROP FUNCTION IF EXISTS public.is_admin(uuid);

-- 4. Drop the optional index (if it exists)
DROP INDEX IF EXISTS agendamentos_user_id_idx;
