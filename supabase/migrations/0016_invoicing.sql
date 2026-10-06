-- ============================================================================
-- Module 16: invoicing + patient statements.
-- Run AFTER 0015_tenant_rls.sql.
--
-- Why: payments alone cannot bill a clinic. A visit can be a consultation plus
-- tests, discounted and partly paid, and the patient needs a document they can
-- keep. This adds invoices with line items and a running per-patient balance.
--
-- Money is stored as BIGINT paisa everywhere. Never use float for currency.
-- ============================================================================

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  -- Tenant owner. Mirrors appointments.org_id so RLS is a plain equality test.
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  -- Who the invoice is for. NOT the same as owner_id: one account can manage
  -- several family members (see patients.owner_id).
  patient_id uuid not null references public.patients(id) on delete restrict,
  -- Optional link when the invoice came from a consultation.
  appointment_id uuid references public.appointments(id) on delete set null,
  -- Human-facing and immutable once issued.
  number text not null unique,
  status text not null default 'issued'
    check (status in ('draft', 'issued', 'part_paid', 'paid', 'void', 'refunded')),
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  currency text not null default 'BDT',
  subtotal_paisa bigint not null default 0 check (subtotal_paisa >= 0),
  discount_paisa bigint not null default 0 check (discount_paisa >= 0),
  -- Absolute amount, not a percentage rate, so rounding can never drift.
  tax_paisa bigint not null default 0 check (tax_paisa >= 0),
  total_paisa bigint not null default 0 check (total_paisa >= 0),
  paid_paisa bigint not null default 0 check (paid_paisa >= 0),
  balance_paisa bigint not null default 0,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One invoice per appointment: prevents double-billing a consultation.
create unique index if not exists invoices_one_per_appointment_idx
  on public.invoices (appointment_id)
  where appointment_id is not null and status <> 'void';

