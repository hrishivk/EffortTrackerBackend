import { Role } from "../Enums/Role";
import {
  MemberUser,
  OrgRepository,
  PersonMeasures,
  Window,
} from "../repositories/org.repository";
import { ReportRepository } from "../repositories/report.repository";
import { superAdminRepository } from "../repositories/super-admin.repository";
import { UserRepository } from "../repositories/user.repository";
import {
  DateRange,
  eachDate,
  MS_PER_DAY,
  parseDateRange,
  todayDateOnly,
  toDateOnly,
} from "../utils/dateRange";
import { decorateTasks } from "../utils/taskView";
import { commentAuthorsFor } from "./user.service";

const orgRepository = new OrgRepository();
const reportRepository = new ReportRepository();
const SuperAdminRepository = new superAdminRepository();
const userRepository = new UserRepository();

// Raised for the access rules of the org view. Named, like the report errors,
// so the controller maps them to a status without matching on message text.
export class OrgAccessError extends Error {
  public readonly name = "OrgAccessError";
}
export class OrgNotFoundError extends Error {
  public readonly name = "OrgNotFoundError";
}
export class OrgValidationError extends Error {
  public readonly name = "OrgValidationError";
}

export interface Viewer {
  id: string;
  role?: string;
}

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

// "312:40" — hours are not capped at 24, so this is not a clock time.
export const formatHours = (seconds: number): string => {
  const totalMinutes = Math.round(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

// lastSeenAt is written as NULL at login and stamped with the time at logout
// (UserRepository.setUserActive / setUserLogout), so NULL is "signed in now".
// The never-signed-in placeholder text is neither.
const isOnline = (user: MemberUser): boolean => user.lastSeenAt === null;

const lastSeenIso = (user: MemberUser): string | null => {
  if (!user.lastSeenAt) return null;
  const parsed = new Date(user.lastSeenAt);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const EMPTY: Omit<PersonMeasures, "user_id"> = {
  total: 0,
  yet_to_start: 0,
  in_progress: 0,
  completed: 0,
  blocked: 0,
  overdue: 0,
  completed_with_due: 0,
  on_time: 0,
  total_seconds: 0,
};

const sumMeasures = (rows: Array<Omit<PersonMeasures, "user_id">>) =>
  rows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      yet_to_start: acc.yet_to_start + row.yet_to_start,
      in_progress: acc.in_progress + row.in_progress,
      completed: acc.completed + row.completed,
      blocked: acc.blocked + row.blocked,
      overdue: acc.overdue + row.overdue,
      completed_with_due: acc.completed_with_due + row.completed_with_due,
      on_time: acc.on_time + row.on_time,
      total_seconds: acc.total_seconds + row.total_seconds,
    }),
    { ...EMPTY }
  );

// The one efficiency formula, the one team-performance has always used:
// completed / assigned. Every org-view screen reads it from here so the
// department, member and employee figures agree with that endpoint.
export const efficiencyOf = (m: { completed: number; total: number }): number =>
  pct(m.completed, m.total);

export const onTimeRateOf = (m: { on_time: number; completed_with_due: number }): number =>
  pct(m.on_time, m.completed_with_due);

// The window for org-tree, department-members and department-tasks: from + to,
// both or neither, and neither means today. Same strict YYYY-MM-DD rules as
// task-list (parseDateRange throws DateRangeError -> 400).
export const windowOrToday = (from: unknown, to: unknown): DateRange => {
  if (from === undefined && to === undefined) {
    const today = todayDateOnly();
    return { from: today, to: today, days: 1 };
  }
  return parseDateRange(from, to);
};

// The dashboards draw a trend, and a one-day trend is a single dot, so
// department-overview and employee-summary default to the last 30 days.
export const windowOrLastDays = (from: unknown, to: unknown, days = 30): DateRange => {
  if (from === undefined && to === undefined) {
    const today = todayDateOnly();
    const start = new Date(new Date(`${today}T00:00:00Z`).getTime() - (days - 1) * MS_PER_DAY);
    return { from: toDateOnly(start), to: today, days };
  }
  return parseDateRange(from, to);
};

