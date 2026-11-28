-- Migration: assigned workspace managers
--
-- Run AFTER 023.
--
-- An AM who creates a workspace can hand the same rights to other AMs: open it
-- without the key, see every room, edit it, add rooms and members, complete
-- it. Deleting the workspace, and assigning or removing managers, stay with the
-- creator (and SP) — see WorkspaceService.
--
-- A join table rather than a second created_by-style column: a workspace can
-- have any number of managers, and created_by keeps meaning "who made it".
CREATE TABLE IF NOT EXISTS tracker.workspace_managers (
  workspace_id VARCHAR(20) NOT NULL
    REFERENCES tracker.workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(20) NOT NULL
    REFERENCES tracker.users(id) ON DELETE CASCADE,
  -- Who made the assignment. SET NULL, not CASCADE: the assignment outlives
  -- the person who recorded it, same rule as room_members.decided_by.
  assigned_by VARCHAR(20)
    REFERENCES tracker.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

-- The read path for the list's claim filter: "which workspaces does THIS user
-- manage". The primary key already covers lookups by workspace_id.
CREATE INDEX IF NOT EXISTS workspace_managers_user_id
  ON tracker.workspace_managers(user_id);
