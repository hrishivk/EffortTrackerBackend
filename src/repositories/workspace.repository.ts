import { Op, Transaction } from "sequelize";
import { Database } from "../connection/db/dbConnection";
import { Workspace } from "../connection/models/workspace";
import { Room } from "../connection/models/room";
import { RoomMember } from "../connection/models/room_member";
import { WorkspaceUnlock } from "../connection/models/workspace_unlock";
import { Project } from "../connection/models/project";
import { User } from "../connection/models/user";
import { Task } from "../connection/models/tasks";
import { Notification } from "../connection/models/notification";
import {
  NOTIFIABLE_ROLES,
  NotifyTarget,
  RoomCreateInput,
  RoomMemberStatus,
  RoomPatch,
  WorkspacePatch,
  WorkspaceTreeInput,
  WorkspaceViewer,
} from "../types/workspace.types";

// Raised when the caller's own user row no longer exists. Mapped to a 401 by
// the controller, because the only useful answer is "sign in again".
export const STALE_SESSION =
  "Your session is no longer valid. Please sign in again";

// Only `active` rows are membership. A pending request must never arrive as a
// member — it would show up on the room card and in every assignee list built
// from a room's people.
const ACTIVE = "active";

// The members embed, shared by every read. `through` carries `status` so the
// join row can be filtered; its attributes stay hidden so the shape the client
// receives is unchanged.
const membersInclude = () => ({
  model: User,
  as: "members",
  attributes: ["id", "fullName", "role"],
  through: { attributes: [], where: { status: ACTIVE } },
  required: false,
});

// What every single-workspace read embeds. `rooms[].members[]` travels with the
// workspace on purpose: the Review step and any later workspace screen need
// names, and returning bare ids would cost them an N+1 of user lookups.
//
// Every room is fetched; the caller's room scope is applied afterwards, in
// decorateWorkspace. It is NOT a WHERE here on purpose: a WHERE is applied once
// per query, and the list spans workspaces where the caller's scope differs —
// creator of one (all rooms), plain member of another (one room). Scoping in
// SQL blanked the rooms of a workspace the caller created but had not joined.
const workspaceInclude = () => [
  {
    model: Project,
    as: "project",
    attributes: ["id", "name"],
    required: false,
  },
  // Whoever marked the workspace completed. A join rather than a second query:
  // completed_by on its own is a bare id, and the badge beside the status has
  // to render a NAME. required: false because almost no workspace is completed.
  {
    model: User,
    as: "completedBy",
    attributes: ["id", "fullName", "email"],
    required: false,
  },
  {
    model: Room,
    as: "rooms",
    required: false,
    include: [membersInclude()],
  },
];

// Rooms in board order, members alphabetically inside each — a stable order, so
// the Review list does not reshuffle between reads.
const workspaceOrder: any = [
  [{ model: Room, as: "rooms" }, "position", "ASC"],
  [{ model: Room, as: "rooms" }, "created_at", "ASC"],
  [
    { model: Room, as: "rooms" },
    { model: User, as: "members" },
    "fullName",
    "ASC",
  ],
];

