// Field-level validation shared by the add-user and edit-user paths.
//
// Every function throws a plain Error whose message is what the frontend
// snackbar renders, so the message text is part of the contract - the
// controller maps these strings onto 400s.
//
// Convention across this file: `undefined` means the caller did not send the
// field and it must be left alone; `null` means the caller sent "" and wants
// the column cleared. Only a real value is ever validated.

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const NAME_PATTERN = /^[A-Za-z ]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEN_DIGITS = /^\d{10}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Min 8 chars with at least one uppercase letter, one digit and one of @$!%*?&
const PASSWORD_MIN_LENGTH = 8;

export const isPresent = <T>(value: T | null | undefined): value is T =>
  value !== undefined && value !== null;

// A YYYY-MM-DD string that is also a real calendar day: "2024-02-31" matches
// the pattern but Postgres would reject it on the DATEONLY column.
const isRealDate = (value: string): boolean => {
  if (!DATE_ONLY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

export const assertValidFullName = (fullName?: string | null) => {
  if (fullName === undefined) return;
  const trimmed = String(fullName ?? "").trim();
  // Not clearable: a nameless user is unusable in every list the app renders
  if (!trimmed) throw new Error("Full name is required");
  if (!NAME_PATTERN.test(trimmed)) {
    throw new Error("Full name may only contain letters and spaces");
  }
};

export const assertValidEmail = (email?: string | null) => {
  if (email === undefined) return;
  const trimmed = String(email ?? "").trim();
  if (!trimmed) throw new Error("Email is required");
  if (!EMAIL_PATTERN.test(trimmed)) throw new Error("Email is not valid");
};

export const assertValidContactNumber = (contactNumber?: string | null) => {
  if (!isPresent(contactNumber)) return;
  if (!TEN_DIGITS.test(String(contactNumber).trim())) {
    throw new Error("Contact number must be exactly 10 digits");
  }
};

export const assertValidBloodGroup = (bloodGroup?: string | null) => {
  if (!isPresent(bloodGroup)) return;
  if (!BLOOD_GROUPS.includes(String(bloodGroup).trim().toUpperCase())) {
    throw new Error(`Blood group must be one of ${BLOOD_GROUPS.join(", ")}`);
  }
};

export const assertValidDate = (value: string | null | undefined, label: string) => {
  if (!isPresent(value)) return;
  if (!isRealDate(String(value).trim())) {
    throw new Error(`${label} must be a valid date in YYYY-MM-DD format`);
  }
};

export const assertValidPassword = (password?: string) => {
  const value = String(password ?? "");
  if (value.length < PASSWORD_MIN_LENGTH) {
    throw new Error("Password must be at least 8 characters long");
  }
  if (!/[A-Z]/.test(value)) {
    throw new Error("Password must contain at least one uppercase letter");
  }
  if (!/\d/.test(value)) {
    throw new Error("Password must contain at least one number");
  }
  if (!/[@$!%*?&]/.test(value)) {
    throw new Error("Password must contain at least one of @$!%*?&");
  }
};

// "1,4,9" -> ["1","4","9"]; "" -> []. The frontend sends a comma-separated
// string here, not an array - same shape add-user takes.
export const parseProjectIds = (projects: string | string[]): string[] => {
  const list = Array.isArray(projects) ? projects : String(projects ?? "").split(",");
  return [...new Set(list.map((id) => String(id).trim()).filter(Boolean))];
};
