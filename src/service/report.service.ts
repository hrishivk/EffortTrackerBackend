import { Role } from "../Enums/Role";
import {
  DailyBucket,
  MemberBucket,
  MemberRow,
  Measures,
  ReportDirectoryRepository,
  ReportRepository,
  TASK_ROWS_LIMIT,
} from "../repositories/report.repository";
import { superAdminRepository } from "../repositories/super-admin.repository";
import { TaskGroupRepository } from "../repositories/task-group.repository";
import {
  DateRange,
  eachDate,
  previousRange,
  todayDateOnly,
} from "../utils/dateRange";

const reportRepository = new ReportRepository();
const directory = new ReportDirectoryRepository();
const SuperAdminRepository = new superAdminRepository();
const taskGroupRepository = new TaskGroupRepository();

export class ReportAccessError extends Error {
  public readonly name = "ReportAccessError";
}

export class ReportNotFoundError extends Error {
  public readonly name = "ReportNotFoundError";
}

export interface Viewer {
  id: string;
  role?: string;
}
const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

export interface Totals extends Measures {
  pending: number;
  completion_rate: number;
  avg_seconds_per_task: number;
  active_rate: number;
  today_seconds: number;
}

const sumMeasures = (buckets: Measures[]): Measures =>
  buckets.reduce<Measures>(
    (acc, bucket) => ({
      tasks_worked: acc.tasks_worked + bucket.tasks_worked,
      completed: acc.completed + bucket.completed,
      in_progress: acc.in_progress + bucket.in_progress,
      total_seconds: acc.total_seconds + bucket.total_seconds,
    }),
    { tasks_worked: 0, completed: 0, in_progress: 0, total_seconds: 0 }
  );

const totalsFrom = (daily: DailyBucket[]): Totals => {
  const measures = sumMeasures(daily);
  const today = todayDateOnly();
  return {
    tasks_worked: measures.tasks_worked,
    completed: measures.completed,
    in_progress: measures.in_progress,
    pending: measures.tasks_worked - measures.completed - measures.in_progress,
    completion_rate: pct(measures.completed, measures.tasks_worked),
    total_seconds: measures.total_seconds,
    avg_seconds_per_task: measures.tasks_worked
      ? Math.round(measures.total_seconds / measures.tasks_worked)
      : 0,
    active_rate: pct(
      measures.completed + measures.in_progress,
      measures.tasks_worked
    ),
    today_seconds:
      daily.find((bucket) => bucket.date === today)?.total_seconds ?? 0,
  };
};

export interface PreviousTotals {
  tasks_worked: number;
  completed: number;
  total_seconds: number;
}
const previousTotalsFrom = (daily: DailyBucket[]): PreviousTotals => {
  const measures = sumMeasures(daily);
  return {
    tasks_worked: measures.tasks_worked,
    completed: measures.completed,
    total_seconds: measures.total_seconds,
  };
};
export interface DailyRow {
  date: string;
  tasks_worked: number;
  completed: number;
  total_seconds: number;
  productivity: number;
}

const fillDaily = (range: DateRange, buckets: DailyBucket[]): DailyRow[] => {
  const byDate = new Map(buckets.map((bucket) => [bucket.date, bucket]));
  return eachDate(range).map((date) => {
    const bucket = byDate.get(date);
    const tasks_worked = bucket?.tasks_worked ?? 0;
    const completed = bucket?.completed ?? 0;
    return {
      date,
      tasks_worked,
      completed,
      total_seconds: bucket?.total_seconds ?? 0,
      productivity: pct(completed, tasks_worked),
    };
  });
};

export interface MemberSummary {
  user: { id: string; fullName: string | null };
  tasks_worked: number;
  completed: number;
  in_progress: number;
  pending: number;
  completion_rate: number;
  total_seconds: number;
}
const STATUS_DISPLAY: Record<string, string> = {
  yet_to_start: "Yet to Start",
  in_progress: "In Progress",
  completed: "Completed",
  blocked: "Blocked",
};

