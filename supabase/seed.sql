-- MediNova Module 2: combined seed entrypoint.
-- Run order: seed_01_catalog.sql -> seed_02_doctors.sql -> seed_03_postings.sql
-- This file keeps `supabase seed` / docs pointing at one place.

\ir seed_01_catalog.sql
\ir seed_02_doctors.sql
\ir seed_03_postings.sql
