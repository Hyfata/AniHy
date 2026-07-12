ALTER TABLE jobs
  ADD COLUMN source_type ENUM('download','upload') NOT NULL DEFAULT 'download' AFTER trim_seconds,
  ADD COLUMN source_file VARCHAR(500) DEFAULT NULL AFTER source_type;