export class WorkspaceRepository {
  // ── Create ────────────────────────────────────────────────────────────────
  //
  // The wizard writes once, at step 4, so the whole tree goes in or none of it
  // does. A half-created workspace — rooms but no members, or a workspace with
  // no rooms — is unreachable from the UI: no screen can finish it, and the
  // user cannot retry without leaving the orphan behind.
  public async createTree(data: WorkspaceTreeInput) {
    const sequelize = Database.getSequelize();
    try {
      const created = await sequelize.transaction(async (t: Transaction) => {
        const workspace = await Workspace.create(
          {
            name: data.name,
            code: data.code ?? null,
            status: data.status,
            visibility: data.visibility,
            description: data.description ?? null,
            project_id: data.project_id,
            created_by: data.created_by,
          },
          { transaction: t }
        );

        for (const room of data.rooms) {
          const created = await Room.create(
            {
              workspace_id: workspace.id,
              // Denormalised from the workspace — one project per workspace
              // today, so every room inherits the same one.
              project_id: data.project_id,
              name: room.name,
              description: room.description ?? null,
              position: room.position,
            },
            { transaction: t }
          );

          if (room.member_ids.length > 0) {
            await RoomMember.bulkCreate(
              // active, not pending: a manager placing someone in a room IS
              // the approval. The wizard behaves exactly as it did before
              // room_members gained a status.
              room.member_ids.map((user_id) => ({
                room_id: created.id,
                workspace_id: workspace.id,
                user_id,
                status: ACTIVE,
              })),
              { transaction: t }
            );
          }
        }

        // Re-read inside the transaction so the caller gets server ids and the
        // embedded members in one round trip. The creator is by definition a
        // manager of what they just made, and sees every room.
        return await Workspace.findByPk(workspace.id, {
          include: workspaceInclude(),
          order: workspaceOrder,
          transaction: t,
        });
      });

      // Decorated outside the transaction: the counts are reads, and holding
      // the write transaction open for them buys nothing.
      return created
        ? await this.decorateWorkspace(created, {
            userId: data.created_by,
            canManage: true,
          })
        : null;
    } catch (error) {
      throw error;
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  // Decoration applied to every workspace the API returns.
  //
  // These are computed rather than stored, and they are the TRUE totals — not
  // the totals of what the caller can see. A member scoped to one room still
  // sees "Rooms 4 · Users 6" in the hero, which is what the design shows;
  // scoping the counts as well would make the page claim the workspace is
  // smaller than it is.
  private async decorateWorkspace(workspace: any, viewer: WorkspaceViewer) {
    const json = workspace.toJSON ? workspace.toJSON() : workspace;
    // member_count is COUNT(DISTINCT user_id), NOT the number of membership
    // rows. Now that one person can be in several rooms, the two differ: three
    // people spread as 2 + 1 + 2 is five rows. The hero asks "how many people",
    // so distinct is the right answer, and per-room counts summing to more than
    // it is expected rather than a bug.
    const [roomCount, memberCount, taskCounts, completionNotice] =
      await Promise.all([
        Room.count({ where: { workspace_id: json.id } }),
        RoomMember.count({
          where: { workspace_id: json.id, status: ACTIVE },
          distinct: true,
          col: "user_id",
        }),
        this.taskCountsForWorkspace(json.id),
        // Only for a completed workspace. On a list of mostly-uncompleted
        // workspaces this costs nothing, which is what keeps it from being an
        // N+1 — decorateWorkspace runs once per row.
        json.completed_at ? this.completionNoticeFor(json.id) : null,
      ]);

    if (Array.isArray(json.rooms)) {
      // The room-level scope. undefined means "every room" (SP, or the
      // creator); an array means only those. An EMPTY array is honoured as
      // "no rooms" rather than falling through to "all rooms".
      if (viewer.visibleRoomIds) {
        const allowed = new Set(viewer.visibleRoomIds);
        json.rooms = json.rooms.filter((room: any) => allowed.has(room.id));
      }
      json.rooms = json.rooms.map((room: any) => ({
        ...room,
        // Zero, not undefined, for a room nothing is linked to — the card
        // renders "0 Tasks" rather than blanking the row.
        task_count: taskCounts.perRoom[room.id]?.total ?? 0,
        done_count: taskCounts.perRoom[room.id]?.done ?? 0,
      }));
    }

    // `code` is the workspace KEY, and since it grants a session unlock it is a
    // credential rather than a label. Only the people who are meant to hand it
    // out receive it — SP and the creator.
    //
    // Hiding the copy button client-side stops it being DISPLAYED, not sent: it
    // stayed in the JSON any member could read off the network tab. This is the
    // same rule that keeps `code` out of the locked stub, extended to
    // non-manager readers of an unlocked workspace.
    if (!viewer.canManage) {
      delete json.code;
    }

    return {
      ...json,
      // Gates the copy-key button. A server decision, so an AM looking at
      // another AM's workspace is told `false` instead of the client inferring
      // `true` from its own role.
      can_manage: viewer.canManage,
      room_count: roomCount,
      member_count: memberCount,
      task_count: taskCounts.total,
      done_count: taskCounts.done,
      // Drives the icon beside the status. Null for anything not completed, so
      // `completion_notice !== null` is the single test for "draw the badge".
      completion_notice: completionNotice,
    };
  }

  // Who was told about this workspace being completed, read back from the
  // notifications that were actually raised.
  //
  // Read from `notifications` rather than stored on the workspace: those rows
  // ARE the record of who was told, so a second copy on the workspace could
  // disagree with them. It also means no new table and no new column.
  //
  // De-duplicated by user, newest first: the button can be pressed more than
  // once (to tell one more person later), which leaves an earlier manager with
  // two rows. The newest is kept, so `read` reflects the most recent notice
  // rather than a stale one.
  public async completionNoticeFor(workspace_id: string) {
    const rows: any[] = await Notification.findAll({
      where: { type: "workspace_completed", reference_id: workspace_id },
      attributes: ["user_id", "is_read", "created_at"],
      order: [["created_at", "DESC"]],
      raw: true,
    });
    if (!rows.length) {
      return { count: 0, unread_count: 0, last_sent_at: null, notified: [] };
    }

    const users = await this.usersLite(rows.map((r: any) => r.user_id));
    const byId = new Map(users.map((u: any) => [u.id, u]));

    const seen = new Set<string>();
    const notified: any[] = [];
    for (const row of rows) {
      if (seen.has(row.user_id)) continue;
      seen.add(row.user_id);
      const user: any = byId.get(row.user_id);
      notified.push({
        id: row.user_id,
        // Null when the account has since been deleted — the notification row
        // outlives the user, so the tooltip must cope with a missing name.
        fullName: user?.fullName ?? null,
        email: user?.email ?? null,
        // Whether that manager has actually opened it, so the icon can
        // distinguish "told" from "seen".
        read: row.is_read === true,
        notified_at: row.created_at,
      });
    }

    return {
      count: notified.length,
      unread_count: notified.filter((n) => !n.read).length,
      last_sent_at: rows[0].created_at,
      notified,
    };
  }

  // One grouped query per workspace rather than one per room. Rooms with no
  // tasks are simply absent from the result and default to 0 above.
  private async taskCountsForWorkspace(workspace_id: string) {
    const sequelize = Database.getSequelize();
    const rows: any[] = await Task.findAll({
      attributes: [
        "room_id",
        [sequelize.fn("COUNT", sequelize.col("Task.id")), "total"],
        [
          sequelize.fn(
            "COUNT",
            sequelize.literal("CASE WHEN status = 'completed' THEN 1 END")
          ),
          "done",
        ],
      ],
      include: [
        {
          model: Room,
          as: "room",
          attributes: [],
          required: true,
          where: { workspace_id },
        },
      ],
      group: ["Task.room_id"],
      raw: true,
    });

    const perRoom: Record<string, { total: number; done: number }> = {};
    let total = 0;
    let done = 0;
    for (const row of rows) {
      const rowTotal = Number(row.total) || 0;
      const rowDone = Number(row.done) || 0;
      perRoom[row.room_id] = { total: rowTotal, done: rowDone };
      total += rowTotal;
      done += rowDone;
    }
    return { perRoom, total, done };
  }

  // The list carries a SLIM rooms array — id, name, position and nothing else —
  // so the sidebar tree opens a workspace without a second request. Members are
  // deliberately left off: the tree only names rooms, and embedding every
  // member of every workspace would make the list quadratic in team size.
  //
  // Scoped the same way as the detail read: a plain member's row lists only
  // their own rooms.
  public async list(where: any) {
    try {
      const rows = await Workspace.findAll({
        where,
        include: [
          {
            model: Project,
            as: "project",
            attributes: ["id", "name"],
            required: false,
          },
          {
            model: Room,
            as: "rooms",
            attributes: ["id", "name", "description", "position"],
            required: false,
          },
          // Same reason as the detail read: the list draws the same status
          // badge, so it needs the name too.
          {
            model: User,
            as: "completedBy",
            attributes: ["id", "fullName", "email"],
            required: false,
          },
        ],
        order: [
          ["created_at", "DESC"],
          [{ model: Room, as: "rooms" }, "position", "ASC"],
        ],
      });

      return rows;
    } catch (error) {
      throw error;
    }
  }

  // The ids of one page of workspaces, plus the total behind it.
  //
  // Two steps rather than a LIMIT on list() itself: list() joins `rooms`, a
  // hasMany, and a LIMIT over a row-multiplying join either truncates a
  // workspace's rooms or counts one workspace several times, depending on how
  // Sequelize decides to build the subquery. Paging over bare ids cannot do
  // either, and the second read is by primary key.
  //
  // `where` is the SAME claim predicate the list applies, so `total` counts
  // what the caller may actually see — a count of every workspace in the
  // organisation would make the page count wrong for everybody but SP.
  public async listPageIds(
    where: any,
    page: number,
    limit: number
  ): Promise<{ ids: string[]; total: number }> {
    try {
      const { count, rows } = await Workspace.findAndCountAll({
        where,
        attributes: ["id"],
        order: [["created_at", "DESC"]],
        offset: (page - 1) * limit,
        limit,
        raw: true,
      });
      return { ids: rows.map((row: any) => row.id), total: count };
    } catch (error) {
      throw error;
    }
  }

  // Decorates one already-fetched list row. Split out from list() because the
  // service now decides per row whether the caller gets the row at all or a
  // locked stub, and only the readable ones are worth the counts.
  //
  // can_manage is per row: an AM manages the ones they created, not the ones
  // another AM did.
  public async decorateListRow(row: any, viewer: WorkspaceViewer) {
    return await this.decorateWorkspace(row, {
      ...viewer,
      canManage: this.canManageRow(viewer, row.created_by),
    });
  }

  public canManageRow(viewer: WorkspaceViewer, created_by: string | null) {
    if (viewer.role === "SP") return true;
    return created_by === viewer.userId;
  }

  public async findById(id: string, viewer: WorkspaceViewer) {
    try {
      const workspace = await Workspace.findByPk(id, {
        include: workspaceInclude(),
        order: workspaceOrder,
      });
      if (!workspace) return null;
      return await this.decorateWorkspace(workspace, viewer);
    } catch (error) {
      throw error;
    }
  }

  // Bare row, no includes — for the existence and ownership checks that run
  // before a write.
  public async findRaw(id: string) {
    try {
      return await Workspace.findByPk(id);
    } catch (error) {
      throw error;
    }
  }

  // The rooms this user may see inside one workspace — the room-level scope.
  public async roomIdsForMember(
    workspace_id: string,
    user_id: string
  ): Promise<string[]> {
    try {
      const rows = await RoomMember.findAll({
        where: { workspace_id, user_id, status: ACTIVE },
        attributes: ["room_id"],
        raw: true,
      });
      return rows.map((r: any) => r.room_id);
    } catch (error) {
      throw error;
    }
  }

  // The workspaces this user has ANY membership row in — pending, active or
  // rejected. Drives the list's claim filter: whether a private workspace is
  // this person's business at all, which is a different question from whether
  // they may read it yet.
  //
  // Deliberately NOT filtered to `active`, unlike every other membership read.
  // A pending row means they typed the correct key; a rejected one means a
  // manager considered them. In both cases they already know the workspace
  // exists, so keeping its row in their sidebar tells them nothing new and
  // gives them somewhere to re-enter the key. Narrowing this to `active` is a
  // one-word change if you would rather a declined request vanished.
  public async workspaceIdsWithMembership(user_id: string): Promise<string[]> {
    try {
      const rows = await RoomMember.findAll({
        where: { user_id },
        attributes: ["workspace_id"],
        raw: true,
      });
      return [...new Set(rows.map((r: any) => r.workspace_id))];
    } catch (error) {
      throw error;
    }
  }

  // Every room this user is active in, across all workspaces — the room scope
  // for the LIST endpoint, which spans workspaces and so cannot use the
  // per-workspace lookup above.
  public async roomIdsForUser(user_id: string): Promise<string[]> {
    try {
      const rows = await RoomMember.findAll({
        where: { user_id, status: ACTIVE },
        attributes: ["room_id"],
        raw: true,
      });
      return rows.map((r: any) => r.room_id);
    } catch (error) {
      throw error;
    }
  }

  // Case-insensitive, matching the partial unique index on UPPER(code): the UI
  // uppercases as you type, so "pd-2026" and "PD-2026" are one key.
  public async findByCode(code: string, excludeId?: string) {
    try {
      const sequelize = Database.getSequelize();
      const rows = await Workspace.findAll({
        where: sequelize.where(
          sequelize.fn("UPPER", sequelize.col("code")),
          code.toUpperCase()
        ) as any,
      });
      return rows.find((w) => w.id !== excludeId) ?? null;
    } catch (error) {
      throw error;
    }
  }

  // ── Update / delete ───────────────────────────────────────────────────────

  public async update(
    workspace: Workspace,
    patch: WorkspacePatch,
    viewer: WorkspaceViewer
  ) {
    try {
      if (patch.name !== undefined) workspace.name = patch.name;
      if (patch.code !== undefined) workspace.code = patch.code;
      if (patch.status !== undefined) workspace.status = patch.status;
      if (patch.visibility !== undefined)
        workspace.visibility = patch.visibility;
      if (patch.description !== undefined)
        workspace.description = patch.description;
      if (patch.project_id !== undefined)
        workspace.project_id = patch.project_id;
      if (patch.completed_at !== undefined)
        workspace.completed_at = patch.completed_at;
      if (patch.completed_by !== undefined)
        workspace.completed_by = patch.completed_by;
      workspace.updated_at = new Date();
      await workspace.save();
      // Only a manager reaches an update, and a manager sees every room.
      return await this.findById(workspace.id, viewer);
    } catch (error) {
      throw error;
    }
  }

  // rooms.workspace_id, room_members.workspace_id and
  // workspace_unlocks.workspace_id are all ON DELETE CASCADE, so the database
  // clears that tree on its own.
  //
  // The workspace's TASKS are NOT part of it. tasks.room_id is ON DELETE SET
  // NULL — deliberately, so deleting one ROOM never destroys real work — which
  // means a bare destroy() here leaves every task of every room behind with a
  // null room_id: orphans loose on the project board, belonging to a workspace
  // that no longer exists and with no way to trace them back to it. Deleting
  // the whole workspace is the one case where that work is meant to go too, so
  // the tasks are removed first, inside the same transaction.
  //
  // Subtasks need no clause of their own: they inherit their parent's room_id
  // on create, and tasks.parent_id is ON DELETE CASCADE, so either rule reaches
  // them.
  //
  // NOT touched, on purpose: the project, the domain/department, task_groups
  // (they belong to a user, not a workspace), and any task that never sat in a
  // room. A workspace is a view over a project's work, not its owner.
  public async remove(workspace: Workspace) {
    try {
      const sequelize = Database.getSequelize();
      return await sequelize.transaction(async (t: Transaction) => {
        const rooms = await Room.findAll({
          where: { workspace_id: workspace.id },
          attributes: ["id"],
          transaction: t,
        });
        const roomIds = rooms.map((room) => room.id);

        // Skipped entirely for a workspace with no rooms — `IN ()` is not a
        // query worth sending.
        const tasksDeleted = roomIds.length
          ? await Task.destroy({
              where: { room_id: { [Op.in]: roomIds } },
              transaction: t,
            })
          : 0;

        await workspace.destroy({ transaction: t });

        // The counts travel back so the client can say what actually went,
        // rather than reporting a bare id and leaving the user to guess.
        return {
          id: workspace.id,
          rooms_deleted: roomIds.length,
          tasks_deleted: tasksDeleted,
        };
      });
    } catch (error) {
      throw error;
    }
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────

  public async findRoom(id: string) {
    try {
      return await Room.findByPk(id);
    } catch (error) {
      throw error;
    }
  }

  // The ids of everyone ACTIVE in one room, in a single query.
  //
  // This is the assignable set for a room's shared task: POST /task validates
  // every subtasks[].assigned_to against it, and the read rule in
  // user.service checks a caller against it. Pending and rejected rows are
  // excluded, so somebody waiting on approval can neither be given a subtask
  // nor read the room's tasks.
  public async activeRoomMemberIds(room_id: string): Promise<string[]> {
    try {
      const rows = await RoomMember.findAll({
        where: { room_id, status: ACTIVE },
        attributes: ["user_id"],
        raw: true,
      });
      return rows.map((r: any) => r.user_id);
    } catch (error) {
      throw error;
    }
  }

  public async findRoomWithMembers(id: string) {
    try {
      const room = await Room.findByPk(id, {
        include: [membersInclude()],
        order: [[{ model: User, as: "members" }, "fullName", "ASC"]],
      });
      if (!room) return null;

      // Same task counts the room cards carry, so a single-room response and an
      // embedded one have the same shape.
      const json: any = room.toJSON();
      const [total, done] = await Promise.all([
        Task.count({ where: { room_id: id } }),
        Task.count({ where: { room_id: id, status: "completed" } }),
      ]);
      return { ...json, task_count: total, done_count: done };
    } catch (error) {
      throw error;
    }
  }

  // Appends to the end of the workspace's rooms when no position is supplied.
  public async nextRoomPosition(workspace_id: string): Promise<number> {
    try {
      const max = await Room.max("position", { where: { workspace_id } });
      return typeof max === "number" ? max + 1 : 0;
    } catch (error) {
      throw error;
    }
  }

  public async createRoom(data: RoomCreateInput) {
    try {
      const room = await Room.create({
        workspace_id: data.workspace_id,
        project_id: data.project_id ?? null,
        name: data.name,
        description: data.description ?? null,
        position:
          data.position ?? (await this.nextRoomPosition(data.workspace_id)),
      });
      return await this.findRoomWithMembers(room.id);
    } catch (error) {
      throw error;
    }
  }

  public async updateRoom(room: Room, patch: RoomPatch) {
    try {
      if (patch.name !== undefined) room.name = patch.name;
      if (patch.description !== undefined) room.description = patch.description;
      if (patch.position !== undefined) room.position = patch.position;
      room.updated_at = new Date();
      await room.save();
      return await this.findRoomWithMembers(room.id);
    } catch (error) {
      throw error;
    }
  }

  // room_members.room_id is ON DELETE CASCADE — the assignments go with it.
  public async removeRoom(room: Room) {
    try {
      await room.destroy();
      return { id: room.id };
    } catch (error) {
      throw error;
    }
  }

  // ── Room members ──────────────────────────────────────────────────────────

  // A plain ADD. Memberships in other rooms are left exactly as they are, so
  // one person can sit in Frontend and Testing at once.
  //
  // This used to be a MOVE — it deleted the person's other membership in the
  // workspace — because the wizard's drag was defined that way. The frontend
  // changed that deliberately: a drag now adds. Deleting anything here would
  // silently undo an assignment the manager still expects to be there.
  //
  // UNIQUE (room_id, user_id) is what keeps this safe to repeat: adding the
  // same person to the same room twice is a no-op, so per-room counts cannot
  // inflate on a retry or a double-click.
  public async addMemberToRoom(
    workspace_id: string,
    room_id: string,
    user_id: string,
    decided_by: string
  ) {
    try {
      const existing = await RoomMember.findOne({
        where: { room_id, user_id },
      });

      if (!existing) {
        await RoomMember.create({
          room_id,
          workspace_id,
          user_id,
          status: ACTIVE,
        });
      } else if (existing.status !== ACTIVE) {
        // A row that exists but is pending or rejected is PROMOTED rather than
        // duplicated: a manager adding someone IS the approval, and the unique
        // index would reject a second row anyway.
        existing.status = ACTIVE;
        existing.decided_by = decided_by;
        existing.decided_at = new Date();
        await existing.save();
      }
      // else: already active in this room — nothing to do.

      return await this.findRoomWithMembers(room_id);
    } catch (error) {
      throw error;
    }
  }

  public async removeMember(room_id: string, user_id: string) {
    try {
      const deleted = await RoomMember.destroy({ where: { room_id, user_id } });
      return { room_id, user_id, removed: deleted > 0 };
    } catch (error) {
      throw error;
    }
  }

  // ── Join flow ─────────────────────────────────────────────────────────────

  // The row for one (workspace, user) pair, whatever its status. Used to decide
  // between "already a member", "already pending" and "create a request".
  public async findMembershipInWorkspace(workspace_id: string, user_id: string) {
    try {
      return await RoomMember.findAll({
        where: { workspace_id, user_id },
      });
    } catch (error) {
      throw error;
    }
  }

  public async findMembership(room_id: string, user_id: string) {
    try {
      return await RoomMember.findOne({ where: { room_id, user_id } });
    } catch (error) {
      throw error;
    }
  }

  // A join REQUEST — status pending, never active. Approval is a separate act
  // by a manager, so a guessed key buys a pending row and nothing else.
  //
  // A row that already exists for this room is REUSED: someone previously
  // rejected who asks again flips back to pending rather than colliding with
  // UNIQUE (room_id, user_id).
  public async requestMembership(
    workspace_id: string,
    room_id: string,
    user_id: string
  ) {
    try {
      const existing = await RoomMember.findOne({
        where: { room_id, user_id },
      });
      if (existing) {
        existing.status = "pending";
        existing.requested_at = new Date();
        existing.decided_by = null;
        existing.decided_at = null;
        await existing.save();
        return existing;
      }
      return await RoomMember.create({
        workspace_id,
        room_id,
        user_id,
        status: "pending",
        requested_at: new Date(),
      });
    } catch (error) {
      throw error;
    }
  }

  // The manager's approval queue for one workspace. Returns the requester and
  // the room they asked for, so the row renders without further lookups.
  public async listMemberships(workspace_id: string, status?: RoomMemberStatus) {
    try {
      return await RoomMember.findAll({
        where: { workspace_id, ...(status ? { status } : {}) },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "fullName", "role"],
            required: false,
          },
          {
            model: Room,
            as: "room",
            attributes: ["id", "name", "description", "position"],
            required: false,
          },
        ],
        order: [["requested_at", "ASC"], ["created_at", "ASC"]],
      });
    } catch (error) {
      throw error;
    }
  }

