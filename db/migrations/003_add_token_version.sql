-- 003: Session revocation
-- Every JWT carries the user's token_version; bumping it (password change,
-- sign out everywhere) invalidates all previously issued tokens.

ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