const displayStatus = (raw: string): string => {
  const slug = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return STATUS_DISPLAY[slug] ?? String(raw ?? "").trim();
};

const summariseMember = (
  member: MemberRow,
  bucket?: MemberBucket
): MemberSummary => {
  const tasks_worked = bucket?.tasks_worked ?? 0;
  const completed = bucket?.completed ?? 0;
  const in_progress = bucket?.in_progress ?? 0;
  return {
    user: { id: member.id, fullName: member.fullName },
    tasks_worked,
    completed,
    in_progress,
    pending: tasks_worked - completed - in_progress,
    completion_rate: pct(completed, tasks_worked),
    total_seconds: bucket?.total_seconds ?? 0,
  };
};

export class ReportService {
  // ── §3, the security boundary ─────────────────────────────────────────────
  //
  //   SP              any user, any team, any department
  //   AM              only users under them — their own team plus shared users
  //                   assigned to one of their domains, which is exactly the
  //                   set /role-sp/list-users already returns an AM, so every
  //                   row in their member picker is a row they can open
  //   USER/DEVLOPER   only themselves
  //
  // Out of scope is 403, never an empty report. An empty report reads as "that
  // person did nothing this week", which is a different answer and a wrong one.
  private async assertCanReadUser(
    viewer: Viewer,
    target_user_id: string
  ): Promise<MemberRow> {
    if (!viewer?.id) {
      throw new ReportAccessError("You do not have access to this report");
    }

    const target = await directory.findUser(target_user_id);
    if (!target) {
      throw new ReportNotFoundError("User not found");
    }
    const member: MemberRow = {
      id: String(target.id),
      fullName: target.fullName ?? null,
    };

    if (viewer.role === Role.SuperAdmin) return member;
    if (target.id === viewer.id) return member;

    if (viewer.role === Role.Admin) {
      if (target.manager_id === viewer.id) return member;
      if (target.is_shared) {
        const domainPeerIds = await SuperAdminRepository.getDomainPeerUserIds(
          viewer.id
        );
        if (domainPeerIds.includes(target.id)) return member;
      }
    }

    throw new ReportAccessError("You do not have access to this user's report");
  }

  // The team a caller may report on. An AM's own row is NOT in it — the team
  // report answers "how is my team doing", and a manager's own task count
  // sitting in the member list skews every team average they read.
  private async resolveTeam(
    viewer: Viewer,
    department_id?: string
  ): Promise<MemberRow[]> {
    let members: MemberRow[];

    if (viewer.role === Role.SuperAdmin) {
      members = await directory.allMembers();
    } else if (viewer.role === Role.Admin) {
      const domainPeerIds = await SuperAdminRepository.getDomainPeerUserIds(
        viewer.id
      );
      members = await directory.managedBy(viewer.id, domainPeerIds);
    } else {
      // A USER or DEVLOPER manages nobody. 403 rather than a team of one:
      // "your team is just you" is not a report, and answering it would let
      // the route look like it works for a role it is not for.
      throw new ReportAccessError("You do not have access to a team report");
    }

    members = members.filter((member) => member.id !== viewer.id);

    if (department_id) {
      // Narrows the MEMBER SET, not the tasks: a department is a group of
      // people here (domain_assignments), so "the design department's report"
      // is those people's work wherever they did it. Narrowing by project is
      // what ?project_id= is for, and the two compose.
      const inDepartment = new Set(
        await directory.userIdsInDepartment(department_id)
      );
      members = members.filter((member) => inDepartment.has(member.id));
    }

    return members;
  }


