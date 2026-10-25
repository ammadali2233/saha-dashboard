-- Reference data that is configuration, not business records. No secrets, no guest data.

insert into public.settings (property_name, brand) values ('DHA Retreat', 'SAHA Residences');

insert into public.channels (name, code, platform_fee_pct, native_currency, color) values
  ('Airbnb', 'airbnb', 15.5, 'USD', '#e8505b'),
  ('Booking.com', 'booking_com', 15.0, 'PKR', '#1d4f91'),
  ('Direct', 'direct', 0, 'PKR', '#1f7a5c'),
  ('Other', 'other', 0, 'PKR', '#64748b');

insert into public.channel_secrets (channel_id)
  select id from public.channels where code in ('airbnb', 'booking_com');

-- Agreed ownership: 25% each (replaces the pro-rata rule; capital % is still reported).
insert into public.partners (name, agreed_share_pct, sort_order) values
  ('Ammad Ali', 25, 1),
  ('Hamza Mahad Dar', 25, 2),
  ('Mohammed Azeem', 25, 3),
  ('Saad Raza', 25, 4);

-- Rent is due on the 1st. The advance in setup costs covered 21 Sep to 31 Oct 2026.
-- Utilities and salary are paid by us but not yet known: amount stays null, so nothing is generated.
insert into public.recurring_expenses (category, item, amount, day_of_month, start_month, notes) values
  ('Rent', 'Monthly rent', 150000, 1, '2026-11-01', 'Advance rent in setup covered 21 Sep to 31 Oct 2026'),
  ('Electricity', 'Electricity bill', null, 1, null, 'Set amount and start month to begin generating'),
  ('Gas', 'Gas bill', null, 1, null, 'Set amount and start month to begin generating'),
  ('Water', 'Water bill', null, 1, null, 'Set amount and start month to begin generating'),
  ('Internet & TV', 'Internet and TV', null, 1, null, 'Set amount and start month to begin generating'),
  ('Staff Salary', 'Caretaker salary', null, 1, null, 'Set once a caretaker is hired');
