USE anime_site;

ALTER TABLE animes
    ADD COLUMN broadcast_year INT NULL,
    ADD COLUMN broadcast_quarter TINYINT NULL,
    ADD COLUMN broadcast_day VARCHAR(10) NULL,
    ADD COLUMN download_url VARCHAR(500) NULL,
    ADD COLUMN namuwiki_url VARCHAR(500) NULL;