const asWindow = (range: DateRange): Window => ({ from: range.from, to: range.to });

const personRef = (user: MemberUser | undefined | null) =>
  user
    ? {
        id: user.id,
        fullName: user.fullName ?? null,
        // No avatar column yet — the same placeholder user-details sends.
        avatar: null,
        jobTitle: user.job_title ?? null,
      }
    : null;

const MEMBER_SORTS: Record<string, (a: any, b: any) => number> = {
  name: (a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""),
  overdue: (a, b) => a.workload.overdue - b.workload.overdue,
  completed: (a, b) => a.workload.completed - b.workload.completed,
  efficiency: (a, b) => a.workload.efficiency - b.workload.efficiency,
  // Online people have no lastSeenAt; they were seen now.
  lastSeen: (a, b) => {
    const at = (row: any) =>
      row.isOnline ? Date.now() : row.lastSeenAt ? Date.parse(row.lastSeenAt) : 0;
    return at(a) - at(b);
  },
};

const ORG_TREE_TTL_MS = 60 * 1000;
const PRIORITIES = ["High", "Medium", "Low"];

export class OrgService {
  // org-tree may be served from here for 60 seconds per caller; the app polls
  // no faster than that. Keyed by caller AND window, since an AM's tree is
  // narrower than an SP's.
  private treeCache = new Map<string, { at: number; data: any }>();

  // ── Access ────────────────────────────────────────────────────────────────
  //
  //   SP              every department
  //   AM              the departments they are linked to (domain_assignments)
  //                   — the same rule list-domains applies today
  //   anyone else     403 (the routes already refuse them; this is the backstop)
  //
  // A department outside an AM's set is 403, never an empty answer: an empty
  // department reads as "nobody works here", which is a different claim.

  // null means "all of them".
  public async visibleDomainIds(viewer: Viewer): Promise<Set<string> | null> {
    if (!viewer?.id) throw new OrgAccessError("You do not have access to the org view");
    if (viewer.role === Role.SuperAdmin) return null;
    if (viewer.role === Role.Admin) {
      return new Set(await SuperAdminRepository.getDomainIdsForUser(viewer.id));
    }
    throw new OrgAccessError("You do not have access to the org view");
  }

  public async assertDomainAccess(viewer: Viewer, domainId: unknown): Promise<any> {
    const id = typeof domainId === "string" ? domainId.trim() : "";
    if (!id) throw new OrgValidationError("domain_id is required");
    const visible = await this.visibleDomainIds(viewer);
    const domain = await SuperAdminRepository.findDomainById(id);
    if (!domain) throw new OrgNotFoundError("Department not found");
    if (visible && !visible.has(id)) {
      throw new OrgAccessError("You do not have access to this department");
    }
    return domain.get({ plain: true });
  }

  // The people of one department: primary members plus the shared users
  // linked to it. Used by the new endpoints and by every existing endpoint
  // that grew a ?domain_id= filter, so they all mean the same set.
  public async departmentUserIds(domainId: string): Promise<string[]> {
    const memberships = await orgRepository.memberships();
    return [
      ...new Set(
        memberships.filter((m) => m.domain_id === domainId).map((m) => m.user_id)
      ),
    ];
  }