  // Approve or decline. Nothing but this one row changes.
  //
  // Approving used to also clear the requester's other active membership, to
  // hold "one room per workspace". That rule is gone: being in Frontend is no
  // longer a reason to be removed from it on joining Backend. So an approval is
  // now a single-row status change, which is also why it needs no transaction.
  public async decideMembership(
    membership: RoomMember,
    status: RoomMemberStatus,
    decided_by: string
  ) {
    try {
      membership.status = status;
      membership.decided_by = decided_by;
      membership.decided_at = new Date();
      await membership.save();
      return await this.findRoomWithMembers(membership.room_id);
    } catch (error) {
      throw error;
    }
  }

  // Rooms of one workspace in board order — the picker on the join screen, and
  // the fallback when a join request names no room.
  public async roomsForWorkspace(workspace_id: string) {
    try {
      return await Room.findAll({
        where: { workspace_id },
        order: [["position", "ASC"], ["created_at", "ASC"]],
      });
    } catch (error) {
      throw error;
    }
  }

  // ── Session-scoped unlocks ────────────────────────────────────────────────
  //
  // Separate from room_members on purpose: a manager's decision persists, a
  // typed key does not. See the header of models/workspace_unlock.ts.

  // "Which workspaces has THIS session unlocked."
  //
  // Filtered by user_id as well as session_id, so a guessed or replayed sid is
  // worth nothing on its own.
  public async unlockedWorkspaceIds(
    session_id: string,
    user_id: string
  ): Promise<string[]> {
    try {
      const rows = await WorkspaceUnlock.findAll({
        where: { session_id, user_id },
        attributes: ["workspace_id"],
        raw: true,
      });
      return rows.map((r: any) => r.workspace_id);
    } catch (error) {
      throw error;
    }
  }

