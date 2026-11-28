-- Migration: workspaces.announced_at
--
-- "Has anyone been told this workspace is done?" — read on page load so the
-- Announce it strip knows whether it has already been used, instead of
-- reverting to asking after every refresh.
--
-- Run AFTER 019 (which added the `completed` status and completed_at).
-- Guarded, so the file is safe to re-run.
--
-- ── Why a column and not a query ────────────────────────────────────────────
--
-- The same fact is derivable: COUNT the notifications with
-- type = 'workspace_completed' and reference_id = this workspace. That
-- derivation already backs the `completion_notice` detail block (who was told,
-- who has read it), and it stays the source of truth for that.
--
-- It is the wrong thing to ask on every workspace READ, though. It is a second
-- query per row, on a list where almost no workspace is completed, to answer a
-- yes/no the page needs before it can draw anything. A nullable timestamp on
-- the row answers it for free.
--
-- ── Why it is separate from completed_at ────────────────────────────────────
--
-- They are two different acts, which is the whole point of the separate
-- announce route. Setting a workspace to Completed tells nobody: who needs to
-- hear that a piece of work is done is a judgement the person finishing it
-- makes. So a workspace can legitimately be completed and never announced, and
-- collapsing the two into one column would lose that distinction.
--
-- It also means announced_at is NOT necessarily >= completed_at by much, and
-- may be re-stamped later: a reminder is a legitimate second announce, and this
-- records the MOST RECENT one.
ALTER TABLE tracker.workspaces
  ADD COLUMN IF NOT EXISTS announced_at TIMESTAMP WITH TIME ZONE;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- One narrow case: a workspace that was already announced through the earlier
-- bundled PATCH (status + notify_user_ids), before the dedicated route existed.
-- Those notifications were really sent, so the strip must not offer to announce
-- again as though nothing had happened.
--
-- Dated from the notification rows themselves rather than from completed_at —
-- the announce may have come later than the completion, and guessing would put
-- a wrong time on the page. Workspaces with no such notification stay NULL,
-- which is correct: nobody was told.
UPDATE tracker.workspaces w
   SET announced_at = latest.sent_at
  FROM (
        SELECT reference_id, MAX(created_at) AS sent_at
          FROM tracker.notifications
         WHERE type = 'workspace_completed'
           AND reference_id IS NOT NULL
         GROUP BY reference_id
       ) AS latest
 WHERE w.id = latest.reference_id
   AND w.announced_at IS NULL;

-- The "announced" filter, and the same partial-index reasoning as
-- idx_workspaces_completed_at: most workspaces have not been announced.
CREATE INDEX IF NOT EXISTS idx_workspaces_announced_at
  ON tracker.workspaces(announced_at) WHERE announced_at IS NOT NULL;