create index if not exists invoices_patient_idx on public.invoices (patient_id, issued_at desc);
create index if not exists invoices_org_idx on public.invoices (org_id, issued_at desc);
create index if not exists invoices_appointment_idx on public.invoices (appointment_id);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  description text not null,
  -- What this line refers to: a consultation fee, a service, or a package.
  kind text not null default 'fee' check (kind in ('fee', 'service', 'package', 'discount', 'other')),
  service_id uuid references public.services(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  -- Price snapshot at issue time. Changing a doctor's fee later must never
  -- rewrite an invoice already handed to the patient.
  unit_price_paisa bigint not null default 0 check (unit_price_paisa >= 0),
  quantity int not null default 1 check (quantity >= 1),
  discount_paisa bigint not null default 0 check (discount_paisa >= 0),
  line_total_paisa bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- 2. Invoice numbering -------------------------------------------------------
-- Per organisation, per Bangladeshi financial year (starts 1 July).
create or replace function public.next_invoice_number(p_org uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_seq int;
  v_fy text;
  v_slug text;
begin
  -- Serialise numbering per organisation. Without this lock two receptionists
  -- issuing at the same moment can compute the same sequence number and the
  -- unique index on invoices.number turns a correct invoice into a 500.
  select slug into v_slug from public.organizations where id = p_org for update;
  if v_slug is null then
    raise exception 'next_invoice_number: unknown organisation %', p_org;
  end if;

  v_fy := case
    when extract(month from now()) >= 7
      then extract(year from now())::text || '-' || lpad((extract(year from now())::int + 1)::text, 2, '0')
    else (extract(year from now())::int - 1)::text || '-' || lpad(extract(year from now())::text, 2, '0')
  end;

  -- +1 because count() ignores this new row. Scoped to the org and financial
  -- year so each tenant and each FY starts again at 1. The slug prefix keeps
  -- invoices.number globally unique while staying readable on a printed bill.
  select count(*) + 1 into v_seq
  from public.invoices
  where org_id = p_org
    and number like 'INV-' || v_slug || '-' || v_fy || '-%';

  return 'INV-' || v_slug || '-' || v_fy || '-' || lpad(v_seq::text, 5, '0');
end;
$$;

-- 3. Normalise payments to paisa --------------------------------------------
-- public.payments.amount was numeric(10,2) in TAKA while the invoicing module
-- (and subscriptions) use BIGINT paisa. Summing one against the other is wrong
-- by 100x, so convert the column in place. Existing rows keep their value:
-- 1200.50 taka becomes 120050 paisa.
--
-- Note: a GENERATED column cannot be used here — dropping its source column
-- drops it too. Copy into a plain column, then swap.
--
-- This block deliberately does NOT swallow exceptions. A silent failure here
-- leaves amount in taka while recalc_invoice() adds it to *_paisa columns, and
-- every invoice total comes out 100x too small with no error anywhere. Fail
-- loudly instead, and stay re-runnable by dropping the scratch column first.
do $$
declare
  v_col record;
begin
  select data_type, is_nullable
  into v_col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'payments' and column_name = 'amount';

  if v_col is null then
    raise exception 'payments.amount not found - did an earlier migration rename it?';
  elsif v_col.data_type = 'numeric' then
    alter table public.payments drop column if exists amount_paisa;
    alter table public.payments add column amount_paisa bigint;
    update public.payments set amount_paisa = round(amount * 100)::bigint;
    alter table public.payments drop column amount;
    alter table public.payments alter column amount_paisa set not null;
    alter table public.payments rename column amount_paisa to amount;
    alter table public.payments
      add constraint payments_amount_nonneg check (amount >= 0);
    raise notice 'payments.amount converted from taka to paisa';
  elsif v_col.data_type = 'bigint' then
    raise notice 'payments.amount is already paisa, conversion skipped';
  else
    raise exception 'payments.amount has unexpected type % - refusing to convert', v_col.data_type;
  end if;
end $$;

-- 4. Recompute the invoice header from its items ----------------------------
-- Single source of truth for the money columns. Call after any item change so
-- the stored total always reconciles with the printed document.
create or replace function public.recalc_invoice(p_invoice uuid)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invoices;
  v_gross bigint;
  v_disc bigint;
  v_paid bigint;
begin
  select coalesce(sum(line_total_paisa), 0) into v_gross
  from public.invoice_items where invoice_id = p_invoice;
  select coalesce(sum(discount_paisa), 0) into v_disc
  from public.invoice_items where invoice_id = p_invoice;

  -- Only paid payments reduce the balance; a void invoice never settles.
  select coalesce(sum(p.amount), 0) into v_paid
  from public.payments p
  where p.invoice_id = p_invoice and p.status = 'paid';

  update public.invoices i set
    subtotal_paisa = greatest(v_gross - v_disc, 0),
    discount_paisa = v_disc,
    total_paisa    = greatest(v_gross - v_disc, 0) + i.tax_paisa,
    paid_paisa     = greatest(v_paid, 0),
    balance_paisa  = greatest(greatest(v_gross - v_disc, 0) + i.tax_paisa - greatest(v_paid, 0), 0),
    status = case
      when i.status in ('void', 'draft', 'refunded') then i.status
      when greatest(v_paid, 0) >= (greatest(v_gross - v_disc, 0) + i.tax_paisa)
        and (greatest(v_gross - v_disc, 0) + i.tax_paisa) > 0 then 'paid'
      when greatest(v_paid, 0) > 0 then 'part_paid'
      else 'issued'
    end,
    updated_at = now()
  where id = p_invoice
  returning * into v_inv;

  return v_inv;
end $$;

-- 4. RLS: an invoice is visible to its tenant's staff and to the patient -------
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

drop policy if exists "invoices patient read" on public.invoices;
create policy "invoices patient read" on public.invoices
  for select using (public.is_patient_owner(patient_id));

drop policy if exists "invoices org staff read" on public.invoices;
create policy "invoices org staff read" on public.invoices
  for select using (org_id is not null and public.is_org_member(org_id));

drop policy if exists "invoices org staff write" on public.invoices;
create policy "invoices org staff write" on public.invoices
  for insert with check (org_id is not null and public.is_org_member(org_id));

drop policy if exists "invoices org staff update" on public.invoices;
create policy "invoices org staff update" on public.invoices
  for update using (org_id is not null and public.is_org_member(org_id))
  with check (org_id is not null and public.is_org_member(org_id));

-- Items inherit the invoice's access; super_admin still has a FOR ALL policy.
drop policy if exists "invoice_items org staff all" on public.invoice_items;
create policy "invoice_items org staff all" on public.invoice_items
  for all using (org_id is not null and public.is_org_member(org_id))
  with check (org_id is not null and public.is_org_member(org_id));

-- 5. Trigger: keep invoice money in sync with its line items -----------------
create or replace function public.sync_invoice_on_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;

drop trigger if exists trg_invoice_items_sync on public.invoice_items;
create trigger trg_invoice_items_sync
  after insert or update or delete on public.invoice_items
  for each row execute function public.sync_invoice_on_item();

-- Payments are already stored against an appointment; link them to the
-- invoice too so recalc_invoice can attribute money correctly.
do $$ begin
  alter table public.payments add column if not exists invoice_id uuid references public.invoices(id) on delete set null;
exception when others then null;
end $$;

create index if not exists payments_invoice_idx on public.payments (invoice_id);