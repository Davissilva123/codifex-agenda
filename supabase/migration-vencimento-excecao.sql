-- Migração idempotente para adicionar a coluna de exceção de suspensão automática
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'empresas'
      AND column_name = 'nao_suspender_automaticamente'
  ) THEN
    ALTER TABLE public.empresas
    ADD COLUMN nao_suspender_automaticamente boolean NOT NULL DEFAULT false;
  END IF;
END $$;
