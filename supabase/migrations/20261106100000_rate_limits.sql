-- Phase 2 — Rate limiting for auth endpoints (OTP sends, code guesses, password attempts).
-- Fixed-window counters in the unexposed `private` schema; only the server (service role /
-- postgres) can call the function. Old windows are deleted hourly by pg_cron.

create table private.rate_limit_counters (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (key, window_start)
);
comment on table private.rate_limit_counters is 'Fixed-window hit counters per key, e.g. otp:phone:+639171234567.';
create index rate_limit_counters_window_idx on private.rate_limit_counters (window_start);
revoke all on private.rate_limit_counters from public, anon, authenticated;

-- Counts one hit and says whether it is within the limit. Atomic under concurrency (upsert).
create function private.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'rate limit must be positive' using errcode = 'invalid_parameter_value';
  end if;
  insert into private.rate_limit_counters as c (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;

  return query select
    v_hits <= p_limit,
    greatest(p_limit - v_hits, 0),
    case when v_hits <= p_limit then 0
         else greatest(ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::integer, 1)
    end;
end;
$$;
revoke all on function private.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function private.hit_rate_limit(text, integer, integer) to service_role;

select cron.schedule(
  'klikgo-rate-limit-cleanup',
  '17 * * * *',
  $$delete from private.rate_limit_counters where window_start < now() - interval '1 day'$$
);
