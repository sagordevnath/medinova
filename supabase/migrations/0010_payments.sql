-- Module 12 payment hardening: receipts, idempotency and provider methods.
alter table public.payments add column if not exists receipt_number text;
create unique index if not exists payments_provider_ref_unique on public.payments(provider_ref) where provider_ref is not null;
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('cash','bkash','nagad','card','sslcommerz'));
