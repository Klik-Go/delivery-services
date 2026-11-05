-- Klik Go local development seed, applied by `supabase db reset` after the migrations.
--
-- The launch zones (Makati City, San Fernando Pampanga, San Marcelino Zambales) come from the
-- migration 20261108100000_launch_zones.sql; this seed puts its stores, riders and customers in
-- Makati (pins checked against the PSA barangay boundaries).
--
-- No real personal data and no secrets: users are fake (@seed.klikgo.test, +63917000xxxx) and have
-- no passwords. Tests sign in by setting request.jwt.claims; Phase 2 adds test OTP numbers.
-- Fixed UUIDs keep links between rows readable: 5eed0000-…-0000000000XY.

do $seed$
declare
  v_zone uuid;
  -- people
  v_admin uuid := '5eed0000-0000-4000-8000-0000000000a1';
  v_coordinator uuid := '5eed0000-0000-4000-8000-0000000000c1';
  v_owner_nena uuid := '5eed0000-0000-4000-8000-0000000000b1';
  v_owner_kape uuid := '5eed0000-0000-4000-8000-0000000000b2';
  v_owner_tea uuid := '5eed0000-0000-4000-8000-0000000000b3';
  v_owner_silog uuid := '5eed0000-0000-4000-8000-0000000000b4';
  v_owner_merienda uuid := '5eed0000-0000-4000-8000-0000000000b5';
  v_staff_nena uuid := '5eed0000-0000-4000-8000-0000000000b6';
  v_rider_rico uuid := '5eed0000-0000-4000-8000-0000000000d1';
  v_rider_rosa uuid := '5eed0000-0000-4000-8000-0000000000d2';
  v_rider_rey uuid := '5eed0000-0000-4000-8000-0000000000d3';
  v_customer_carmen uuid := '5eed0000-0000-4000-8000-0000000000e1';
  v_customer_diego uuid := '5eed0000-0000-4000-8000-0000000000e2';
  v_customer_liza uuid := '5eed0000-0000-4000-8000-0000000000e3';
  -- merchants
  v_nena uuid := '5eed0000-0000-4000-8000-000000000101';
  v_kape uuid := '5eed0000-0000-4000-8000-000000000102';
  v_tea uuid := '5eed0000-0000-4000-8000-000000000103';
  v_silog uuid := '5eed0000-0000-4000-8000-000000000104';
  v_merienda uuid := '5eed0000-0000-4000-8000-000000000105';
  v_hours jsonb := '{"mon":[{"open":"10:00","close":"14:00"},{"open":"17:00","close":"21:00"}],"tue":[{"open":"10:00","close":"14:00"},{"open":"17:00","close":"21:00"}],"wed":[{"open":"10:00","close":"14:00"},{"open":"17:00","close":"21:00"}],"thu":[{"open":"10:00","close":"14:00"},{"open":"17:00","close":"21:00"}],"fri":[{"open":"10:00","close":"14:00"},{"open":"17:00","close":"21:00"}],"sat":[{"open":"10:00","close":"21:00"}],"sun":[{"open":"10:00","close":"21:00"}]}';
  v_person record;
  v_merchant record;
  v_item record;
  v_category uuid;
  v_item_id uuid;
  v_group uuid;
