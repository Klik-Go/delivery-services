-- Phase 6 — Order lifecycle, store confirmation SLA, live updates and the notification queue
-- (docs/BUSINESS.md §5.2 steps 2–3, §5.4; docs/BUILD_PLAN.md Phase 6; docs/ARCHITECTURE.md §4g).

-- ---------------------------------------------------------------------------
-- Orders: why a store said no, and when the SLA escalated
-- ---------------------------------------------------------------------------
alter table public.orders
  add column reject_reason text check (char_length(reject_reason) between 1 and 300),
  add column sla_sms_at timestamptz,
  add column sla_flagged_at timestamptz;
alter table public.orders
  add constraint orders_reject_has_reason check (status <> 'rejected' or reject_reason is not null);
comment on column public.orders.sla_sms_at is 'When the store was texted that the order is waiting (SLA step 1).';
comment on column public.orders.sla_flagged_at is 'When the zone coordinator was alerted (SLA step 2).';

-- The SLA job only looks at orders waiting for the store.
create index orders_waiting_for_store_idx on public.orders (placed_at) where status = 'placed';

-- ---------------------------------------------------------------------------
-- Notifications: the background job claims queued rows ("sending") before it sends them, so two
-- runs never send the same message twice.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_status_check;
alter table public.notifications
  add constraint notifications_status_check check (status in ('queued', 'sending', 'sent', 'failed'));

