export const ROLES = [
  "super_admin",
  "business_owner",
  "admin",
  "teacher",
] as const;
export type Role = (typeof ROLES)[number];
export interface UserView {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface TenantView {
  id: string;
  name: string;
}
export interface SessionView {
  user: UserView;
  tenant: TenantView | null;
}
export interface DashboardView {
  scope: "platform" | "tenant";
  tenantCount?: number;
  teamCount: number | null;
  adminCount: number | null;
  teacherCount: number | null;
  students?: StudentStatistics;
  joinedAt: string;
}
export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId: string;
    fields?: Record<string, string[]>;
  };
}

export type StudentStatus = "active" | "paused" | "archived";
export interface StudentStatistics {
  total: number;
  active: number;
  paused: number;
  recent: number;
}
export interface StudentInput {
  firstName: string;
  lastName: string;
  phone?: string;
  parentName?: string;
  parentPhone?: string;
  birthDate?: string | null;
  enrollmentDate?: string;
  notes?: string;
}
export interface StudentView extends StudentInput {
  id: string;
  status: StudentStatus;
  enrollmentDate: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface StudentsView {
  students: StudentView[];
  total: number;
  page: number;
  pageSize: number;
}
