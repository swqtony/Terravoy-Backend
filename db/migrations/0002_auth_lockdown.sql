-- Create dedicated API role
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_role') THEN
    CREATE ROLE api_role;
  END IF;
END$$;

-- Grant api_role to application user (terravoy)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'terravoy') THEN
    GRANT api_role TO terravoy;
  END IF;
END$$;

-- Revoke overly broad grants from anon/authenticated/service_role on public schema
REVOKE ALL ON SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role;

-- Grant minimal privileges to api_role
GRANT USAGE ON SCHEMA public TO api_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO api_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO api_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO api_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO api_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO api_role;
