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
  groups?: { total: number; active: number; activeMemberships: number };
  scheduling?: {
    todayLessons: number;
    weeklyLessons: number;
    activeClassrooms: number;
    timezone: string;
  };
  financial?: BillingSummary;
  debts?: DebtSummary;
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

export interface GroupInput {
  name: string;
  courseName: string;
  teacherId: string;
  capacity: number;
  monthlyFee: number;
  status: StudentStatus;
  startDate: string;
  description?: string;
}
export interface GroupView extends GroupInput {
  id: string;
  teacherName?: string;
  activeMemberCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface GroupsView {
  groups: GroupView[];
  total: number;
  page: number;
  pageSize: number;
}
export interface GroupMember {
  id: string;
  studentId: string;
  enrolledAt: string;
  status: "active" | "removed";
  student: {
    id: string;
    firstName: string;
    lastName: string;
    status: StudentStatus;
  } | null;
}
export interface GroupMembersView {
  members: GroupMember[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ClassroomView {
  id: string;
  name: string;
  capacity: number | null;
  description: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}
export interface ScheduleInput {
  groupId: string;
  teacherId: string;
  classroomId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  status: "active" | "inactive";
}
export interface ScheduleView extends ScheduleInput {
  id: string;
  groupName?: string;
  teacherName?: string;
  classroomName?: string;
  date?: string;
  createdAt: string;
  updatedAt: string;
}
export interface SchedulesView {
  schedules: ScheduleView[];
  total: number;
  page: number;
  pageSize: number;
  timezone: string;
  weekStart?: string;
  weekEnd?: string;
}
export interface ClassroomsView {
  classrooms: ClassroomView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BillingSummary {
  month: string;
  timezone: string;
  billedAmount: number;
  receivedAmount: number;
  outstandingAmount: number;
  paymentCount: number;
}
export interface ChargeView {
  id: string;
  studentId: string;
  groupId: string;
  billingMonth: string;
  studentName: string;
  groupName: string;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: "unpaid" | "partial" | "paid" | "cancelled";
  dueDate: string;
  createdAt: string;
  updatedAt: string;
}
export interface PaymentView {
  studentName?: string;
  id: string;
  studentId: string;
  chargeId: string;
  amount: number;
  method: "cash" | "bank_transfer" | "click_manual";
  paidAt: string;
  reference: string;
  note: string;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
  reversal: null | {
    id: string;
    reason: string;
    recordedBy: string;
    createdAt: string;
  };
}
export interface ChargesView {
  charges: ChargeView[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PaymentsView {
  payments: PaymentView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DebtSummary {
  outstandingAmount: number;
  overdueAmount: number;
  upcomingAmount: number;
  overdue1To7: number;
  overdue8To30: number;
  overdueMoreThan30: number;
  debtorCount: number;
  overdueDebtorCount: number;
  asOf: string;
  timezone: string;
}
export interface DebtCharge
  extends Omit<ChargeView, "createdAt" | "updatedAt"> {
  daysOverdue: number;
  agingBucket: "upcoming" | "1-7" | "8-30" | "31+";
}
export interface DebtsView {
  charges: DebtCharge[];
  total: number;
  page: number;
  pageSize: number;
  summary?: DebtSummary;
}
export interface GroupDebt extends Omit<DebtSummary, "asOf" | "timezone"> {
  groupId: string;
  groupName: string;
}

export interface FinancialGroup {
  id: string;
  name: string;
  students: number;
  billed: number;
  collected: number;
  outstanding: number;
  rate: number;
}
export interface FinancialReport {
  period: {
    start: string;
    end: string;
    firstMonth: string;
    lastMonth: string;
    timezone: string;
    asOf: string;
  };
  summary: {
    payments: number;
    paymentCount: number;
    billed: number;
    collected: number;
    outstanding: number;
    overdue: number;
    debtors: number;
    rate: number;
  };
  monthly: {
    month: string;
    billed: number;
    collected: number;
    payments: number;
    count: number;
  }[];
  aging: { bucket: string; amount: number }[];
  methods: { method: string; amount: number; count: number }[];
  groups: FinancialGroup[];
  totalGroups: number;
}