  // ── 1. GET /role-sp/org-tree ──────────────────────────────────────────────
  public async orgTree(viewer: Viewer, range: DateRange) {
    const visible = await this.visibleDomainIds(viewer);
    const key = `${viewer.id}|${range.from}|${range.to}`;
    const cached = this.treeCache.get(key);
    if (cached && Date.now() - cached.at < ORG_TREE_TTL_MS) return cached.data;

    const today = todayDateOnly();
    const window = asWindow(range);
    const [allDomains, memberships, activeProjects] = await Promise.all([
      orgRepository.allDomains(),
      orgRepository.memberships(),
      orgRepository.activeProjectCounts(),
    ]);
    const domains = visible
      ? allDomains.filter((d: any) => visible.has(String(d.id)))
      : allDomains;

    const membersOf = new Map<string, string[]>();
    memberships.forEach((m) => {
      if (!membersOf.has(m.domain_id)) membersOf.set(m.domain_id, []);
      membersOf.get(m.domain_id)!.push(m.user_id);
    });

    const visibleMemberIds = [
      ...new Set(domains.flatMap((d: any) => membersOf.get(String(d.id)) ?? [])),
    ];

    // Everyone the tree names: members, their managers and the heads. One read.
    const memberUsers = await orgRepository.findUsers(visibleMemberIds);
    const extraIds = [
      ...new Set([
        ...memberUsers.map((u) => u.manager_id).filter(Boolean),
        ...domains.map((d: any) => d.head_user_id).filter(Boolean),
      ]),
    ].filter((id) => !visibleMemberIds.includes(id as string)) as string[];
    const users = new Map<string, MemberUser>(
      [...memberUsers, ...(await orgRepository.findUsers(extraIds))].map((u) => [u.id, u])
    );

    const [measures, companyMeasures, companyEmployees] = await Promise.all([
      orgRepository.personMeasures({ window, userIds: visibleMemberIds, today }),
      visible
        ? Promise.resolve(null)
        : orgRepository.personMeasures({ window, userIds: null, today }),
      visible ? Promise.resolve(visibleMemberIds.length) : orgRepository.countEmployees(),
    ]);
    const byUser = new Map(measures.map((m) => [m.user_id, m]));

    const reportRow = (user: MemberUser) => {
      const m = byUser.get(user.id) ?? { ...EMPTY };
      return {
        id: user.id,
        fullName: user.fullName ?? null,
        role: user.role,
        jobTitle: user.job_title ?? null,
        avatar: null,
        tasksOpen: m.total - m.completed,
        overdue: m.overdue,
        isOnline: isOnline(user),
        isBlocked: !!user.isBlocked,
      };
    };

    const nodeFor = (domain: any) => {
      const id = String(domain.id);
      const people = (membersOf.get(id) ?? [])
        .map((uid) => users.get(uid))
        .filter(Boolean) as MemberUser[];
      const totals = sumMeasures(people.map((u) => byUser.get(u.id) ?? { ...EMPTY }));

      // Grouped by reporting manager. The manager need not be in the
      // department (an AM in another department, or the SP); they head their
      // group either way so nobody under them drops out of the tree.
      const groups = new Map<string, MemberUser[]>();
      const unassigned: MemberUser[] = [];
      people.forEach((person) => {
        if (person.manager_id && users.has(person.manager_id)) {
          if (!groups.has(person.manager_id)) groups.set(person.manager_id, []);
          groups.get(person.manager_id)!.push(person);
        } else {
          unassigned.push(person);
        }
      });
      const byName = (a: MemberUser, b: MemberUser) =>
        (a.fullName ?? "").localeCompare(b.fullName ?? "");

      return {
        id,
        name: domain.name,
        parentId: domain.parent_id ?? null,
        sortOrder: Number(domain.sort_order) || 0,
        head: personRef(domain.head_user_id ? users.get(domain.head_user_id) : null),
        employees: people.length,
        activeProjects: activeProjects.get(id) ?? 0,
        tasks: {
          total: totals.total,
          completed: totals.completed,
          inProgress: totals.in_progress,
          blocked: totals.blocked,
          overdue: totals.overdue,
        },
        completion: pct(totals.completed, totals.total),
        hoursLogged: formatHours(totals.total_seconds),
        managers: [...groups.entries()]
          .map(([managerId, reports]) => {
            const manager = users.get(managerId)!;
            return {
              id: manager.id,
              fullName: manager.fullName ?? null,
              role: manager.role,
              jobTitle: manager.job_title ?? null,
              avatar: null,
              reports: reports.sort(byName).map(reportRow),
            };
          })
          .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? "")),
        unassigned: unassigned.sort(byName).map(reportRow),
        children: [] as any[],
      };
    };

    // Nest by parent_id. A department whose parent the caller cannot see (or
    // that no longer exists) is lifted to the top level rather than hidden.
    const nodes = new Map<string, any>(domains.map((d: any) => [String(d.id), nodeFor(d)]));
    const roots: any[] = [];
    nodes.forEach((node) => {
      const parent = node.parentId ? nodes.get(node.parentId) : null;
      if (parent && parent !== node) parent.children.push(node);
      else roots.push(node);
    });
    const order = (list: any[]) => {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
      list.forEach((n) => order(n.children));
    };
    order(roots);

    const company = sumMeasures(companyMeasures ?? measures);
    const data = {
      range: { from: range.from, to: range.to },
      company: {
        name: process.env.COMPANY_NAME || "RhythmRx",
        employees: companyEmployees,
        departments: domains.length,
        tasks: {
          total: company.total,
          completed: company.completed,
          inProgress: company.in_progress,
          overdue: company.overdue,
        },
      },
      departments: roots,
    };

    this.treeCache.set(key, { at: Date.now(), data });
    return data;
  }

  // ── 2. GET /role-sp/department-overview ───────────────────────────────────
  public async departmentOverview(viewer: Viewer, domainId: unknown, range: DateRange) {
    const domain = await this.assertDomainAccess(viewer, domainId);
    const id = String(domain.id);
    const today = todayDateOnly();
    const window = asWindow(range);
    const memberIds = await this.departmentUserIds(id);

    const [
      members,
      head,
      measures,
      priority,
      perDay,
      projects,
      activeProjects,
      upcomingDeadlines,
      recentActivity,
    ] = await Promise.all([
      orgRepository.findUsers(memberIds),
      domain.head_user_id ? orgRepository.findUser(domain.head_user_id) : Promise.resolve(null),
      orgRepository.personMeasures({ window, userIds: memberIds, today }),
      orgRepository.priorityCounts({ window, userIds: memberIds }),
      orgRepository.createdCompletedByDay({ from: range.from, to: range.to, userIds: memberIds }),
      orgRepository.domainProjects(id),
      orgRepository.activeProjectCounts(),
      SuperAdminRepository.fetchUpcomingDeadlines(10, memberIds),
      SuperAdminRepository.fetchRecentActivity(10, memberIds),
    ]);

    const totals = sumMeasures(measures);
    const byDay = new Map(perDay.map((row) => [row.date, row]));
    const names = new Map(members.map((u) => [u.id, u.fullName ?? null]));

    const topPerformers = measures
      .filter((m) => m.total > 0)
      .map((m) => ({
        id: m.user_id,
        fullName: names.get(m.user_id) ?? null,
        completed: m.completed,
        efficiency: efficiencyOf(m),
      }))
      .sort((a, b) => b.completed - a.completed || b.efficiency - a.efficiency)
      .slice(0, 5);

    return {
      range: { from: range.from, to: range.to },
      department: {
        id,
        name: domain.name,
        description: domain.description ?? null,
        parentId: domain.parent_id ?? null,
        head: personRef(head),
      },
      tiles: {
        employees: memberIds.length,
        activeProjects: activeProjects.get(id) ?? 0,
        tasksTotal: totals.total,
        completion: pct(totals.completed, totals.total),
        overdue: totals.overdue,
        hoursLogged: formatHours(totals.total_seconds),
        onTimeRate: onTimeRateOf(totals),
      },
      status: {
        yetToStart: totals.yet_to_start,
        inProgress: totals.in_progress,
        completed: totals.completed,
        blocked: totals.blocked,
      },
      priority: PRIORITIES.reduce<Record<string, number>>((acc, p) => {
        acc[p] = priority[p] ?? 0;
        return acc;
      }, {}),
      trend: eachDate(range).map((date) => ({
        date,
        created: byDay.get(date)?.created ?? 0,
        completed: byDay.get(date)?.completed ?? 0,
      })),
      projects,
      topPerformers,
      upcomingDeadlines,
      recentActivity,
    };
  }

  // ── 3. GET /role-sp/department-members ────────────────────────────────────
  public async departmentMembers(
    viewer: Viewer,
    input: {
      domainId: unknown;
      range: DateRange;
      search?: string;
      role?: string;
      page: number;
      limit: number;
      sort?: string;
    }
  ) {
    const domain = await this.assertDomainAccess(viewer, input.domainId);
    const id = String(domain.id);
    const memberIds = await this.departmentUserIds(id);
    let members = await orgRepository.findUsers(memberIds);

    const search = input.search?.trim().toLowerCase();
    if (search) {
      members = members.filter(
        (u) =>
          (u.fullName ?? "").toLowerCase().includes(search) ||
          (u.email ?? "").toLowerCase().includes(search)
      );
    }
    if (input.role) {
      const role = input.role.trim().toUpperCase();
      members = members.filter((u) => u.role === role);
    }

    const sortKey = String(input.sort ?? "name").trim();
    const descending = sortKey.startsWith("-");
    const sorter = MEMBER_SORTS[descending ? sortKey.slice(1) : sortKey];
    if (!sorter) {
      throw new OrgValidationError(
        "sort must be one of name, overdue, completed, efficiency, lastSeen (prefix - for descending)"
      );
    }

    const ids = members.map((u) => u.id);
    const managerIds = [
      ...new Set(members.map((u) => u.manager_id).filter(Boolean)),
    ] as string[];
    const [measures, running, managers] = await Promise.all([
      orgRepository.personMeasures({
        window: asWindow(input.range),
        userIds: ids,
        today: todayDateOnly(),
      }),
      orgRepository.runningTasks(ids),
      orgRepository.findUsers(managerIds),
    ]);
    const byUser = new Map(measures.map((m) => [m.user_id, m]));
    const managerNames = new Map(managers.map((m) => [m.id, m.fullName ?? null]));

    const rows = members.map((user) => {
      const m = byUser.get(user.id) ?? { ...EMPTY };
      return {
        id: user.id,
        fullName: user.fullName ?? null,
        email: user.email ?? null,
        role: user.role,
        jobTitle: user.job_title ?? null,
        employeeId: user.employee_id ?? null,
        avatar: null,
        domainId: user.domain_id ?? null,
        managerId: user.manager_id ?? null,
        managerName: user.manager_id ? managerNames.get(user.manager_id) ?? null : null,
        isShared: !!user.is_shared,
        isBlocked: !!user.isBlocked,
        lastSeenAt: lastSeenIso(user),
        isOnline: isOnline(user),
        workload: {
          total: m.total,
          yetToStart: m.yet_to_start,
          inProgress: m.in_progress,
          completed: m.completed,
          blocked: m.blocked,
          overdue: m.overdue,
          hoursLogged: formatHours(m.total_seconds),
          efficiency: efficiencyOf(m),
        },
        runningTask: running.get(user.id) ?? null,
      };
    });

    rows.sort((a, b) => {
      const primary = sorter(a, b);
      const tie = MEMBER_SORTS.name(a, b);
      return descending ? -primary || tie : primary || tie;
    });

    const totalRecords = rows.length;
    const start = (input.page - 1) * input.limit;
    return {
      users: rows.slice(start, start + input.limit),
      totalRecords,
      totalPages: Math.ceil(totalRecords / input.limit),
      currentPage: input.page,
    };
  }

  // ── 4. GET /role-sp/department-tasks ──────────────────────────────────────
  public async departmentTasks(
    viewer: Viewer,
    input: {
      domainId: unknown;
      range: DateRange;
      status?: string;
      priority?: string;
      assignedTo?: string;
      projectId?: string;
      overdue?: boolean;
      page: number;
      limit: number;
    }
  ) {
    const domain = await this.assertDomainAccess(viewer, input.domainId);
    let assigneeIds = await this.departmentUserIds(String(domain.id));
    // assigned_to narrows within the department; someone outside it has no
    // tasks here, which is an empty page, not an error.
    if (input.assignedTo) {
      assigneeIds = assigneeIds.filter((uid) => uid === input.assignedTo);
    }
    let priority: string | undefined;
    if (input.priority) {
      priority = PRIORITIES.find(
        (p) => p.toLowerCase() === input.priority!.trim().toLowerCase()
      );
      if (!priority) throw new OrgValidationError("priority must be High, Medium or Low");
    }

    const today = todayDateOnly();
    const [{ tasks, totalCount }, meta] = await Promise.all([
      userRepository.departmentTasks({
        assigneeIds,
        window: input.range,
        offset: (input.page - 1) * input.limit,
        limit: input.limit,
        status: input.status,
        priority,
        projectId: input.projectId,
        overdueBefore: input.overdue ? today : undefined,
      }),
      orgRepository.taskStatusMeta({
        window: asWindow(input.range),
        userIds: assigneeIds,
        today,
        priority,
        projectId: input.projectId,
        overdueOnly: input.overdue,
      }),
    ]);

    return {
      tasks: decorateTasks(tasks, await commentAuthorsFor(tasks)),
      meta,
      totalRecords: totalCount,
      totalPages: Math.ceil(totalCount / input.limit),
      currentPage: input.page,
    };
  }

  // ── 5. GET /role-sp/employee-summary ──────────────────────────────────────
  public async employeeSummary(viewer: Viewer, userId: unknown, range: DateRange) {
    const id = typeof userId === "string" ? userId.trim() : "";
    if (!id) throw new OrgValidationError("user_id is required");
    const visible = await this.visibleDomainIds(viewer);

    const user = await orgRepository.findUser(id);
    if (!user) throw new OrgNotFoundError("User not found");

    if (visible) {
      // An AM reads someone in one of their departments, their own direct
      // report, or themselves.
      const memberships = await orgRepository.memberships();
      const inScope =
        user.id === viewer.id ||
        user.manager_id === viewer.id ||
        memberships.some((m) => m.user_id === user.id && visible.has(m.domain_id));
      if (!inScope) throw new OrgAccessError("You do not have access to this user");
    }

    const window = asWindow(range);
    const [department, manager, measures, daily, extensions, projects] = await Promise.all([
      user.domain_id ? SuperAdminRepository.findDomainById(user.domain_id) : Promise.resolve(null),
      user.manager_id ? orgRepository.findUser(user.manager_id) : Promise.resolve(null),
      orgRepository.personMeasures({ window, userIds: [user.id], today: todayDateOnly() }),
      reportRepository.dailyTotals({ userIds: [user.id], from: range.from, to: range.to }),
      orgRepository.extensionCount({ userId: user.id, window }),
      orgRepository.userProjects({ userId: user.id, window }),
    ]);

    const m = measures[0] ?? { ...EMPTY };
    const byDay = new Map(daily.map((d) => [d.date, d]));
    // Averaged over the days time was actually logged, so a weekend does not
    // halve the figure.
    const daysWorked = daily.filter((d) => d.total_seconds > 0).length;

    return {
      range: { from: range.from, to: range.to },
      user: {
        id: user.id,
        fullName: user.fullName ?? null,
        jobTitle: user.job_title ?? null,
        role: user.role,
        department: department ? { id: String(department.id), name: department.name } : null,
        manager: manager ? { id: manager.id, fullName: manager.fullName ?? null } : null,
        joiningDate: user.joining_date ?? null,
        avatar: null,
        isBlocked: !!user.isBlocked,
        isOnline: isOnline(user),
        lastSeenAt: lastSeenIso(user),
      },
      kpis: {
        assigned: m.total,
        completed: m.completed,
        overdue: m.overdue,
        onTimeRate: onTimeRateOf(m),
        efficiency: efficiencyOf(m),
        hoursLogged: formatHours(m.total_seconds),
        avgHoursPerDay: formatHours(daysWorked ? m.total_seconds / daysWorked : 0),
        extensions,
      },
      trend: eachDate(range).map((date) => ({
        date,
        completed: byDay.get(date)?.completed ?? 0,
        hours: formatHours(byDay.get(date)?.total_seconds ?? 0),
      })),
      projects,
    };
  }
}

export default new OrgService();
