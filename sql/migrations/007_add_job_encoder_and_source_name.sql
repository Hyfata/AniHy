ALTER TABLE jobs
    ADD COLUMN encoder VARCHAR(20) NULL AFTER worker_pid,
    ADD COLUMN source_name VARCHAR(500) NULL AFTER encoder;
