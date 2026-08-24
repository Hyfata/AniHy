ALTER TABLE jobs
  ADD COLUMN subtitle_offset DECIMAL(10,3) DEFAULT 0 AFTER trim_seconds;
