# Klik Go — Entity relationship diagram

> Generated from the migrated database by `pnpm --filter @klikgo/db db:erd`; do not edit by hand.
> Source of truth: `supabase/migrations`. CI fails if this file is out of date.

Conventions: money columns are integer centavos (`*_centavos`), times are `timestamptz` (UTC),
locations are PostGIS `geography` (SRID 4326). `PK` primary key, `FK` foreign key, `UK` unique.
Cardinality: `||` exactly one, `|o` zero or one, `o{` zero or many. `auth_users` is Supabase Auth's user table.

## People, roles and zones

```mermaid
erDiagram
  profiles ||--o{ addresses : "user_id"
  profiles ||--o{ device_push_subscriptions : "user_id"
  profiles |o--o{ feature_flags : "updated_by"
  zones ||--o{ fee_rules : "zone_id"
  profiles |o--o{ invites : "accepted_by"
  profiles |o--o{ invites : "invited_by"
  merchants |o--o{ invites : "merchant_id"
  zones |o--o{ invites : "zone_id"
  profiles ||--o{ loyalty_stamps : "customer_id"
  profiles |o--o{ merchant_applications : "reviewed_by"
  zones |o--o{ merchant_applications : "zone_id"
  profiles ||--o{ merchants : "owner_id"
  zones ||--o{ merchants : "zone_id"
  profiles ||--o{ notifications : "user_id"
  profiles |o--o{ orders : "cancelled_by"
  profiles ||--o{ orders : "customer_id"
  zones ||--o{ orders : "zone_id"
  auth_users ||--o| profiles : "id"
  profiles ||--o{ promo_redemptions : "user_id"
  zones |o--o{ promos : "zone_id"
  profiles ||--o{ ratings : "from_user_id"
  profiles ||--o| referrals : "referee_id"
  profiles ||--o{ referrals : "referrer_id"
  profiles |o--o{ refunds : "requested_by"
  profiles |o--o{ rider_kyc_documents : "reviewed_by"
  profiles ||--o| riders : "user_id"
  zones ||--o{ riders : "zone_id"
  profiles |o--o{ user_roles : "granted_by"
  merchants |o--o{ user_roles : "merchant_id"
  profiles ||--o{ user_roles : "user_id"
  zones |o--o{ user_roles : "zone_id"
  profiles |o--o{ zones : "coordinator_id"
  profiles {
    uuid id PK, FK
    text full_name
    text phone UK
    text email
    text locale
    profile_status status
    timestamptz created_at
    timestamptz updated_at
  }
  user_roles {
    uuid id PK
    uuid user_id FK, UK
    app_role role UK
    uuid merchant_id FK, UK
    uuid zone_id FK, UK
    uuid granted_by FK
    timestamptz created_at
  }
  invites {
    uuid id PK
    text email
    app_role role
    uuid merchant_id FK
    uuid zone_id FK
    uuid invited_by FK
    text token_hash UK
    timestamptz expires_at
    timestamptz accepted_at
    uuid accepted_by FK
    timestamptz created_at
  }
  zones {
    uuid id PK
    text name
    text slug UK
    zone_type zone_type
    geography area
    int4 base_fee_centavos
    int4 per_km_centavos
    int4 surge_multiplier_bps
    numeric max_radius_km
    bool is_active
    jsonb service_hours
    uuid coordinator_id FK
    timestamptz created_at
    timestamptz updated_at
  }
  addresses {
    uuid id PK
    uuid user_id FK
    text label
    geography location
    text street
    text landmark
    text barangay
    text city
    text notes
    text contact_phone
    bool is_default
    timestamptz created_at
    timestamptz updated_at
  }
```

## Merchants and menus

