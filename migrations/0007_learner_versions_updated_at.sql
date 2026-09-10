-- Add updated_at tracking to learner_versions so the learning pipeline can
-- refresh training-experience counts without failing on missing columns.

alter table learner_versions
  add column if not exists updated_at timestamptz not null default now();
