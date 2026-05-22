export interface domainAttributes {
  id?: string;
  name: string;
  description?: string;
  created_by?: string | null;
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
}