  // Idempotent: re-entering the key in the same session is a no-op rather than
  // a unique-constraint error.
  public async recordUnlock(
    session_id: string,
    user_id: string,
    workspace_id: string
  ) {
    try {
      let row;
      try {
        [row] = await WorkspaceUnlock.findOrCreate({
          where: { session_id, workspace_id },
          defaults: { session_id, user_id, workspace_id },
        });
      } catch (error: any) {
        // The caller's user row is gone while their JWT is still inside its
        // 16-hour refresh window — the middleware only verifies the signature,
        // it never asks the database whether the person still exists.
        //
        // Left raw this surfaced as a 500 quoting
        // "workspace_unlocks_user_id_fkey", which both leaks schema names and
        // tells the user nothing they can act on.
        if (error?.name === "SequelizeForeignKeyConstraintError") {
          throw new Error(STALE_SESSION);
        }
        throw error;
      }
      // Cheap opportunistic tidy-up. A session whose refresh token has expired
      // can never come back, and nothing else would ever collect its rows —
      // the sid is opaque, so there is no way to ask whether it is still live.
      await this.sweepStaleUnlocks();
      return row;
    } catch (error) {
      throw error;
    }
  }

  // Logout. Ends every unlock this session held, so the key is asked for again
  // on the next login.
  public async clearUnlocksForSession(session_id: string): Promise<number> {
    try {
      return await WorkspaceUnlock.destroy({ where: { session_id } });
    } catch (error) {
      throw error;
    }
  }

