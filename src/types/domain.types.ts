export interface domainAttributes {
  id?: string;
  name: string;
  description?: string;
  created_by?: string | null;
  head_user_id?: string | null;
  parent_id?: string | null;
  sort_order?: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface domainInput extends Partial<domainAttributes> {}

export interface DomainUpsertDTO {
  userId?: string;
  name: string;
  description?: string;
  created_by?: string;
  assigned_am_ids?: string[];
  // Key-presence semantics on edit: undefined leaves the column alone, null
  // (or "") clears it.
  parent_id?: string | null;
  head_user_id?: string | null;
  sort_order?: number | string | null;
}
