-- Unlimited services keep sales quantities but do not participate in physical inventory.
alter table public.products add column if not exists stock_unlimited boolean not null default false;
comment on column public.products.stock_unlimited is 'Quantity/revenue are recorded without checking, deducting, or restoring physical stock for new shipments.';
