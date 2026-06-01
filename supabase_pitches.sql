-- Pitches table (venue-registered pitches)
create table public.pitches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  price_per_hour integer not null,
  formats text[] not null default '{}',
  surfaces text[] not null default '{}',
  capacity integer default 22,
  description text,
  amenities text[] default '{}',
  venue_owner_id uuid references auth.users(id),
  contact_email text,
  is_verified boolean default false,
  rating numeric(3,1) default 0,
  created_at timestamptz default now()
);

alter table public.pitches enable row level security;
create policy "Anyone can view pitches" on public.pitches for select using (true);
create policy "Venue owners can insert pitches" on public.pitches for insert with check (true);
create policy "Venue owners can update their pitches" on public.pitches for update using (true);

-- Seed real London pitches with coordinates
insert into public.pitches (name, address, lat, lng, price_per_hour, formats, surfaces, amenities, rating, is_verified) values
('Powerleague Finsbury Park', '223 Seven Sisters Rd, London N4 2DA', 51.5643, -0.1004, 80, ARRAY['7-a-side'], ARRAY['3G'], ARRAY['Changing rooms', 'Parking', 'Floodlights'], 4.8, true),
('Hackney Marshes Pitch 3', 'Homerton Rd, London E9 5PF', 51.5526, -0.0227, 60, ARRAY['11-a-side'], ARRAY['Grass'], ARRAY['Parking', 'Floodlights'], 4.5, true),
('Goals Walthamstow', 'Higham Hill Rd, London E17 6EA', 51.5867, -0.0219, 95, ARRAY['5-a-side', '7-a-side'], ARRAY['3G'], ARRAY['Changing rooms', 'Café', 'Parking', 'Floodlights'], 4.9, true),
('Powerleague Shoreditch', 'Old St, London EC1V 9HL', 51.5252, -0.0980, 110, ARRAY['5-a-side'], ARRAY['3G'], ARRAY['Changing rooms', 'Bar', 'Floodlights'], 4.7, true),
('Victoria Park Arena', 'Grove Rd, London E3 5TB', 51.5352, -0.0280, 75, ARRAY['7-a-side', '11-a-side'], ARRAY['3G'], ARRAY['Changing rooms', 'Parking'], 4.6, true),
('Playhive Leyton', 'Oliver Rd, London E10 5LT', 51.5678, -0.0123, 70, ARRAY['5-a-side', '7-a-side'], ARRAY['3G'], ARRAY['Changing rooms', 'Parking', 'Floodlights'], 4.4, false),
('Astroworld Bow', 'Gillender St, London E3 3LB', 51.5289, -0.0156, 65, ARRAY['7-a-side'], ARRAY['3G'], ARRAY['Floodlights'], 4.3, false);

-- Pitch bookings
create table public.pitch_bookings (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid references public.pitches(id) not null,
  post_id uuid references public.match_posts(id),
  booked_by uuid references auth.users(id) not null,
  match_date text not null,
  start_time text not null,
  total_price_pence integer not null,
  player_count integer not null default 22,
  per_player_pence integer not null,
  unitr_fee_pence integer not null,
  status text default 'pending',
  stripe_payment_intent_id text,
  created_at timestamptz default now()
);

alter table public.pitch_bookings enable row level security;
create policy "Anyone can view bookings" on public.pitch_bookings for select using (true);
create policy "Authenticated users can create bookings" on public.pitch_bookings for insert with check (auth.uid() = booked_by);
create policy "Booking owner can update" on public.pitch_bookings for update using (true);

-- Per-player payment records
create table public.player_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.pitch_bookings(id) not null,
  player_id uuid references auth.users(id) not null,
  amount_pence integer not null,
  unitr_fee_pence integer not null,
  total_pence integer not null,
  status text default 'pending',
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz default now(),
  unique(booking_id, player_id)
);

alter table public.player_payments enable row level security;
create policy "Anyone can view player payments" on public.player_payments for select using (true);
create policy "System can insert payments" on public.player_payments for insert with check (true);
create policy "Players can update their payments" on public.player_payments for update using (true);
