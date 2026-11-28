-- Migration: release announcements
--
-- Run AFTER 024.
--
-- SP's "Notify everyone" on the What's New page. One row per release that was
-- announced; the bell notifications it fans out point back here through
-- notifications.reference_id. The banner reads the newest row.
--
-- version is UNIQUE here; 026 drops that so a release can be re-sent. Run
-- both.
CREATE TABLE IF NOT EXISTS tracker.announcements (
  id VARCHAR(20) PRIMARY KEY,
  version VARCHAR(20) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  message TEXT,
  -- SET NULL, not CASCADE: the announcement outlives the SP who sent it.
  created_by VARCHAR(20)
    REFERENCES tracker.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- The read path for GET /announcements/latest.
CREATE INDEX IF NOT EXISTS announcements_created_at
  ON tracker.announcements(created_at DESC);
