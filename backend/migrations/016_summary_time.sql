-- Admin-configured daily summary time-of-day (24h 'HH:MM', local to each user's timezone).
ALTER TABLE global_settings ADD COLUMN summary_time text NOT NULL DEFAULT '08:00';
