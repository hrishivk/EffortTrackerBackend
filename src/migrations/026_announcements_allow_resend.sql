-- Migration: announcements can be re-sent
--
-- Run AFTER 025.
--
-- 025 made announcements.version UNIQUE so a release could only be announced
-- once. SP can now send the same version again at any time, and each send
-- is its own row, so the constraint goes.
--
-- announcements_version_key is the name Postgres gives the inline UNIQUE in
-- 025, and also what sequelize.sync() produces from `unique: true`, so this
-- covers the table whichever way it was created. sync() never drops a
-- constraint by itself, so removing `unique` from the model is not enough.
ALTER TABLE tracker.announcements
  DROP CONSTRAINT IF EXISTS announcements_version_key;

-- The newest send of one version.
CREATE INDEX IF NOT EXISTS announcements_version_created_at
  ON tracker.announcements(version, created_at DESC);
