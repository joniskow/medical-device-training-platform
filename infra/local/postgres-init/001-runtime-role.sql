DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'local_runtime') THEN
    CREATE ROLE local_runtime LOGIN PASSWORD 'local_runtime_only_change_me' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE local_runtime WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'local_runtime_only_change_me';
GRANT CONNECT ON DATABASE medical_device TO local_runtime;
GRANT USAGE ON SCHEMA public TO local_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE local_app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO local_runtime;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medical_device_outbox_publisher') THEN
    CREATE ROLE medical_device_outbox_publisher LOGIN PASSWORD 'local_outbox_only_change_me' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE medical_device_outbox_publisher WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'local_outbox_only_change_me';
GRANT CONNECT ON DATABASE medical_device TO medical_device_outbox_publisher;
GRANT USAGE ON SCHEMA public TO medical_device_outbox_publisher;
ALTER DEFAULT PRIVILEGES FOR ROLE local_app IN SCHEMA public
  GRANT SELECT, UPDATE ON TABLES TO medical_device_outbox_publisher;