```mermaid
erDiagram
  merchants |o--o{ invites : "merchant_id"
  merchants ||--o{ menu_categories : "merchant_id"
  menu_categories ||--o{ menu_items : "category_id, merchant_id"
  merchants ||--o{ menu_items : "merchant_id"
  merchants |o--o{ merchant_applications : "merchant_id"
  profiles |o--o{ merchant_applications : "reviewed_by"
  zones |o--o{ merchant_applications : "zone_id"
  merchants ||--o{ merchant_closures : "merchant_id"
  profiles ||--o{ merchants : "owner_id"
  zones ||--o{ merchants : "zone_id"
  menu_items ||--o{ modifier_groups : "menu_item_id"
  modifier_groups ||--o{ modifier_options : "modifier_group_id"
  menu_items |o--o{ order_items : "menu_item_id"
  merchants ||--o{ orders : "merchant_id"
  merchants |o--o{ promos : "merchant_id"
  merchants |o--o{ user_roles : "merchant_id"
  merchant_applications {
    uuid id PK
    text business_name
    text owner_name
    text phone
    text email
    merchant_category category
    text barangay
    text city
    text address_line
    geography location
    uuid zone_id FK
    merchant_application_status status
    uuid merchant_id FK
    uuid reviewed_by FK
    timestamptz reviewed_at
    text rejection_reason
    timestamptz created_at
    timestamptz updated_at
  }
  merchants {
    uuid id PK
    uuid zone_id FK
    uuid owner_id FK
    text name
    text slug UK
    text description
    merchant_category category
    geography location
    text address_line
    text phone
    int4 commission_bps
    bool accepts_cod
    bool is_open
    int4 default_prep_minutes
    jsonb hours
    merchant_status status
    numeric rating_avg
    int4 rating_count
    text cover_photo_path
    timestamptz created_at
    timestamptz updated_at
    numeric service_radius_km
    timestamptz founding_commission_until
  }
  merchant_closures {
    uuid id PK
    uuid merchant_id FK, UK
    date closed_on UK
    text reason
    timestamptz created_at
  }
  menu_categories {
    uuid id PK
    uuid merchant_id FK, UK
    text name
    int4 sort
    bool is_active
    timestamptz created_at
    timestamptz updated_at
  }
  menu_items {
    uuid id PK
    uuid merchant_id FK
    uuid category_id FK
    text name
    text description
    int4 price_centavos
    bool is_available
    text photo_path
    int4 sort
    timestamptz created_at
    timestamptz updated_at
  }
  modifier_groups {
    uuid id PK
    uuid menu_item_id FK
    text name
    int4 min_select
    int4 max_select
    bool is_required
    int4 sort
    timestamptz created_at
    timestamptz updated_at
  }
  modifier_options {
    uuid id PK
    uuid modifier_group_id FK
    text name
    int4 price_delta_centavos
    bool is_available
    int4 sort
    timestamptz created_at
    timestamptz updated_at
  }
```

## Riders

```mermaid
erDiagram
  riders ||--o{ dispatch_offers : "rider_id"
  riders |o--o{ orders : "rider_id"
  profiles |o--o{ rider_kyc_documents : "reviewed_by"
  riders ||--o{ rider_kyc_documents : "rider_id"
  orders |o--o{ rider_location_breadcrumbs : "order_id"
  riders ||--o{ rider_location_breadcrumbs : "rider_id"
  riders ||--o| rider_locations : "rider_id"
  profiles ||--o| riders : "user_id"
  zones ||--o{ riders : "zone_id"
  riders {
    uuid id PK
    uuid user_id FK, UK
    uuid zone_id FK
    vehicle_type vehicle_type
    text plate_no
    rider_status status
    bool is_online
    int4 cash_limit_centavos
    numeric rating_avg
    int4 rating_count
    timestamptz created_at
    timestamptz updated_at
  }
  rider_kyc_documents {
    uuid id PK
    uuid rider_id FK
    kyc_document_type type
    text storage_path UK
    kyc_status status
    uuid reviewed_by FK
    timestamptz reviewed_at
    text rejection_reason
    timestamptz created_at
  }
  rider_locations {
    uuid rider_id PK, FK
    geography location
    int2 heading
    numeric speed_kph
    numeric accuracy_m
    timestamptz updated_at
  }
  rider_location_breadcrumbs {
    int8 id PK
    uuid rider_id FK
    uuid order_id FK
    geography location
    timestamptz recorded_at
  }
```

## Orders and dispatch

