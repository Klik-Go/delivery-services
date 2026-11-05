-- Phase 0: platform extensions.
-- PostGIS: geography columns for zones, addresses, merchants and rider locations
--   (ST_Contains for zone lookup, ST_DWithin + KNN <-> for nearest riders; docs/BUILD_PLAN.md §2 "Geo").
-- pg_cron: SQL-only timers such as the merchant acceptance SLA, dispatch offer expiry and
--   stale-rider cleanup (docs/BUILD_PLAN.md §2 "Jobs and timers").
-- Supabase convention: PostGIS lives in the `extensions` schema; pg_cron must be in pg_catalog.

create extension if not exists postgis with schema extensions;

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
