-- Phase 4.1: accept every Philippine mobile prefix, not only 09xx.
-- Mobiles are +63 followed by 10 digits starting with 9 (0917, 0991, ...) or 8 (Globe 0817,
-- DITO 0895-0898). The app normalises numbers with the same rule
-- (packages/core/src/auth/phone.ts); these checks are the database's last line of defence.

alter table public.merchant_applications drop constraint merchant_applications_phone_check;
alter table public.merchant_applications
  add constraint merchant_applications_phone_check check (phone ~ '^\+63[89][0-9]{9}$');

alter table public.waitlist_signups drop constraint waitlist_signups_phone_check;
alter table public.waitlist_signups
  add constraint waitlist_signups_phone_check check (phone ~ '^\+63[89][0-9]{9}$');
