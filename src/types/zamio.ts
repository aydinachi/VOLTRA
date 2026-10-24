export enum UserRole {
  STUDENT = 'student',
  PROFESSOR = 'professor',
  ADMIN = 'admin',
}

export enum FinalGradeStatus {
  DRAFT = 'draft',
  FINALIZED = 'finalized',
}

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REVOKED = 'revoked',
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface UserProfile {
  uid: string;
  fullName: string;
  studentIndex: string;
  department: string;
  role: UserRole;
  academicYear: string;
  redeemedInviteId: string;
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivate {
  uid: string;
  email: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudentDirectoryEntry {
  studentIndex: string;
  uid: string;
  fullName: string;
  department: string;
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Invitation {
  id: string;
  code: string;
  targetEmail: string;
  role: 'professor';
  status: InvitationStatus;
  createdBy: string;
  acceptedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  semester: string;
  academicYear: string;
  ects: number;
  leadProfessorId: string;
  leadProfessorName: string;
  professorIds: string[];
  categoryIds: string[];
  itemIds: string[];
  sessionIds: string[];
  attendanceEnabled: boolean;
  attendanceMaxPoints: number;
  allowBonusPoints: boolean;
  grade6Threshold: number;
  grade7Threshold: number;
  grade8Threshold: number;
  grade9Threshold: number;
  grade10Threshold: number;
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Enrollment {
  id: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  leadProfessorName: string;
  academicYear: string;
  studentId: string;
  studentName: string;
  studentIndex: string;
  studentDepartment: string;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GradingCategory {
  id: string;
  courseId: string;
  name: string;
  maxPoints: number;
  order: number;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GradingItem {
  id: string;
  courseId: string;
  categoryId: string;
  name: string;
  maxPoints: number;
  date: string;
  description: string;
  order: number;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Score {
  id: string;
  courseId: string;
  categoryId: string;
  itemId: string;
  studentId: string;
  points: number;
  feedback: string;
  gradedBy: string;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendanceSession {
  id: string;
  courseId: string;
  date: string;
  time: string;
  topic: string;
  isCancelled: boolean;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendanceRecord {
  id: string;
  courseId: string;
  sessionId: string;
  studentId: string;
  present: boolean;
  note: string;
  markedBy: string;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FinalGrade {
  id: string;
  courseId: string;
  studentId: string;
  totalPoints: number;
  finalGrade: number;
  status: FinalGradeStatus;
  finalizedBy: string;
  comment: string;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}