  // The refresh token lives 16 hours, so anything older belongs to a session
  // that cannot exist any more. Failure here is swallowed: it is housekeeping,
  // and a surviving row grants nothing on its own — the read still checks
  // user_id, and by then the workspace may be public or the person a member.
  private async sweepStaleUnlocks(): Promise<void> {
    try {
      await WorkspaceUnlock.destroy({
        where: {
          created_at: {
            [Op.lt]: new Date(Date.now() - 16 * 60 * 60 * 1000),
          },
        },
      });
    } catch {
      // ignored on purpose
    }
  }

  // ── Completion notices ────────────────────────────────────────────────────

  // The people a completion notice may be sent to: every SP, AM and MG, with
  // the caller's own manager flagged so the picker can pre-select them.
  //
  // Deliberately role-based rather than "everyone": the button would otherwise
  // be a way to push a notification at an arbitrary colleague. The caller is
  // excluded — nobody needs telling about a button they just pressed
  // themselves.
  public async notifiableManagers(
    caller_id: string
  ): Promise<NotifyTarget[]> {
    try {
      const [caller, rows] = await Promise.all([
        User.findByPk(caller_id, { attributes: ["manager_id"], raw: true }),
        User.findAll({
          where: {
            role: { [Op.in]: NOTIFIABLE_ROLES },
            id: { [Op.ne]: caller_id },
            isBlocked: false,
          },
          attributes: ["id", "fullName", "email", "role"],
          order: [["fullName", "ASC"]],
          raw: true,
        }),
      ]);
      const myManager = (caller as any)?.manager_id ?? null;
      return rows.map((u: any) => ({
        id: u.id,
        fullName: u.fullName ?? null,
        email: u.email ?? null,
        role: u.role,
        is_my_manager: !!myManager && u.id === myManager,
      }));
    } catch (error) {
      throw error;
    }
  }