```mermaid
erDiagram
  orders ||--o{ dispatch_offers : "order_id"
  riders ||--o{ dispatch_offers : "rider_id"
  orders |o--o{ ledger_entries : "order_id"
  orders ||--o| loyalty_stamps : "order_id"
  orders |o--o{ loyalty_stamps : "redeemed_order_id"
  orders |o--o{ notifications : "order_id"
  orders ||--o| order_delivery_pins : "order_id"
  orders ||--o{ order_events : "order_id"
  menu_items |o--o{ order_items : "menu_item_id"
  orders ||--o{ order_items : "order_id"
  profiles |o--o{ orders : "cancelled_by"
  profiles ||--o{ orders : "customer_id"
  merchants ||--o{ orders : "merchant_id"
  riders |o--o{ orders : "rider_id"
  zones ||--o{ orders : "zone_id"
  orders ||--o| payments : "order_id"
  orders ||--o| promo_redemptions : "order_id"
  orders ||--o{ ratings : "order_id"
  orders |o--o{ referrals : "qualifying_order_id"
  orders ||--o{ refunds : "order_id"
  orders |o--o{ rider_location_breadcrumbs : "order_id"
  orders {
    uuid id PK
    text code UK
    uuid customer_id FK
    uuid merchant_id FK
    uuid rider_id FK
    uuid zone_id FK
    order_status status
    dispatch_status dispatch_status
    int4 subtotal_centavos
    int4 delivery_fee_centavos
    int4 service_fee_centavos
    int4 small_order_fee_centavos
    int4 discount_centavos
    int4 tip_centavos
    int4 total_centavos
    payment_method payment_method
    payment_status payment_status
    jsonb address_snapshot
    geography dropoff
    timestamptz scheduled_for
    int4 prep_minutes
    text delivery_pin_hash
    text cancel_reason
    uuid cancelled_by FK
    app_role cancelled_by_role
    timestamptz placed_at
    timestamptz accepted_at
    timestamptz preparing_at
    timestamptz ready_at
    timestamptz picked_up_at
    timestamptz delivered_at
    timestamptz rejected_at
    timestamptz cancelled_at
    timestamptz failed_at
    timestamptz created_at
    timestamptz updated_at
    text idempotency_key
    text request_hash
    text reject_reason
    timestamptz sla_sms_at
    timestamptz sla_flagged_at
    int4 rider_earnings_centavos
    int4 dispatch_attempts
    timestamptz dispatch_flagged_at
    timestamptz arrived_store_at
    text delivery_proof_path
  }
  order_items {
    uuid id PK
    uuid order_id FK
    uuid menu_item_id FK
    text name_snapshot
    int4 unit_price_centavos
    int4 modifiers_unit_centavos
    int4 quantity
    jsonb modifiers_snapshot
    text note
    int4 line_total_centavos
    timestamptz created_at
  }
  order_events {
    int8 id PK
    uuid order_id FK
    order_status from_status
    order_status to_status
    uuid actor_id
    app_role actor_role
    jsonb meta
    timestamptz created_at
  }
  order_status_transitions {
    order_status from_status PK
    order_status to_status PK
  }
  dispatch_offers {
    uuid id PK
    uuid order_id FK, UK
    uuid rider_id FK, UK
    dispatch_offer_status status
    int4 rider_earnings_centavos
    timestamptz offered_at
    timestamptz expires_at
    timestamptz responded_at
  }
```

## Payments and money

```mermaid
erDiagram
  orders |o--o{ ledger_entries : "order_id"
  orders ||--o| order_delivery_pins : "order_id"
  orders ||--o| payments : "order_id"
  orders ||--o{ refunds : "order_id"
  payments ||--o{ refunds : "payment_id"
  profiles |o--o{ refunds : "requested_by"
  order_delivery_pins {
    uuid order_id PK, FK
    text pin
    timestamptz created_at
  }
  payments {
    uuid id PK
    uuid order_id FK
    text gateway UK
    text intent_id UK
    text gateway_ref
    int4 amount_centavos
    payment_status status
    payment_method method
    timestamptz created_at
    timestamptz updated_at
    text checkout_url
    text gateway_payment_id
    int4 fee_centavos
    int4 refunded_centavos
    timestamptz paid_at
  }
  refunds {
    uuid id PK
    uuid order_id FK
    uuid payment_id FK
    int4 amount_centavos
    text reason
    refund_status status
    text gateway_ref
    uuid requested_by FK
    timestamptz created_at
    timestamptz updated_at
  }
  webhook_events {
    uuid id PK
    text gateway UK
    text event_id UK
    text type
    jsonb payload
    timestamptz received_at
    timestamptz processed_at
    text error
  }
  ledger_entries {
    int8 id PK
    uuid txn_id
    ledger_account account
    ledger_party party_type
    uuid party_id
    int4 debit_centavos
    int4 credit_centavos
    uuid order_id FK
    text memo
    timestamptz created_at
  }
  payouts {
    uuid id PK
    ledger_party party_type UK
    uuid party_id UK
    date period_start UK
    date period_end UK
    int4 amount_centavos
    payout_status status
    text reference
    timestamptz paid_at
    timestamptz created_at
    timestamptz updated_at
  }
```

