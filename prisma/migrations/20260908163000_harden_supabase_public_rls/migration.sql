-- Diamond Shine does not expose application tables directly through the Supabase Data API.
-- Web and mobile clients use the application API; Prisma connects server-side to Postgres.
-- Keep public-schema tables closed to Supabase API roles when those roles exist,
-- and enable RLS as defense in depth on every public table.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.enable_rls_on_new_public_tables()
RETURNS EVENT_TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name = 'public' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'enable_rls_on_new_public_tables: failed for %: %', cmd.object_identity, SQLERRM;
      END;
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS ensure_public_rls;
CREATE EVENT TRIGGER ensure_public_rls
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
EXECUTE FUNCTION private.enable_rls_on_new_public_tables();

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  END LOOP;
END;
$$;

-- Supabase supplies anon/authenticated roles in hosted projects, while plain
-- PostgreSQL used by CI/local development does not. Revoke only roles that
-- actually exist so this migration remains portable across both environments.
DO $$
DECLARE
  api_role record;
BEGIN
  FOR api_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', api_role.rolname);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role.rolname);
    EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role.rolname);
  END LOOP;
END;
$$;

-- Keep future objects closed by default for whichever migration owner creates
-- them. Hosted Supabase normally uses postgres; CI uses its configured
-- PostgreSQL superuser. Apply to both when present, without assuming either.
DO $$
DECLARE
  owner_role record;
  api_role record;
BEGIN
  FOR owner_role IN
    SELECT DISTINCT rolname
    FROM pg_roles
    WHERE rolname = current_user OR rolname = 'postgres'
  LOOP
    FOR api_role IN
      SELECT rolname
      FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated')
    LOOP
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM %I',
        owner_role.rolname,
        api_role.rolname
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM %I',
        owner_role.rolname,
        api_role.rolname
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
        owner_role.rolname,
        api_role.rolname
      );
    END LOOP;
  END LOOP;
END;
$$;
