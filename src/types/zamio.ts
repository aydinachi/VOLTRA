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

export enum ExamRegistrationStatus {
  REGISTERED = 'registered',
  CANCELLED = 'cancelled',
}

export enum ScheduleEventType {
  LECTURE = 'lecture',
  LAB = 'lab',
  EXAM = 'exam',
  PROJECT_DEADLINE = 'project_deadline',
}

export enum AnnouncementCategory {
  GENERAL = 'opste',
  EXAMS = 'ispiti',
  TEACHING = 'nastava',
  SEMESTER = 'semestar',
}

export enum AnnouncementAudience {
  ALL = 'all',
  STUDENTS = 'students',
  PROFESSORS = 'professors',
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface NotificationPreferences {
  resultsPublished: boolean;
  pointsChanged: boolean;
  attendanceRecorded: boolean;
  newExamTerm: boolean;
  announcements: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  resultsPublished: true,
  pointsChanged: true,
  attendanceRecorded: true,
  newExamTerm: true,
  announcements: true,
};

export interface UserProfile {
  uid: string;
  fullName: string;
  studentIndex: string;
  department: string;
  role: UserRole;
  academicYear: string;
  redeemedInviteId: string;
  academicTitle?: string;
  officeLocation?: string;
  consultationHours?: string;
  studyYear?: string;
  studyTrack?: string;
  personalNote?: string;
  provisionedByAdmin?: boolean;
  notificationPrefs?: NotificationPreferences;
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivate {
  uid: string;
  email: string;
  phone?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProvisionedAccount {
  id: string;
  targetEmail: string;
  fullName: string;
  role: 'student' | 'professor' | 'admin';
  studentIndex: string;
  department: string;
  studyTrack: string;
  studyYear: string;
  academicYear: string;
  academicTitle: string;
  officeLocation: string;
  consultationHours: string;
  authUid: string;
  status: 'active' | 'pending' | 'claimed';
  createdBy: string;
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
  professorNames?: string[];
  assistantNames?: string[];
  studyProgram?: string;
  categoryIds: string[];
  itemIds: string[];
  sessionIds: string[];
  examTermIds?: string[];
  scheduleEventIds?: string[];
  isArchived?: boolean;
  attendanceEnabled: boolean;
  attendanceMaxPoints: number;
  allowBonusPoints: boolean;
  activityMarksEnabled?: boolean;
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
  semester?: string;
  isArchived?: boolean;
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

export interface ExamTerm {
  id: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  title: string;
  examDate: string;
  examTime: string;
  classroom: string;
  registrationOpenDate: string;
  registrationCloseDate: string;
  notes: string;
  isOpen: boolean;
  createdBy: string;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ExamRegistration {
  id: string;
  termId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  termTitle: string;
  examDate: string;
  studentId: string;
  studentName: string;
  studentIndex: string;
  studentDepartment: string;
  status: ExamRegistrationStatus;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  audience: AnnouncementAudience;
  pinned: boolean;
  isPublished: boolean;
  authorUid: string;
  authorName: string;
  academicYear: string;
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ScheduleEvent {
  id: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  eventType: ScheduleEventType;
  title: string;
  isRecurringWeekly: boolean;
  dayOfWeek: number; // 1 = Ponedjeljak ... 7 = Nedjelja
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  location: string;
  description: string;
  createdBy: string;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AcademicState {
  id: string;
  activeAcademicYear: string;
  activeSemesterType: 'Zimski' | 'Ljetni';
  semesterLabel: string;
  updatedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ActivityAward {
  id: string;
  courseId: string;
  studentId: string;
  points: number;
  maxPoints: number; // 0 when awarded as pure activity/bonus without fixed item max
  date: string; // YYYY-MM-DD
  description: string;
  awardedBy: string;
  professorIds: string[];
  isSeed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SmartNotificationItem {
  id: string;
  category:
    | 'resultsPublished'
    | 'pointsChanged'
    | 'attendanceRecorded'
    | 'newExamTerm'
    | 'announcements';
  title: string;
  description: string;
  createdAtIso: string;
  read: boolean;
  targetNav?: string;
  targetCourseId?: string;
  targetSubTab?: 'courses' | 'exams' | 'history';
}

export interface AdminIndex {
  id: string;
  userIds: string[];
  provisionedIds: string[];
  courseIds: string[];
  enrollmentIds: string[];
  scheduleEventIds: string[];
  announcementIds: string[];
  updatedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}


