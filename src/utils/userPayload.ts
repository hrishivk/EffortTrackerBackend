// The add-user and edit-user forms send camelCase keys; the service and
// repository layers work in the snake_case column names. This maps one onto the
// other so a form field can never be silently dropped again. If a caller sends
// both spellings, snake_case wins.
//
// Blank strings become null rather than "": an untouched optional input would
// otherwise reach Postgres as '' and either blow up the DATEONLY columns
// (date_of_birth, joining_date) or collide on the unique employee_id index.

const blankToNull = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
};

const toBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  return value === true || String(value).toLowerCase() === "true";
};

export interface NormalizedUserPayload {
  id?: string;
  fullName?: string;
  email?: string;
  password?: string;
  role?: string;
  manager_id?: string | null;
  is_shared?: boolean;
  job_title?: string | null;
  employee_id?: string | null;
  contact_number?: string | null;
  date_of_birth?: string | null;
  blood_group?: string | null;
  department?: string | null;
  work_schedule?: string | null;
  joining_date?: string | null;
  require_password_change?: boolean;
  projects?: string;
  domain_ids?: string | string[];
  sendWelcomeEmail?: boolean;
}

export const normalizeUserPayload = (body: any): NormalizedUserPayload => {
  const src = body ?? {};
  // snake_case takes precedence when a caller sends both spellings
  const pick = (snake: string, camel: string) =>
    src[snake] !== undefined ? src[snake] : src[camel];

  return {
    id: src.id,
    fullName: src.fullName ?? src.full_name,
    email: src.email,
    password: src.password,
    role: src.role,

    manager_id: blankToNull(pick("manager_id", "managerId")),
    is_shared: toBoolean(pick("is_shared", "isShared")),

    job_title: blankToNull(pick("job_title", "jobTitle")),
    employee_id: blankToNull(pick("employee_id", "employeeId")),
    contact_number: blankToNull(pick("contact_number", "contactNumber")),
    date_of_birth: blankToNull(pick("date_of_birth", "dateOfBirth")),
    blood_group: blankToNull(pick("blood_group", "bloodGroup")),
    department: blankToNull(src.department),
    work_schedule: blankToNull(pick("work_schedule", "workSchedule")),
    joining_date: blankToNull(pick("joining_date", "joiningDate")),

    require_password_change: toBoolean(
      pick("require_password_change", "requirePasswordChange"),
    ),
    sendWelcomeEmail: toBoolean(
      pick("send_welcome_email", "sendWelcomeEmail"),
    ),

    projects: pick("projects", "projectIds"),
    domain_ids: pick("domain_ids", "domainIds"),
  };
};
