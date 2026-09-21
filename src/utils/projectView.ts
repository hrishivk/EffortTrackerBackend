// The single shape every project endpoint returns. GET /role-user/list-projects
// renders the table from it and GET /role-sp/project fills the edit screen from
// it, so the two can never disagree about a field name or a casing.
//
// `status` here is for DISPLAY ("ON HOLD"). It is NOT what POST /role-sp/project
// accepts back - see `editValues` on the detail response for the stored value.
export const toProjectView = (
  project: any,
  tasks: { total: number; completed: number } = { total: 0, completed: 0 },
) => {
  const plain =
    typeof project?.get === "function" ? project.get({ plain: true }) : project;

  const progress =
    tasks.total === 0 ? 0 : Math.round((tasks.completed / tasks.total) * 100);

  return {
    id: plain.id,
    name: plain.name,
    description: plain.description,
    dueDate: plain.end_date,
    startDate: plain.start_date,
    clientDepartment: plain.client_department || null,
    status: plain.status?.toUpperCase().replace("_", " ") || "ACTIVE",
    progress,
    totalTasks: tasks.total,
    completedTasks: tasks.completed,
    domain: plain.domain || null,
    teamAssigned: (plain.members || []).map((m: any) => ({
      id: m.id,
      name: m.fullName,
      avatar: "",
    })),
  };
};

// The detail response: the view above, plus the request body POST /role-sp/project
// expects back. The edit form populates itself from `editValues` and submits it
// verbatim - no field renaming, and no undoing the display casing on `status`.
export const toProjectDetailView = (
  project: any,
  tasks: { total: number; completed: number },
) => {
  const plain =
    typeof project?.get === "function" ? project.get({ plain: true }) : project;

  return {
    ...toProjectView(plain, tasks),
    editValues: {
      id: plain.id,
      name: plain.name,
      description: plain.description ?? "",
      domain_id: plain.domain_id ?? null,
      client_department: plain.client_department ?? null,
      start_date: plain.start_date ?? null,
      end_date: plain.end_date ?? null,
      status: plain.status ?? "active",
    },
  };
};