## Engagement and operations

```mermaid
erDiagram
  profiles ||--o{ device_push_subscriptions : "user_id"
  profiles |o--o{ feature_flags : "updated_by"
  zones ||--o{ fee_rules : "zone_id"
  profiles ||--o{ loyalty_stamps : "customer_id"
  orders ||--o| loyalty_stamps : "order_id"
  orders |o--o{ loyalty_stamps : "redeemed_order_id"
  orders |o--o{ notifications : "order_id"
  profiles ||--o{ notifications : "user_id"
  orders ||--o| promo_redemptions : "order_id"
  promos ||--o{ promo_redemptions : "promo_id"
  profiles ||--o{ promo_redemptions : "user_id"
  merchants |o--o{ promos : "merchant_id"
  zones |o--o{ promos : "zone_id"
  profiles ||--o{ ratings : "from_user_id"
  orders ||--o{ ratings : "order_id"
  orders |o--o{ referrals : "qualifying_order_id"
  profiles ||--o| referrals : "referee_id"
  profiles ||--o{ referrals : "referrer_id"
  waitlist_signups {
    uuid id PK
    text name
    text phone
    text email
    text barangay
    text city
    geography location
    timestamptz created_at
  }
  ratings {
    uuid id PK
    uuid order_id FK, UK
    uuid from_user_id FK, UK
    rating_target target_type UK
    uuid target_id
    int2 score
    text_array tags
    text comment
    timestamptz created_at
  }
  promos {
    uuid id PK
    text code UK
    promo_type type
    int4 discount_bps
    int4 discount_centavos
    int4 max_discount_centavos
    int4 min_subtotal_centavos
    timestamptz starts_at
    timestamptz ends_at
    int4 max_redemptions
    int4 per_user_limit
    uuid zone_id FK
    uuid merchant_id FK
    text funded_by
    bool is_active
    timestamptz created_at
    timestamptz updated_at
    bool is_featured
  }
  promo_redemptions {
    uuid id PK
    uuid promo_id FK
    uuid user_id FK
    uuid order_id FK, UK
    int4 discount_centavos
    timestamptz created_at
  }
  referrals {
    uuid id PK
    uuid referrer_id FK
    uuid referee_id FK, UK
    text code
    text status
    uuid qualifying_order_id FK
    int4 reward_centavos
    timestamptz created_at
    timestamptz qualified_at
  }
  loyalty_stamps {
    uuid id PK
    uuid customer_id FK
    uuid order_id FK, UK
    timestamptz created_at
    timestamptz redeemed_at
    uuid redeemed_order_id FK
  }
  device_push_subscriptions {
    uuid id PK
    uuid user_id FK
    text endpoint UK
    text p256dh
    text auth
    text user_agent
    timestamptz created_at
    timestamptz last_used_at
  }
  notifications {
    uuid id PK
    uuid user_id FK
    notification_channel channel
    text template
    jsonb payload
    uuid order_id FK
    text status
    text error
    timestamptz sent_at
    timestamptz read_at
    timestamptz created_at
  }
  audit_logs {
    int8 id PK
    uuid actor_id
    app_role actor_role
    text action
    text entity_type
    uuid entity_id
    jsonb meta
    inet ip
    timestamptz created_at
  }
  feature_flags {
    text key PK
    text description
    bool enabled
    jsonb rollout
    uuid updated_by FK
    timestamptz updated_at
  }
  fee_rules {
    uuid id PK
    uuid zone_id FK
    text name
    fee_rule_kind kind
    int4 min_distance_m
    int4 max_distance_m
    int4 min_subtotal_centavos
    int4 fee_centavos
    int4 priority
    bool is_active
    timestamptz created_at
    timestamptz updated_at
  }
```

## Row-level security policies

