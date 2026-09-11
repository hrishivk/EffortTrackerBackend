import { QueryTypes } from "sequelize";
import { Database } from "../connection/db/dbConnection";
import { Task } from "../connection/models/tasks";
import { DailyTaskLog } from "../connection/models/daily_task_logs";
import { MAX_COMMENT_LENGTH, TaskComment } from "../types/task.types";

// The one thing that must be right (section 5 of the request).
//
// Every write below is a SINGLE UPDATE statement whose new value is computed
// from the column by Postgres: `comments || :element` to append, and a
// jsonb_agg over jsonb_array_elements to edit or delete. Nothing reads the
// array into Node, mutates it and writes it back.
//
// That is not a style preference. This feature is three or more people
// commenting on one task at the same moment. A read-modify-write there loses a
// comment every time two land between one process's SELECT and its UPDATE, and
// it loses it silently: the author sees their comment posted, and it is gone on
// the next refresh. A single statement cannot lose one. Postgres takes the row
// lock, and under READ COMMITTED a statement blocked by a concurrent update
// re-evaluates its qual and its SET expressions against the row version that
// update produced.
//
// Edit and delete address the element BY ITS id, never by an array index. An
// index computed from a prior read would point at the wrong comment if another
// write shifted the array in between; matching on id cannot.
//
// The same rule is why Task.save() never carries this column - see the explicit
// `fields` lists in user.repository.

// Raw SQL has to name the schema itself. Hardcoded to `tracker`, deliberately
// NOT read from envConfig.DB_SCHEMA: that value is only the connection-level
// default, and every model overrides it with a literal `schema: "tracker"`. So
// the tables are always in tracker regardless of what DB_SCHEMA says, and
// reading the env var here would point these three statements at a different
// schema from the one the models write to. The migrations hardcode it for the
// same reason.
const TASKS = `"tracker".tasks`;

const generateCommentId = (): string => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const body = Array.from({ length: 12 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
  return `c_${body}`;
};

// Plain text for now. Control characters are stripped rather than rejected -
// they arrive from a paste, not from intent - and the 2000-character cap is
// applied after trimming, so trailing whitespace cannot push a legitimate
// comment over it. Newline, carriage return and tab survive; everything else
// below 32, and DEL, is dropped. Filtered by code point rather than a regex
// character class so the intent stays readable.
export const normalizeCommentBody = (input: unknown): string => {
  if (typeof input !== "string") return "";
  const cleaned = Array.from(input)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      if (code === 9 || code === 10 || code === 13) return true;
      return code >= 32 && code !== 127;
    })
    .join("");
  return cleaned.trim().slice(0, MAX_COMMENT_LENGTH);
};

export class TaskCommentRepository {
  // Appends one comment and returns it. The `||` is the whole point: two
  // concurrent appends serialise into two elements, in whichever order the
  // database commits them, and neither is lost.
  //
  // `comments` is NOT NULL DEFAULT '[]' (migration 018) precisely so this
  // expression is safe. NULL || anything is NULL, which would have swallowed
  // the first comment on every task that existed before the column did.
  public async append(
    task_id: string,
    author: { id: string; fullName?: string | null },
    body: string
  ): Promise<TaskComment | null> {
    try {
      const sequelize = Database.getSequelize();
      const comment: TaskComment = {
        id: generateCommentId(),
        user_id: author.id,
        user_name: author.fullName ?? null,
        body,
        created_at: new Date().toISOString(),
        updated_at: null,
      };

      const [rows]: any = await sequelize.query(
        `UPDATE ${TASKS}
            SET comments = comments || CAST(:element AS jsonb),
                updated_at = NOW()
          WHERE id = :task_id
          RETURNING id`,
        { replacements: { element: JSON.stringify([comment]), task_id } }
      );

      // No row means the task was deleted between the read that authorised this
      // call and the write.
      if (!rows || rows.length === 0) return null;
      return comment;
    } catch (error) {
      console.error("Error appending task comment:", error);
      throw error;
    }
  }

