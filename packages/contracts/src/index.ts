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
