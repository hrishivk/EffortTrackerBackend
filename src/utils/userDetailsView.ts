import _ from "lodash";

// The single shape the edit-user modal consumes. GET /role-sp/user-details
// fills the form from it and PATCH /role-sp/edit-user echoes it back, so the
// modal can refresh itself from the save response without a second fetch.
export const toUserDetailsView = (user: any) => {
  const plain = typeof user?.get === "function" ? user.get({ plain: true }) : user;

  // lastSeenAt is a free-text column: an ISO string after a login, null after a
  // logout, or the "No login activity recorded" placeholder for a user who has
  // never signed in. Normalize to ISO-or-null.
  const lastSeen = plain.lastSeenAt ? new Date(plain.lastSeenAt) : null;
  const lastSeenAt =
    lastSeen && !isNaN(lastSeen.getTime()) ? lastSeen.toISOString() : null;

  return {
    ..._.pick(plain, ["id", "fullName", "email", "role"]),

    isBlocked: plain.isBlocked ?? false,
    is_shared: plain.is_shared ?? false,
    manager_id: plain.manager_id ?? null,

    contactNumber: plain.contact_number ?? null,
    jobTitle: plain.job_title ?? null,
    employeeId: plain.employee_id ?? null,
    department: plain.department ?? null,
    dateOfBirth: plain.date_of_birth ?? null,
    bloodGroup: plain.blood_group ?? null,
    workSchedule: plain.work_schedule ?? null,
    joiningDate: plain.joining_date ?? null,

    projects: (plain.projects ?? []).map((p: any) => ({
      id: String(p.id),
      name: p.name,
    })),
    // Only shared users are domain-scoped; everyone else gets an empty list
    domains: plain.is_shared
      ? (plain.assignedDomains ?? []).map((d: any) => ({
          id: String(d.id),
          name: d.name,
        }))
      : [],

    createdAt: plain.createdAt ?? null,
    lastSeenAt,
    // No avatar column yet - placeholder so the contract does not change
    // when one is added.
    image: null,
  };
};