begin
  -- People (the sign-up trigger creates each profile and the customer role).
  for v_person in
    select * from (values
      (v_admin, 'Ada Admin', 'admin', '639170000001'),
      (v_coordinator, 'Cora Coordinator', 'coordinator', '639170000002'),
      (v_owner_nena, 'Nena Santos', 'nena', '639170000011'),
      (v_owner_kape, 'Kiko Reyes', 'kiko', '639170000012'),
      (v_owner_tea, 'Juan Dizon', 'juan', '639170000013'),
      (v_owner_silog, 'Sol Garcia', 'sol', '639170000014'),
      (v_owner_merienda, 'Mila Cruz', 'mila', '639170000015'),
      (v_staff_nena, 'Sam Staff', 'sam', '639170000016'),
      (v_rider_rico, 'Rico Rider', 'rico', '639170000021'),
      (v_rider_rosa, 'Rosa Rider', 'rosa', '639170000022'),
      (v_rider_rey, 'Rey Rider', 'rey', '639170000023'),
      (v_customer_carmen, 'Carmen Customer', 'carmen', '639170000031'),
      (v_customer_diego, 'Diego Customer', 'diego', '639170000032'),
      (v_customer_liza, 'Liza Customer', 'liza', '639170000033')
    ) as p(id, full_name, handle, phone)
  loop
    insert into auth.users (
      id, instance_id, aud, role, email, phone, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at
    ) values (
      v_person.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      v_person.handle || '@seed.klikgo.test', v_person.phone, '{"provider":"phone","providers":["phone"]}',
      jsonb_build_object('full_name', v_person.full_name), '', '', '', '', now(), now()
    );
  end loop;

  -- Makati City (from the launch-zones migration) gets the seeded coordinator.
  select id into strict v_zone from public.zones where slug = 'makati';
  update public.zones set coordinator_id = v_coordinator where id = v_zone;

  insert into public.user_roles (user_id, role, zone_id) values (v_admin, 'admin', null), (v_coordinator, 'coordinator', v_zone);

  -- Five founding merchants: 20% commission, waived for their first 90 days (docs/BUSINESS.md §4.2,
  -- Appendix A).
  for v_merchant in
    select * from (values
      (v_nena, v_owner_nena, 'Aling Nena''s Karinderya', 'aling-nenas-karinderya', 'Lutong bahay: ulam, rice and kakanin.', 14.5653, 121.0298),
      (v_kape, v_owner_kape, 'Kape''t Tinapay', 'kapet-tinapay', 'Fresh pandesal every morning and barako coffee.', 14.5583, 121.0187),
      (v_tea, v_owner_tea, 'Milk Tea ni Juan', 'milk-tea-ni-juan', 'Milk tea and fruit tea, sugar level your way.', 14.5615, 121.0236),
      (v_silog, v_owner_silog, 'Silog Express', 'silog-express', 'All-day silog meals.', 14.5730, 121.0200),
      (v_merienda, v_owner_merienda, 'Merienda Corner', 'merienda-corner', 'Turon, banana cue, pancit and halo-halo.', 14.5520, 121.0050)
    ) as m(id, owner_id, name, slug, description, lat, lng)
  loop
    insert into public.merchants (id, zone_id, owner_id, name, slug, description, category, location, commission_bps,
                                  founding_commission_until, accepts_cod, is_open, default_prep_minutes, hours, status)
    values (
      v_merchant.id, v_zone, v_merchant.owner_id, v_merchant.name, v_merchant.slug, v_merchant.description, 'food',
      extensions.st_setsrid(extensions.st_makepoint(v_merchant.lng, v_merchant.lat), 4326)::extensions.geography,
      2000, now() + interval '90 days', true, true, 15, v_hours, 'active'
    );
    insert into public.user_roles (user_id, role, merchant_id) values (v_merchant.owner_id, 'merchant_owner', v_merchant.id);
  end loop;
  insert into public.user_roles (user_id, role, merchant_id) values (v_staff_nena, 'merchant_staff', v_nena);

  -- Menus: (merchant, category, item, price in centavos, modifier group, required, options with price deltas)
  for v_item in
    select * from (values
      (v_nena, 'Ulam', 'Adobong Manok', 9500, 'Rice', true, '[["Plain rice",0],["Garlic rice",1000]]'),
      (v_nena, 'Ulam', 'Sinigang na Baboy', 12000, 'Rice', true, '[["Plain rice",0],["Garlic rice",1000]]'),
      (v_nena, 'Ulam', 'Pinakbet', 8500, null, false, null),
      (v_nena, 'Extras', 'Extra Rice', 2000, null, false, null),
      (v_nena, 'Dessert', 'Leche Flan', 4500, null, false, null),
      (v_kape, 'Tinapay', 'Pandesal (10 pcs)', 4000, null, false, null),
      (v_kape, 'Tinapay', 'Ensaymada', 3500, null, false, null),
      (v_kape, 'Tinapay', 'Spanish Bread (5 pcs)', 4500, null, false, null),
      (v_kape, 'Kape', 'Kapeng Barako', 6000, 'Sugar', true, '[["No sugar",0],["Less sugar",0],["Regular",0]]'),
      (v_kape, 'Kape', 'Iced Coffee', 7500, 'Sugar', true, '[["No sugar",0],["Less sugar",0],["Regular",0]]'),
      (v_tea, 'Milk Tea', 'Wintermelon Milk Tea', 9000, 'Size', true, '[["Regular",0],["Large",1500]]'),
      (v_tea, 'Milk Tea', 'Okinawa Milk Tea', 9500, 'Size', true, '[["Regular",0],["Large",1500]]'),
      (v_tea, 'Milk Tea', 'Taro Milk Tea', 9500, 'Size', true, '[["Regular",0],["Large",1500]]'),
      (v_tea, 'Milk Tea', 'Brown Sugar Milk Tea', 11000, 'Add-ons', false, '[["Pearls",1000],["Nata de coco",1000]]'),
      (v_silog, 'Silog', 'Tapsilog', 11000, 'Egg', true, '[["Sunny side up",0],["Scrambled",0]]'),
      (v_silog, 'Silog', 'Longsilog', 9500, 'Egg', true, '[["Sunny side up",0],["Scrambled",0]]'),
      (v_silog, 'Silog', 'Tocilog', 9500, 'Egg', true, '[["Sunny side up",0],["Scrambled",0]]'),
      (v_silog, 'Silog', 'Bangsilog', 12000, 'Egg', true, '[["Sunny side up",0],["Scrambled",0]]'),
      (v_merienda, 'Merienda', 'Turon (3 pcs)', 4500, null, false, null),
      (v_merienda, 'Merienda', 'Banana Cue', 3000, null, false, null),
      (v_merienda, 'Merienda', 'Lumpiang Shanghai (10 pcs)', 8000, 'Sauce', false, '[["Sweet chili",0],["Vinegar",0]]'),
      (v_merienda, 'Merienda', 'Pancit Canton', 9000, null, false, null),
      (v_merienda, 'Dessert', 'Halo-halo', 11000, 'Size', true, '[["Regular",0],["Special",3000]]')
    ) as i(merchant_id, category, name, price_centavos, group_name, group_required, options)
  loop
    select id into v_category from public.menu_categories where merchant_id = v_item.merchant_id and name = v_item.category;
    if v_category is null then
      insert into public.menu_categories (merchant_id, name, sort)
      values (v_item.merchant_id, v_item.category,
              (select count(*) from public.menu_categories where merchant_id = v_item.merchant_id))
      returning id into v_category;
    end if;
    insert into public.menu_items (merchant_id, category_id, name, price_centavos, sort)
    values (v_item.merchant_id, v_category, v_item.name, v_item.price_centavos,
            (select count(*) from public.menu_items where category_id = v_category))
    returning id into v_item_id;
    if v_item.group_name is not null then
      insert into public.modifier_groups (menu_item_id, name, min_select, max_select, is_required)
      values (v_item_id, v_item.group_name,
              case when v_item.group_required then 1 else 0 end,
              case when v_item.group_name = 'Add-ons' then 2 else 1 end,
              v_item.group_required)
      returning id into v_group;
      insert into public.modifier_options (modifier_group_id, name, price_delta_centavos, sort)
      select v_group, o.value ->> 0, (o.value ->> 1)::int, o.ordinality - 1
      from jsonb_array_elements(v_item.options::jsonb) with ordinality as o(value, ordinality);
    end if;
  end loop;

  -- Riders: two approved and online, one still waiting for KYC review.
  insert into public.user_roles (user_id, role) values (v_rider_rico, 'rider'), (v_rider_rosa, 'rider'), (v_rider_rey, 'rider');
  insert into public.riders (id, user_id, zone_id, vehicle_type, plate_no, status, is_online) values
    ('5eed0000-0000-4000-8000-000000000201', v_rider_rico, v_zone, 'motorcycle', 'NAB 1234', 'active', true),
    ('5eed0000-0000-4000-8000-000000000202', v_rider_rosa, v_zone, 'motorcycle', 'NAC 5678', 'active', true),
    ('5eed0000-0000-4000-8000-000000000203', v_rider_rey, v_zone, 'tricycle', 'TRY 9012', 'pending_kyc', false);
  insert into public.rider_locations (rider_id, location) values
    ('5eed0000-0000-4000-8000-000000000201', 'SRID=4326;POINT(121.0280 14.5640)'),
    ('5eed0000-0000-4000-8000-000000000202', 'SRID=4326;POINT(121.0220 14.5590)');

  -- Customers' saved addresses (pin + landmark, as PH addresses need).
  insert into public.addresses (user_id, label, location, street, landmark, barangay, city, notes, contact_phone, is_default) values
    (v_customer_carmen, 'Home', 'SRID=4326;POINT(121.0330 14.5680)', 'P. Burgos St.', 'Beside the sari-sari store with a blue gate',
     'Poblacion', 'Makati City', 'Call when outside', '+639170000031', true),
    (v_customer_diego, 'Office', 'SRID=4326;POINT(121.0200 14.5520)', 'Pasay Road', 'Across the barangay hall',
     'San Lorenzo', 'Makati City', null, '+639170000032', true),
    (v_customer_liza, 'Home', 'SRID=4326;POINT(121.0100 14.5700)', null, 'Near the chapel, green house',
     'Singkamas', 'Makati City', 'Dog at the gate', '+639170000033', true);

  -- Flat zone fee in distance bands + a small-order fee (docs/BUILD_PLAN.md §4D, §4F).
  insert into public.fee_rules (zone_id, name, kind, min_distance_m, max_distance_m, min_subtotal_centavos, fee_centavos, priority) values
    (v_zone, 'Up to 2 km', 'delivery_distance_band', 0, 2000, null, 3900, 10),
    (v_zone, '2 to 4 km', 'delivery_distance_band', 2000, 4000, null, 4900, 20),
    (v_zone, 'Over 4 km', 'delivery_distance_band', 4000, null, null, 5900, 30),
    (v_zone, 'Small order under ₱150', 'small_order_fee', null, null, 15000, 2000, 10);

  -- Featured promos for the home carousel (codes validated by the server in Phase 5).
  insert into public.promos (code, type, discount_centavos, min_subtotal_centavos, starts_at, ends_at, zone_id, is_featured) values
    ('KAINTAYO', 'fixed_off', 5000, 30000, now() - interval '1 day', now() + interval '60 days', v_zone, true);
  insert into public.promos (code, type, min_subtotal_centavos, starts_at, ends_at, zone_id, is_featured) values
    ('LIBREHATID', 'free_delivery', 20000, now() - interval '1 day', now() + interval '60 days', v_zone, true);

  insert into public.feature_flags (key, description, enabled) values
    ('pabili_mode', 'Pabili (buy-for-me) orders from any store (docs/BUILD_PLAN.md §4C)', false),
    ('merchant_auto_accept', 'Auto-accept orders for reliable merchants (docs/BUILD_PLAN.md §4E)', false),
    ('sms_fallback', 'SMS the merchant when a new order is unacknowledged for 60 s', true);
end;
$seed$;