  // The workspace plus the project NAME, which the announce message needs:
  // `"WebApps" (Effort Tracker) has been marked completed by Lakshman.`
  //
  // A plain findRaw would cost a second lookup for the project, and the message
  // is rendered verbatim by the client — a missing project name would show up
  // in the notification itself.
  public async findRawWithProject(id: string) {
    try {
      return await Workspace.findByPk(id, {
        include: [
          {
            model: Project,
            as: "project",
            attributes: ["id", "name"],
            required: false,
          },
        ],
      });
    } catch (error) {
      throw error;
    }
  }

  // Stamps the announce. Called only after the notification rows are written,
  // so a failed announce never leaves the strip claiming somebody was told.
  //
  // Overwrites rather than only setting the first time: a reminder is a
  // legitimate second announce, and the page wants the MOST RECENT one.
  public async markAnnounced(workspace: Workspace, at: Date) {
    try {
      workspace.announced_at = at;
      workspace.updated_at = new Date();
      await workspace.save({ fields: ["announced_at", "updated_at"] });
      return workspace;
    } catch (error) {
      throw error;
    }
  }

  // The ids in `wanted` that notify-targets would NOT have returned, in the
  // order they were sent, each with the reason.
  //
  // Strict by design, unlike the partitioning read below: nothing has been
  // written when this runs, so the whole request can be rejected with a 400
  // naming the bad id. That is the useful answer — a bad id here means the
  // picker is out of date, and saying which entry is stale is the point.
  public async invalidNotifyTargets(
    caller_id: string,
    wanted: string[]
  ): Promise<Array<{ index: number; id: string; reason: string }>> {
    try {
      const bad: Array<{ index: number; id: string; reason: string }> = [];
      if (!wanted.length) return bad;

      const found: any[] = await User.findAll({
        where: { id: { [Op.in]: [...new Set(wanted)] } },
        attributes: ["id", "role", "isBlocked"],
        raw: true,
      });
      const byId = new Map(found.map((u: any) => [u.id, u]));

      wanted.forEach((id, index) => {
        const user = byId.get(id);
        if (!user) bad.push({ index, id, reason: "not a known user" });
        else if (id === caller_id)
          bad.push({ index, id, reason: "you cannot notify yourself" });
        else if (user.isBlocked)
          bad.push({ index, id, reason: "account is blocked" });
        else if (!NOTIFIABLE_ROLES.includes(user.role))
          bad.push({ index, id, reason: `role ${user.role} is not a manager` });
      });
      return bad;
    } catch (error) {
      throw error;
    }
  }

