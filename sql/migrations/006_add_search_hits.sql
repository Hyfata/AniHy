USE anime_site;

CREATE TABLE IF NOT EXISTS search_hits (
    anime_id INT PRIMARY KEY,
    hit_count INT NOT NULL DEFAULT 1,
    last_hit_at DATETIME NOT NULL,
    FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