  // Rewrites one element in place, matched by id, preserving array order.
  //
  // The author check is IN THE STATEMENT, not only in the service: the WHERE
  // EXISTS clause means a request from anyone but the author updates zero rows,
  // however the call was routed. The service still pre-reads the element, but
  // only to tell a 403 from a 404 - that read is not what enforces the rule.
  public async edit(
    task_id: string,
    comment_id: string,
    user_id: string,
    body: string
  ): Promise<TaskComment | null> {
    try {
      const sequelize = Database.getSequelize();
      const now = new Date().toISOString();

      const [rows]: any = await sequelize.query(
        `UPDATE ${TASKS} t
            SET comments = (
                  SELECT COALESCE(
                           jsonb_agg(
                             CASE WHEN e.elem ->> 'id' = :comment_id
                                  THEN e.elem || jsonb_build_object(
                                         'body', CAST(:body AS text),
                                         'updated_at', CAST(:now AS text))
                                  ELSE e.elem
                             END
                             ORDER BY e.ord
                           ), CAST('[]' AS jsonb))
                    FROM jsonb_array_elements(t.comments)
                         WITH ORDINALITY AS e(elem, ord)
                ),
                updated_at = NOW()
          WHERE t.id = :task_id
            AND EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements(t.comments) AS x(elem)
                   WHERE x.elem ->> 'id' = :comment_id
                     AND x.elem ->> 'user_id' = :user_id
                )
          RETURNING (
            SELECT y.elem
              FROM jsonb_array_elements(t.comments) AS y(elem)
             WHERE y.elem ->> 'id' = :comment_id
             LIMIT 1
          ) AS comment`,
        { replacements: { task_id, comment_id, user_id, body, now } }
      );

      if (!rows || rows.length === 0) return null;
      return rows[0].comment as TaskComment;
    } catch (error) {
      console.error("Error editing task comment:", error);
      throw error;
    }
  }

  // Removes one element by id. `allow_any` is set when the caller created the
  // task - the contract lets a task's creator delete anybody's comment on it -
  // so the author condition is relaxed by a bound parameter rather than by
  // building a second statement.
  public async remove(
    task_id: string,
    comment_id: string,
    user_id: string,
    allow_any: boolean
  ): Promise<boolean> {
    try {
      const sequelize = Database.getSequelize();

      const [rows]: any = await sequelize.query(
        `UPDATE ${TASKS} t
            SET comments = (
                  SELECT COALESCE(jsonb_agg(e.elem ORDER BY e.ord),
                                  CAST('[]' AS jsonb))
                    FROM jsonb_array_elements(t.comments)
                         WITH ORDINALITY AS e(elem, ord)
                   WHERE e.elem ->> 'id' <> :comment_id
                ),
                updated_at = NOW()
          WHERE t.id = :task_id
            AND EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements(t.comments) AS x(elem)
                   WHERE x.elem ->> 'id' = :comment_id
                     AND (CAST(:allow_any AS boolean) = TRUE
                          OR x.elem ->> 'user_id' = :user_id)
                )
          RETURNING t.id`,
        { replacements: { task_id, comment_id, user_id, allow_any } }
      );

      return !!rows && rows.length > 0;
    } catch (error) {
      console.error("Error deleting task comment:", error);
      throw error;
    }
  }

  // One element, read for the sole purpose of choosing between 403 and 404.
  // Never used to compute a new array - see the header comment.
  public async findComment(
    task_id: string,
    comment_id: string
  ): Promise<TaskComment | null> {
    try {
      const sequelize = Database.getSequelize();
      const rows: any[] = await sequelize.query(
        `SELECT e.elem AS comment
           FROM ${TASKS} t,
                jsonb_array_elements(t.comments) AS e(elem)
          WHERE t.id = :task_id
            AND e.elem ->> 'id' = :comment_id
          LIMIT 1`,
        { replacements: { task_id, comment_id }, type: QueryTypes.SELECT }
      );
      return rows.length ? (rows[0].comment as TaskComment) : null;
    } catch (error) {
      console.error("Error reading task comment:", error);
      throw error;
    }
  }

  // The task a comment is being written to, with its daily log attached.
  //
  // The log is not optional here: assignment and authorship live on it, so it
  // is what answers both "may this person read the task" and "did this person
  // create it" (the delete rule).
  public async findTask(task_id: string): Promise<Task | null> {
    try {
      return await Task.findByPk(task_id, {
        include: [
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: ["id", "created_by", "assigned_to"],
          },
        ],
      });
    } catch (error) {
      throw error;
    }
  }
}
