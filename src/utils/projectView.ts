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
    // Backs the "Extended N times" badge on the row. On the LIST as well as the
    // detail, so the table can draw it without opening every project. Only the
    // count: the entries themselves are detail-panel material and would make
    // the list payload grow with every edit anyone ever made.
    extension_count: (Array.isArray(plain.activity) ? plain.activity : []).filter(
      (entry: any) => entry?.action === "extended",
    ).length,
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

    // The full member rows, for the edit form's member picker. `teamAssigned`
    // above stays exactly as it was — it is the table's avatar strip and wants
    // {id, name, avatar}, which is a different shape for a different job.
    //
    // This is what removes the roster scan: the picker used to fetch every user
    // in the organisation and keep the ones whose projects[] contained this id.
    // SP accounts are excluded by the query, not here.
    members: (plain.members || []).map((m: any) => ({
      id: m.id,
      fullName: m.fullName,
      email: m.email ?? null,
      role: m.role ?? null,
    })),

    // Audit fields. Not on toProjectView because the table draws neither, but
    // the detail screen can show "created by X on Y".
    created_by: plain.created_by ?? null,
    created_at: plain.created_at ?? plain.createdAt ?? null,

    // The Activity panel. NEWEST FIRST — the opposite of a task's extensions[],
    // because this is a feed read from the top, not a chronological log read
    // from the beginning.
    //
    // Stored oldest-first (it is an append-only jsonb array) and reversed here,
    // so the write path stays a plain `||` append.
    activity: [...(Array.isArray(plain.activity) ? plain.activity : [])]
      .sort(
        (a: any, b: any) =>
          new Date(b?.created_at ?? 0).getTime() -
          new Date(a?.created_at ?? 0).getTime(),
      ),

    // Only the pushes. `activity.length` counts renames and status moves too,
    // so the badge needs its own number.
    extension_count: (Array.isArray(plain.activity) ? plain.activity : []).filter(
      (entry: any) => entry?.action === "extended",
    ).length,

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
