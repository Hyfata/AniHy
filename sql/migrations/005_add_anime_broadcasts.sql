USE anime_site;

CREATE TABLE IF NOT EXISTS anime_broadcasts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    anime_id INT NOT NULL,
    broadcast_year INT NOT NULL,
    broadcast_quarter TINYINT NOT NULL,
    UNIQUE KEY unique_broadcast (anime_id, broadcast_year, broadcast_quarter),
    FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO anime_broadcasts (anime_id, broadcast_year, broadcast_quarter)
SELECT id, broadcast_year, broadcast_quarter FROM animes
WHERE broadcast_year IS NOT NULL AND broadcast_quarter IS NOT NULL
ON DUPLICATE KEY UPDATE anime_id = anime_id;
