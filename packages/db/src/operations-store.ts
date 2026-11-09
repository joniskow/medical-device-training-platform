import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

/** Global control-plane state contains opaque hashes only. No tenant content is stored here.
 * Runtime roles receive EXECUTE on these narrow functions, never table access. */
export const OPERATIONS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS operational_rate_buckets (
 bucket_key text PRIMARY KEY, window_start timestamptz NOT NULL, hits integer NOT NULL CHECK(hits>0)
);
CREATE TABLE IF NOT EXISTS operational_reservations (
 reservation_key text PRIMARY KEY, period date NOT NULL, estimate_cents integer NOT NULL CHECK(estimate_cents>=0),
 charged_cents integer CHECK(charged_cents>=0), owner_token uuid, lease_until timestamptz,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS operational_reservation_period ON operational_reservations(period);
CREATE TABLE IF NOT EXISTS operational_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), paused boolean NOT NULL DEFAULT false
);
INSERT INTO operational_control(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION operational_rate_take(k text, maximum integer, window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE accepted boolean;
BEGIN
 IF length(k)>160 OR maximum<1 OR maximum>10000 OR window_seconds<1 OR window_seconds>3600 THEN RAISE EXCEPTION 'RATE_CONFIGURATION_INVALID'; END IF;
 INSERT INTO public.operational_rate_buckets(bucket_key,window_start,hits) VALUES(k,clock_timestamp(),1)
 ON CONFLICT(bucket_key) DO UPDATE SET
 hits=CASE WHEN operational_rate_buckets.window_start<=clock_timestamp()-make_interval(secs=>window_seconds) THEN 1 ELSE least(operational_rate_buckets.hits,maximum)+1 END,
 window_start=CASE WHEN operational_rate_buckets.window_start<=clock_timestamp()-make_interval(secs=>window_seconds) THEN clock_timestamp() ELSE operational_rate_buckets.window_start END
 RETURNING hits<=maximum INTO accepted;
 -- Bounded cleanup prevents attacker-created addresses accumulating forever.
 DELETE FROM public.operational_rate_buckets WHERE bucket_key IN (SELECT bucket_key FROM public.operational_rate_buckets WHERE window_start<clock_timestamp()-interval '2 hours' LIMIT 100);
 RETURN accepted;
END $$;
CREATE OR REPLACE FUNCTION operational_reserve(k text, token uuid, estimate integer, lease_seconds integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.operational_reservations; used bigint; running integer;
BEGIN
 IF length(k)>160 OR estimate<1 OR estimate>50000 OR lease_seconds<1 OR lease_seconds>3600 THEN RAISE EXCEPTION 'ADMISSION_CONFIGURATION_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(72839503);
 IF (SELECT paused FROM public.operational_control WHERE singleton) THEN RETURN 'PAUSED'; END IF;
 SELECT * INTO existing FROM public.operational_reservations WHERE reservation_key=k;
 IF FOUND THEN
  IF existing.completed_at IS NOT NULL THEN RETURN 'COMPLETED'; END IF;
  IF existing.lease_until>clock_timestamp() THEN RETURN 'BUSY'; END IF;
  -- Expired reservations retain their estimated charge. A retry reserves another execution;
  -- an unknown crashed provider call can never be treated as free.
  UPDATE public.operational_reservations SET charged_cents=estimate_cents,completed_at=clock_timestamp(),owner_token=NULL,lease_until=NULL WHERE reservation_key=k;
  RETURN 'EXPIRED';
 END IF;
 SELECT coalesce(sum(coalesce(charged_cents,estimate_cents)),0) INTO used FROM public.operational_reservations WHERE period=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date;
 IF used+estimate>50000 THEN RETURN 'BUDGET'; END IF;
 SELECT count(*) INTO running FROM public.operational_reservations WHERE completed_at IS NULL AND lease_until>clock_timestamp();
 IF running>=4 THEN RETURN 'CAPACITY'; END IF;
 INSERT INTO public.operational_reservations(reservation_key,period,estimate_cents,owner_token,lease_until)
 VALUES(k,date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date,estimate,token,clock_timestamp()+make_interval(secs=>lease_seconds));
 RETURN CASE WHEN used+estimate>=40000 THEN 'ACCEPTED_WARNING' ELSE 'ACCEPTED' END;
END $$;
CREATE OR REPLACE FUNCTION operational_settle(k text, token uuid, charge integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE affected integer;
BEGIN
 IF charge<0 THEN RAISE EXCEPTION 'CHARGE_INVALID'; END IF;
 UPDATE public.operational_reservations SET charged_cents=greatest(estimate_cents,charge),completed_at=clock_timestamp(),owner_token=NULL,lease_until=NULL
 WHERE reservation_key=k AND owner_token=token AND completed_at IS NULL AND lease_until>clock_timestamp();
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END $$;
CREATE OR REPLACE FUNCTION operational_renew(k text, token uuid, lease_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE affected integer;
BEGIN
 IF lease_seconds<1 OR lease_seconds>3600 THEN RAISE EXCEPTION 'LEASE_INVALID'; END IF;
 UPDATE public.operational_reservations SET lease_until=clock_timestamp()+make_interval(secs=>lease_seconds)
 WHERE reservation_key=k AND owner_token=token AND completed_at IS NULL AND lease_until>clock_timestamp();
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END $$;
REVOKE ALL ON operational_rate_buckets,operational_reservations,operational_control FROM PUBLIC;
REVOKE ALL ON FUNCTION operational_rate_take(text,integer,integer),operational_reserve(text,uuid,integer,integer),operational_settle(text,uuid,integer),operational_renew(text,uuid,integer) FROM PUBLIC;
`;

export function createOperationsStore(pool: Pool) {
  return {
    async takeRate(key: string, maximum = 60, windowSeconds = 60): Promise<boolean> {
      const result = await pool.query('SELECT operational_rate_take($1,$2,$3) AS accepted', [key, maximum, windowSeconds]);
      return result.rows[0].accepted === true;
    },
    async reserve(key: string, estimateCents: number, leaseSeconds = 300) {
      const token = randomUUID();
      const result = await pool.query('SELECT operational_reserve($1,$2,$3,$4) AS status', [key, token, estimateCents, leaseSeconds]);
      return { status: result.rows[0].status as 'ACCEPTED'|'ACCEPTED_WARNING'|'PAUSED'|'BUDGET'|'CAPACITY'|'COMPLETED'|'BUSY'|'EXPIRED', token };
    },
    async renew(key: string, token: string, leaseSeconds = 300): Promise<boolean> {
      return (await pool.query('SELECT operational_renew($1,$2,$3) AS ok', [key, token, leaseSeconds])).rows[0].ok === true;
    },
    async settle(key: string, token: string, chargeCents: number): Promise<boolean> {
      return (await pool.query('SELECT operational_settle($1,$2,$3) AS ok', [key, token, chargeCents])).rows[0].ok === true;
    },
    async ready(): Promise<boolean> {
      const result = await pool.query(`SELECT to_regclass('public.processing_jobs') IS NOT NULL
        AND to_regclass('public.credentials') IS NOT NULL
        AND to_regclass('public.release_manifests') IS NOT NULL
        AND to_regprocedure('public.operational_reserve(text,uuid,integer,integer)') IS NOT NULL
        AND has_function_privilege(current_user,'public.operational_reserve(text,uuid,integer,integer)','EXECUTE')
        AND has_function_privilege(current_user,'public.operational_rate_take(text,integer,integer)','EXECUTE') AS ready`);
      return result.rows[0].ready === true;
    }
  };
}
