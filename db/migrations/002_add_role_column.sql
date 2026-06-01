-- 002: Add role column to users table
-- Adds admin/user role support introduced after initial schema

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user'));