  // group_id -> the lane NAME, which is what tasks.status actually carries.
  //
  // Resolved per request rather than trusting a name from the client: renaming
  // a lane rewrites tasks.status for every card parked in it
  // (TaskGroupService.updateGroup -> syncTaskStatuses), so the id keeps
  // pointing at the right work across a rename while a saved name would not.
  //
  // Not authorised separately. A lane is a label, not data: the tasks it
  // filters are already bounded by the caller's §3 scope, so a group id only
  // ever narrows what they could already see.
  private async resolveGroupName(group_id?: string): Promise<string | null> {
    if (!group_id) return null;
    const group = await taskGroupRepository.findById(group_id);
    if (!group) throw new ReportNotFoundError("Task group not found");
    return group.name;
  }
  // ── §1 Individual report ──────────────────────────────────────────────────
  public async userReport(input: {
    viewer: Viewer;
    user_id: string;
    range: DateRange;
    project_id?: string;
    group_id?: string;

    include_tasks?: boolean;
  }) {
    try {
      const user = await this.assertCanReadUser(input.viewer, input.user_id);

      const filters = {
        userIds: [user.id],
        project_id: input.project_id ?? null,
        group_name: await this.resolveGroupName(input.group_id),
      };
      const previous = previousRange(input.range);
      const [currentBuckets, previousBuckets, rows] = await Promise.all([
        reportRepository.dailyTotals({ ...filters, ...input.range }),
        reportRepository.dailyTotals({ ...filters, ...previous }),
        input.include_tasks
          ? reportRepository.taskRows({ ...filters, ...input.range })
          : Promise.resolve(null),
      ]);


      const truncated = !!rows && rows.length > TASK_ROWS_LIMIT;
      const tasks = rows
        ? rows.slice(0, TASK_ROWS_LIMIT).map((row) => ({
            ...row,
            status: displayStatus(row.status),
          }))
        : null;
        console.log('taskkkk',tasks)
      return {
        user: { id: user.id, fullName: user.fullName },
        range: { from: input.range.from, to: input.range.to },
        totals: totalsFrom(currentBuckets),
        previous: previousTotalsFrom(previousBuckets),
        daily: fillDaily(input.range, currentBuckets),
        ...(tasks ? { tasks, tasks_truncated: truncated } : {}),
      };
    } catch (error) {
      console.error("Error in userReport:", error);
      throw error;
    }
  }


  public async teamReport(input: {
    viewer: Viewer;
    range: DateRange;
    project_id?: string;
    group_id?: string;
    department_id?: string;
    page: number;
    limit: number;
  }) {
    try {
      const members = await this.resolveTeam(input.viewer, input.department_id);
      const userIds = members.map((member) => member.id);
      const filters = {
        userIds,
        project_id: input.project_id ?? null,
        group_name: await this.resolveGroupName(input.group_id),
      };
      const previous = previousRange(input.range);

      const [currentBuckets, previousBuckets, memberBuckets] =
        await Promise.all([
          reportRepository.dailyTotals({ ...filters, ...input.range }),
          reportRepository.dailyTotals({ ...filters, ...previous }),
          reportRepository.memberTotals({ ...filters, ...input.range }),
        ]);

      const byUser = new Map(
        memberBuckets.map((bucket) => [bucket.user_id, bucket])
      );
      const rows = members
        .map((member) => summariseMember(member, byUser.get(member.id)))
        .sort(
          (a, b) =>
            b.total_seconds - a.total_seconds ||
            b.tasks_worked - a.tasks_worked ||
            (a.user.fullName ?? "").localeCompare(b.user.fullName ?? "")
        );

      const total = rows.length;
      const totalPages = input.limit > 0 ? Math.ceil(total / input.limit) : 0;
      const start = (input.page - 1) * input.limit;

      return {
        range: { from: input.range.from, to: input.range.to },
        member_count: total,
        totals: totalsFrom(currentBuckets),
        previous: previousTotalsFrom(previousBuckets),
        daily: fillDaily(input.range, currentBuckets),
        members: rows.slice(start, start + input.limit),
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          totalPages,
        },
      };
    } catch (error) {
      console.error("Error in teamReport:", error);
      throw error;
    }
  }
}

export default new ReportService();
