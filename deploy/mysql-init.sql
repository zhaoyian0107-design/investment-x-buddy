-- Run as your MySQL administrator. Replace the placeholder before use.
CREATE DATABASE IF NOT EXISTS investment_buddy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'buddy'@'localhost' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX ON investment_buddy.* TO 'buddy'@'localhost';
-- For a separate app host, use its specific address in place of localhost.
-- The application creates projects, memories, and worker_lease on first start.
