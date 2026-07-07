CREATE DATABASE IF NOT EXISTS anime_site
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE anime_site;

CREATE TABLE IF NOT EXISTS animes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    cover_image VARCHAR(500) NOT NULL,
    description TEXT,
    season_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS episodes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    anime_id INT NOT NULL,
    episode_number INT NOT NULL,
    title VARCHAR(255),
    file_path VARCHAR(500) NOT NULL,
    has_subtitle BOOLEAN DEFAULT FALSE,
    en_subtitle_file VARCHAR(500),
    subtitle_file VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_episode (anime_id, episode_number),
    FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    anime_id INT NOT NULL,
    episode_number INT NOT NULL,
    season_id VARCHAR(100) NOT NULL,
    episode_title VARCHAR(255),
    subtitle_file VARCHAR(500),
    status ENUM('pending','downloading','downloading_subs','preparing','encoding','remuxing','subtitling','completed','failed')
        DEFAULT 'pending',
    message TEXT,
    progress INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
