-- Money collected outside a booking's own line items, e.g. PKR cash for extra guests on an
-- Airbnb (USD) stay. Revenue and cash on its received date. (New enum values must be committed
-- before use, so the views that use it are in the next migration.)
alter type public.payment_kind add value if not exists 'extra_charge';

-- vendor quotes get an import key like the other imported tables
alter table public.vendor_quotes add column if not exists import_key text unique;