  // Partitions the requested recipient ids into those that are genuinely
  // notifiable managers and those that are not, rather than rejecting the whole
  // request on one bad id. A stale entry in the picker must not undo a
  // completion that has already been written.
  public async resolveNotifyTargets(
    caller_id: string,
    user_ids: string[]
  ): Promise<{
    valid: Array<{ id: string; fullName: string | null }>;
    skipped: Array<{ id: string; reason: string }>;
  }> {
    try {
      const wanted = [...new Set((user_ids ?? []).filter(Boolean))];
      const valid: Array<{ id: string; fullName: string | null }> = [];
      const skipped: Array<{ id: string; reason: string }> = [];
      if (!wanted.length) return { valid, skipped };

      const found: any[] = await User.findAll({
        where: { id: { [Op.in]: wanted } },
        attributes: ["id", "fullName", "role", "isBlocked"],
        raw: true,
      });
      const byId = new Map(found.map((u: any) => [u.id, u]));

      for (const id of wanted) {
        const user = byId.get(id);
        if (!user) {
          skipped.push({ id, reason: "not a known user" });
        } else if (id === caller_id) {
          skipped.push({ id, reason: "you cannot notify yourself" });
        } else if (user.isBlocked) {
          skipped.push({ id, reason: "account is blocked" });
        } else if (!NOTIFIABLE_ROLES.includes(user.role)) {
          skipped.push({ id, reason: `role ${user.role} is not a manager` });
        } else {
          valid.push({ id, fullName: user.fullName ?? null });
        }
      }
      return { valid, skipped };
    } catch (error) {
      throw error;
    }
  }

  // Names for a set of ids. Mirrors UserRepository.findUsersLite; kept here so
  // the workspace service does not have to reach into the task repository for
  // one lookup.
  public async usersLite(ids: string[]) {
    try {
      const unique = [...new Set((ids ?? []).filter(Boolean))];
      if (!unique.length) return [];
      return await User.findAll({
        where: { id: { [Op.in]: unique } },
        attributes: ["id", "fullName", "email"],
        raw: true,
      });
    } catch (error) {
      throw error;
    }
  }

  // ── Validation helpers ────────────────────────────────────────────────────

  public async projectExists(project_id: string): Promise<boolean> {
    try {
      return (await Project.count({ where: { id: project_id } })) > 0;
    } catch (error) {
      throw error;
    }
  }

  // Returns the ids that are NOT real users, so the caller can name them in a
  // 400 instead of letting the FK blow up mid-transaction.
  public async missingUserIds(ids: string[]): Promise<string[]> {
    try {
      if (ids.length === 0) return [];
      const found = await User.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ["id"],
        raw: true,
      });
      const foundIds = new Set(found.map((u: any) => u.id));
      return ids.filter((id) => !foundIds.has(id));
    } catch (error) {
      throw error;
    }
  }
}
