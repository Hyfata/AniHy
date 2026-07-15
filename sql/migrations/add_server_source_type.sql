ALTER TABLE jobs MODIFY COLUMN source_type ENUM('download','upload','server') NOT NULL DEFAULT 'download';
