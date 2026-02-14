-- Create surveys table
create table public.surveys (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  title text not null,
  admin_id uuid default auth.uid(), -- References the admin who created it
  status text default 'pending', -- 'pending', 'published', 'completed'
  fields jsonb default '[]'::jsonb, -- Array of field definitions for dynamic forms
  raw_data jsonb default '{}'::jsonb -- Stores raw extracted data or file references
);

-- Create responses table
create table public.responses (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  survey_id uuid references public.surveys(id) on delete cascade not null,
  user_id uuid default auth.uid(), -- References the user who responded
  answers jsonb default '{}'::jsonb, -- Key-value pairs of answers
  status text default 'in_progress' -- 'in_progress', 'submitted'
);

-- Enable Row Level Security (RLS)
alter table public.surveys enable row level security;
alter table public.responses enable row level security;

-- Policies for Surveys
-- Admins (anyone for this demo, or specific roles) can create/view surveys
create policy "Enable read access for all users" on public.surveys for select using (true);
create policy "Enable insert for authenticated users" on public.surveys for insert with check (auth.role() = 'authenticated');
create policy "Enable update for owners" on public.surveys for update using (auth.uid() = admin_id);

-- Policies for Responses
-- Users can view/edit their own responses
create policy "Users can see own responses" on public.responses for select using (auth.uid() = user_id);
create policy "Users can insert own responses" on public.responses for insert with check (auth.uid() = user_id);
create policy "Users can update own responses" on public.responses for update using (auth.uid() = user_id);
