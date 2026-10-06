-- Module 16: Realtime queue updates for appointment and notification consumers.
do $$ begin
  alter publication supabase_realtime add table public.appointments;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;
