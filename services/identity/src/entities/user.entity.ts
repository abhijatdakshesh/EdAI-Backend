export type UserRole =
  | 'STUDENT'
  | 'PARENT'
  | 'FACULTY'
  | 'HOD'
  | 'DEAN'
  | 'PRINCIPAL'
  | 'TRUSTEE'
  | 'COUNSELLOR'
  | 'ADMIN'
  | 'RECRUITER'
  | 'APPLICANT'
  | 'DRIVER';

export type Language = 'kn' | 'en' | 'hi' | 'ta' | 'te' | 'ml';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  institutionId: string;
  sapId?: string;
  departmentCode?: string;
  preferredLanguage: Language;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