-- ---------------------------------------------------------------------------
-- SLA thresholds (seconds after the order reaches the store). Admins change them in Phase 8;
-- `enabled = false` switches the escalation off.
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, description, enabled, rollout)
values (
  'merchant_sla',
  'Store confirmation deadline (docs/BUSINESS.md §5.4): text the store, alert the coordinator, then cancel.',
  true,
  '{"sms_after_s": 60, "flag_after_s": 120, "cancel_after_s": 180}'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The escalation itself (pg_cron, every 30 seconds). Each step happens once per order:
--   sms_after_s    → queue a text to the store (owner's account, store phone)
--   flag_after_s   → alert the zone's coordinators
--   cancel_after_s → cancel as the system (reason merchant_timeout), release the promo, tell the
--                    customer. Paid orders are refunded by the app's background job.
-- Messages are queued in `notifications`; the app sends them (it holds the SMS and push keys).
-- ---------------------------------------------------------------------------
create function private.escalate_merchant_sla(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_flag public.feature_flags;
  v_sms interval;
  v_alert interval;
  v_cancel interval;
  v_texted integer;
  v_flagged integer;
  v_cancelled integer;
begin
  select * into v_flag from public.feature_flags where key = 'merchant_sla';
  if not found or not v_flag.enabled then
    return jsonb_build_object('enabled', false);
  end if;
  v_sms := make_interval(secs => coalesce((v_flag.rollout ->> 'sms_after_s')::integer, 60));
  v_alert := make_interval(secs => coalesce((v_flag.rollout ->> 'flag_after_s')::integer, 120));
  v_cancel := make_interval(secs => coalesce((v_flag.rollout ->> 'cancel_after_s')::integer, 180));

  with due as (
    update public.orders o set sla_sms_at = p_now
     where o.status = 'placed' and o.sla_sms_at is null
       and o.placed_at <= p_now - v_sms and o.placed_at > p_now - v_cancel
    returning o.id, o.code, o.merchant_id
  ), queued as (
    insert into public.notifications (user_id, channel, template, payload, order_id)
    select m.owner_id, 'sms', 'merchant_order_waiting',
           jsonb_build_object('orderId', d.id, 'code', d.code, 'store', m.name), d.id
      from due d join public.merchants m on m.id = d.merchant_id
    returning 1
  )
  select count(*) into v_texted from due;

  with due as (
    update public.orders o set sla_flagged_at = p_now
     where o.status = 'placed' and o.sla_flagged_at is null
       and o.placed_at <= p_now - v_alert and o.placed_at > p_now - v_cancel
    returning o.id, o.code, o.merchant_id, o.zone_id
  ), queued as (
    insert into public.notifications (user_id, channel, template, payload, order_id)
    select ur.user_id, ch.channel, 'order_unacknowledged',
           jsonb_build_object('orderId', d.id, 'code', d.code, 'store', m.name), d.id
      from due d
      join public.merchants m on m.id = d.merchant_id
      join public.user_roles ur on ur.role = 'coordinator' and ur.zone_id = d.zone_id
      cross join (values ('push'::public.notification_channel), ('in_app'::public.notification_channel)) ch (channel)
    returning 1
  )
  select count(*) into v_flagged from due;

  perform set_config('klikgo.actor_id', '', true);
  perform set_config('klikgo.actor_role', '', true);
  perform set_config('klikgo.event_meta', '{"reason":"merchant_timeout","by":"system"}', true);
  with expired as (
    update public.orders o set status = 'cancelled', cancel_reason = 'merchant_timeout'
     where o.status = 'placed' and o.placed_at <= p_now - v_cancel
    returning o.id, o.code, o.customer_id, o.merchant_id
  ), released as (
    delete from public.promo_redemptions r using expired e where r.order_id = e.id returning 1
  ), told as (
    insert into public.notifications (user_id, channel, template, payload, order_id)
    select e.customer_id, ch.channel, 'order_store_timeout',
           jsonb_build_object('orderId', e.id, 'code', e.code, 'store', m.name), e.id
      from expired e
      join public.merchants m on m.id = e.merchant_id
      cross join (values ('push'::public.notification_channel), ('in_app'::public.notification_channel)) ch (channel)
    returning 1
  )
  select count(*) into v_cancelled from expired;
  perform set_config('klikgo.event_meta', '', true);

  return jsonb_build_object(
    'enabled', true, 'texted', v_texted, 'flagged', v_flagged, 'cancelled', v_cancelled
  );
end;
$$;
revoke all on function private.escalate_merchant_sla(timestamptz) from public;

select cron.schedule('merchant-sla', '30 seconds', $$select private.escalate_merchant_sla()$$);

-- ---------------------------------------------------------------------------
-- Live updates: every status change is broadcast on private Realtime channels, `order:<id>` (the
-- customer, the store, the zone, admins) and `merchant:<id>` (the store's board). The payload holds
-- ids and the status only; clients fetch details through the BFF.
-- ---------------------------------------------------------------------------
create function private.broadcast_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  v_payload := jsonb_build_object('orderId', new.id, 'status', new.status, 'at', now());
  perform realtime.send(v_payload, 'status', 'order:' || new.id::text, true);
  if new.status <> 'awaiting_payment' then
    perform realtime.send(v_payload, 'status', 'merchant:' || new.merchant_id::text, true);
  end if;
  return null;
exception when others then
  -- A live update must never block an order change; screens also refresh on their own.
  raise warning 'order broadcast failed: %', sqlerrm;
  return null;
end;
$$;
create trigger orders_broadcast_status after insert or update of status on public.orders
  for each row execute function private.broadcast_order_status();

-- Who may listen on a topic. Store staff need TOTP (aal2), like everywhere else on staff surfaces.
create function private.can_follow_topic(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := split_part(p_topic, ':', 1);
  v_raw text := split_part(p_topic, ':', 2);
  v_id uuid;
  v_aal2 boolean := coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
begin
  if v_raw !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := v_raw::uuid;
  if v_kind = 'order' then
    return exists (
      select 1 from public.orders o
       where o.id = v_id
         and (
           o.customer_id = (select auth.uid())
           or (v_aal2 and (
             private.is_merchant_member(o.merchant_id) or private.coordinates_zone(o.zone_id)
             or private.is_admin()
           ))
         )
    );
  elsif v_kind = 'merchant' then
    return v_aal2 and (private.is_merchant_member(v_id) or private.is_admin());
  end if;
  return false;
end;
$$;
revoke all on function private.can_follow_topic(text) from public;
grant execute on function private.can_follow_topic(text) to authenticated;

-- realtime.messages belongs to Supabase Realtime; it exists on hosted projects and whenever the
-- Realtime service is running locally (CI starts it).
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy klikgo_follow_order_topics on realtime.messages for select to authenticated
        using (realtime.messages.extension = 'broadcast' and private.can_follow_topic((select realtime.topic())))
    $p$;
  else
    raise warning 'realtime.messages is missing: start Supabase Realtime and reset the database';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The app's background jobs (send queued messages, finish refunds) are triggered from here every
-- 30 seconds over pg_net, so no extra scheduler is needed. The app URL and the shared secret live
-- in Supabase Vault (docs/OPEN_QUESTIONS.md Q25); without them this does nothing.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create function private.run_app_jobs() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'klikgo_app_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'klikgo_cron_secret'$q$ into v_secret;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/api/internal/jobs',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
end;
$$;
revoke all on function private.run_app_jobs() from public;

select cron.schedule('app-jobs', '30 seconds', $$select private.run_app_jobs()$$);
