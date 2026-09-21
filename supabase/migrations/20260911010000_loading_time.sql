-- Taza Logistics — adds learned per-vehicle loading time and actual
-- Start/End Load punch timestamps, so route planning can work backward
-- from the 16:30 close time through loading time, not just drive time.

alter table vehicles add column avg_loading_minutes double precision not null default 30;

alter table trips add column load_started_at timestamptz;
alter table trips add column load_ended_at timestamptz;