Every table has RLS on. Policies decide which rows each role sees; column grants
(`supabase/migrations/20261105800000_geo_and_grants.sql`) decide what clients may change.
Role helpers live in the `private` schema (`has_role`, `is_admin`, `is_merchant_member`,
`coordinates_zone`, `current_rider_id`, …).

| Table | RLS | Policies |
|---|---|---|
| `addresses` | on | `addresses_admin_select` (select · authenticated)<br>`addresses_owner_all` (all · authenticated) |
| `audit_logs` | on | `audit_logs_select_admin` (select · authenticated) |
| `device_push_subscriptions` | on | `device_push_subscriptions_own` (all · authenticated) |
| `dispatch_offers` | on | `dispatch_offers_select` (select · authenticated) |
| `feature_flags` | on | `feature_flags_select` (select · authenticated) |
| `fee_rules` | on | `fee_rules_select` (select · anon, authenticated) |
| `invites` | on | `invites_select` (select · authenticated) |
| `ledger_entries` | on | `ledger_entries_select` (select · authenticated) |
| `loyalty_stamps` | on | `loyalty_stamps_select` (select · authenticated) |
| `menu_categories` | on | `menu_categories_member_write` (all · authenticated)<br>`menu_categories_select` (select · anon, authenticated) |
| `menu_items` | on | `menu_items_member_write` (all · authenticated)<br>`menu_items_select` (select · anon, authenticated) |
| `merchant_applications` | on | `merchant_applications_admin_select` (select · authenticated)<br>`merchant_applications_coordinator_select` (select · authenticated) |
| `merchant_closures` | on | `merchant_closures_member_write` (all · authenticated)<br>`merchant_closures_select` (select · anon, authenticated) |
| `merchants` | on | `merchants_select` (select · anon, authenticated)<br>`merchants_update_member` (update · authenticated) |
| `modifier_groups` | on | `modifier_groups_member_write` (all · authenticated)<br>`modifier_groups_select` (select · anon, authenticated) |
| `modifier_options` | on | `modifier_options_member_write` (all · authenticated)<br>`modifier_options_select` (select · anon, authenticated) |
| `notifications` | on | `notifications_mark_read` (update · authenticated)<br>`notifications_select` (select · authenticated) |
| `order_delivery_pins` | on | `order_delivery_pins_select_customer` (select · authenticated) |
| `order_events` | on | `order_events_select` (select · authenticated) |
| `order_items` | on | `order_items_select` (select · authenticated) |
| `order_status_transitions` | on | `order_status_transitions_read` (select · anon, authenticated) |
| `orders` | on | `orders_select` (select · authenticated) |
| `payments` | on | `payments_select` (select · authenticated) |
| `payouts` | on | `payouts_select` (select · authenticated) |
| `profiles` | on | `profiles_select_own` (select · authenticated)<br>`profiles_select_zone_riders` (select · authenticated)<br>`profiles_update_own` (update · authenticated) |
| `promo_redemptions` | on | `promo_redemptions_select` (select · authenticated) |
| `promos` | on | `promos_select_admin` (select · authenticated) |
| `ratings` | on | `ratings_insert_customer` (insert · authenticated)<br>`ratings_select` (select · authenticated) |
| `referrals` | on | `referrals_select` (select · authenticated) |
| `refunds` | on | `refunds_select` (select · authenticated) |
| `rider_kyc_documents` | on | `rider_kyc_insert_self` (insert · authenticated)<br>`rider_kyc_select_admin` (select · authenticated) |
| `rider_location_breadcrumbs` | on | `breadcrumbs_insert_self` (insert · authenticated)<br>`breadcrumbs_select` (select · authenticated) |
| `rider_locations` | on | `rider_locations_insert_self` (insert · authenticated)<br>`rider_locations_select` (select · authenticated)<br>`rider_locations_select_customer_delivery` (select · authenticated)<br>`rider_locations_update_self` (update · authenticated) |
| `riders` | on | `riders_select` (select · authenticated)<br>`riders_select_customer_delivery` (select · authenticated)<br>`riders_update_self` (update · authenticated) |
| `user_roles` | on | `user_roles_select` (select · authenticated) |
| `waitlist_signups` | on | `waitlist_signups_admin_select` (select · authenticated) |
| `webhook_events` | on | none: server only |
| `zones` | on | `zones_select` (select · anon, authenticated) |
