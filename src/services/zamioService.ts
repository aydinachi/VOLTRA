import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAP_ADMIN_EMAIL,
  db,
  handleFirestoreError,
  secondaryAuth,
} from '../lib/firebase';
import { addDaysIso, getExamWindowState, getTodayIsoLocal } from '../lib/calculations';
import {
  formatStudentRosterProgramLabel,
  MASTER_RI_PROGRAM,
  normalizeStudyTrack,
  STRUCNI_RS_PROGRAM,
} from '../lib/programs';
import {
  emailToProvisionId,
  isValidIsoDate,
  isValidResourceId,
  sanitizeStaffList,
  sanitizeText,
  validateExamTermDates,
  validateGradeThresholds,
  validateScoreInput,
  validateActivityAwardInput,
  VALIDATION_CONSTRAINTS,
} from '../lib/validation';
import {
  AcademicState,
  ActivityAward,
  AdminIndex,
  Announcement,
  AnnouncementAudience,
  AnnouncementCategory,
  AttendanceRecord,
  AttendanceSession,
  Course,
  DEFAULT_NOTIFICATION_PREFS,
  Enrollment,
  ExamRegistration,
  ExamRegistrationStatus,
  ExamTerm,
  FinalGrade,
  FinalGradeStatus,
  GradingCategory,
  GradingItem,
  Invitation,
  InvitationStatus,
  NotificationPreferences,
  OperationType,
  ProvisionedAccount,
  ScheduleEvent,
  ScheduleEventType,
  Score,
  StudentDirectoryEntry,
  UserPrivate,
  UserProfile,
  UserRole,
} from '../types/zamio';

function makeEntityId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`;
}

export function getSeenExamRegsStorageKey(uid: string): string {
  return `voltra_seen_exam_regs_v1_${uid}`;
}

function recordStudentSelfExamAction(
  uid: string,
  registrationId: string,
  status: ExamRegistrationStatus
): void {
  try {
    const key = getSeenExamRegsStorageKey(uid);
    const raw = localStorage.getItem(key);
    const parsed: Record<string, string> = raw ? JSON.parse(raw) : {};
    parsed[registrationId] = status;
    localStorage.setItem(key, JSON.stringify(parsed));
  } catch {
    // Ignore storage quota errors
  }
}

async function runParallelChunks<T>(
  items: T[],
  chunkSize: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    await Promise.all(slice.map((item) => worker(item)));
  }
}

function isCurrentSessionBootstrapAdmin(): boolean {
  const cur = auth.currentUser;
  if (!cur || !cur.email) return false;
  const emailLower = cur.email.toLowerCase();
  return (
    emailLower === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() ||
    emailLower === 'samir.admin@etf.unsa.ba'
  );
}

const adminIndexDraft: {
  userIds: string[];
  provisionedIds: string[];
  courseIds: string[];
  enrollmentIds: string[];
  scheduleEventIds: string[];
  announcementIds: string[];
} = {
  userIds: [],
  provisionedIds: [],
  courseIds: [],
  enrollmentIds: [],
  scheduleEventIds: [],
  announcementIds: [],
};

const adminIndexLoadedSections = new Set<string>();
let lastFlushedAdminIndexSig = '';
let adminIndexFlushTimer: ReturnType<typeof setTimeout> | null = null;

function sanitizeIndexIdArray(ids: string[], maxLen: number): string[] {
  const unique = Array.from(
    new Set(
      ids.filter((id) => typeof id === 'string' && isValidResourceId(id, 128))
    )
  );
  return unique.slice(0, maxLen);
}

function scheduleBootstrapAdminIndexFlush(): void {
  if (!isCurrentSessionBootstrapAdmin()) return;
  if (adminIndexFlushTimer) {
    clearTimeout(adminIndexFlushTimer);
  }
  adminIndexFlushTimer = setTimeout(async () => {
    adminIndexFlushTimer = null;
    const cur = auth.currentUser;
    if (!cur || !isCurrentSessionBootstrapAdmin()) return;

    try {
      const ref = doc(db, 'adminIndex', 'global');
      const snap = await getDoc(ref);
      const existing = snap.exists() ? (snap.data() as Partial<AdminIndex>) : {};

      const nextPayload = {
        userIds: sanitizeIndexIdArray(
          adminIndexLoadedSections.has('userIds')
            ? adminIndexDraft.userIds
            : (existing.userIds ?? []),
          500
        ),
        provisionedIds: sanitizeIndexIdArray(
          adminIndexLoadedSections.has('provisionedIds')
            ? adminIndexDraft.provisionedIds
            : (existing.provisionedIds ?? []),
          500
        ),
        courseIds: sanitizeIndexIdArray(
          adminIndexLoadedSections.has('courseIds')
            ? adminIndexDraft.courseIds
            : (existing.courseIds ?? []),
          200
        ),
        enrollmentIds: sanitizeIndexIdArray(
          adminIndexLoadedSections.has('enrollmentIds')
            ? adminIndexDraft.enrollmentIds
            : (existing.enrollmentIds ?? []),
          1000
        ),
        scheduleEventIds: sanitizeIndexIdArray(
          adminIndexLoadedSections.has('scheduleEventIds')
            ? adminIndexDraft.scheduleEventIds
            : (existing.scheduleEventIds ?? []),
          500
        ),
        announcementIds: sanitizeIndexIdArray(
          adminIndexLoadedSections.has('announcementIds')
            ? adminIndexDraft.announcementIds
            : (existing.announcementIds ?? []),
          200
        ),
      };

      const sig = JSON.stringify(nextPayload);
      if (snap.exists() && sig === lastFlushedAdminIndexSig) {
        return;
      }

      if (snap.exists()) {
        await updateDoc(ref, {
          ...nextPayload,
          updatedBy: cur.uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ...nextPayload,
          updatedBy: cur.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      lastFlushedAdminIndexSig = sig;
    } catch {
      // Non-blocking admin index sync
    }
  }, 400);
}

async function mutateAdminIndex(delta: {
  addUserIds?: string[];
  removeUserIds?: string[];
  addProvisionedIds?: string[];
  removeProvisionedIds?: string[];
  addCourseIds?: string[];
  removeCourseIds?: string[];
  addEnrollmentIds?: string[];
  removeEnrollmentIds?: string[];
  addScheduleEventIds?: string[];
  removeScheduleEventIds?: string[];
  addAnnouncementIds?: string[];
  removeAnnouncementIds?: string[];
}): Promise<void> {
  const cur = auth.currentUser;
  if (!cur || !isCurrentSessionBootstrapAdmin()) return;

  try {
    const ref = doc(db, 'adminIndex', 'global');
    const snap = await getDoc(ref);
    const existing = snap.exists() ? (snap.data() as Partial<AdminIndex>) : {};

    const applyDelta = (
      base: string[] | undefined,
      add: string[] | undefined,
      rem: string[] | undefined,
      maxLen: number
    ): string[] => {
      const removeSet = new Set(rem ?? []);
      const merged = [...(base ?? []), ...(add ?? [])].filter((id) => !removeSet.has(id));
      return sanitizeIndexIdArray(merged, maxLen);
    };

    const nextPayload = {
      userIds: applyDelta(existing.userIds, delta.addUserIds, delta.removeUserIds, 500),
      provisionedIds: applyDelta(
        existing.provisionedIds,
        delta.addProvisionedIds,
        delta.removeProvisionedIds,
        500
      ),
      courseIds: applyDelta(existing.courseIds, delta.addCourseIds, delta.removeCourseIds, 200),
      enrollmentIds: applyDelta(
        existing.enrollmentIds,
        delta.addEnrollmentIds,
        delta.removeEnrollmentIds,
        1000
      ),
      scheduleEventIds: applyDelta(
        existing.scheduleEventIds,
        delta.addScheduleEventIds,
        delta.removeScheduleEventIds,
        500
      ),
      announcementIds: applyDelta(
        existing.announcementIds,
        delta.addAnnouncementIds,
        delta.removeAnnouncementIds,
        200
      ),
    };

    if (snap.exists()) {
      await updateDoc(ref, {
        ...nextPayload,
        updatedBy: cur.uid,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...nextPayload,
        updatedBy: cur.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    lastFlushedAdminIndexSig = JSON.stringify(nextPayload);
  } catch {
    // Non-blocking for non-admin callers
  }
}

export async function ensureUserAccount(params: {
  uid: string;
  email: string;
  displayName: string;
  emailVerified?: boolean;
}): Promise<{ profile: UserProfile; privateData: UserPrivate; isAdminUser: boolean }> {
  const { uid, email, displayName, emailVerified = false } = params;
  const profilePath = `userProfiles/${uid}`;
  const privatePath = `userPrivate/${uid}`;

  const isBootstrap =
    Boolean(email) &&
    (email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() ||
      email.toLowerCase() === 'samir.admin@etf.unsa.ba');
  let hasAdminDoc = false;

  if (!isBootstrap) {
    try {
      const adminSnap = await getDoc(doc(db, 'admins', uid));
      hasAdminDoc = adminSnap.exists();
    } catch {
      hasAdminDoc = false;
    }
  }

  const isAdminUser = isBootstrap || hasAdminDoc;

  let profileSnap;
  try {
    profileSnap = await getDoc(doc(db, 'userProfiles', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }

  let profile: UserProfile;
  if (!profileSnap.exists()) {
    const cleanName = sanitizeText(
      displayName || email.split('@')[0] || 'Korisnik',
      VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH
    );

    // Check if Administrator pre-provisioned an account record for this email
    let claimedProvision: ProvisionedAccount | null = null;
    const provId = email ? emailToProvisionId(email) : '';
    if (provId) {
      try {
        const provSnap = await getDoc(doc(db, 'provisionedAccounts', provId));
        if (provSnap.exists()) {
          const pData = provSnap.data() as ProvisionedAccount;
          if (
            (pData.status === 'pending' || pData.status === 'active' || pData.status === 'claimed') &&
            pData.targetEmail.toLowerCase() === email.toLowerCase()
          ) {
            claimedProvision = { ...pData, id: provSnap.id };
          }
        }
      } catch {
        // Non-blocking lookup
      }
    }

    if (!claimedProvision && email.toLowerCase() === 'sribic@etf.unsa.ba') {
      claimedProvision = {
        id: provId || 'prov_sribic',
        targetEmail: 'sribic@etf.unsa.ba',
        fullName: 'Samir Ribić',
        role: 'professor',
        studentIndex: '',
        department: 'Računarstvo i informatika',
        studyTrack: '',
        studyYear: '',
        academicYear: '2026/2027',
        academicTitle: 'doc. dr.',
        officeLocation: 'Kabinet 3-11, Kampus UNSA',
        consultationHours: 'Utorak i četvrtak 11:00–13:00',
        authUid: uid,
        status: 'claimed',
        createdBy: 'system',
        createdAt: null as any,
        updatedAt: null as any,
      };
    }

    if (claimedProvision && !isAdminUser) {
      const assignedRole =
        claimedProvision.role === 'admin'
          ? UserRole.ADMIN
          : claimedProvision.role === 'professor'
            ? UserRole.PROFESSOR
            : UserRole.STUDENT;
      const assignedTrack = normalizeStudyTrack(claimedProvision.studyTrack);
      const assignedIndex = sanitizeText(
        claimedProvision.studentIndex,
        VALIDATION_CONSTRAINTS.STUDENT_INDEX_MAX_LENGTH
      );
      const assignedName =
        sanitizeText(claimedProvision.fullName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH) ||
        cleanName;
      const assignedDept =
        sanitizeText(claimedProvision.department, VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH) ||
        'Računarstvo i informatika';
      const assignedYear =
        sanitizeText(
          claimedProvision.academicYear,
          VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH
        ) || '2026/2027';

      const batch = writeBatch(db);
      batch.set(doc(db, 'userProfiles', uid), {
        uid,
        fullName: assignedName,
        studentIndex: assignedIndex,
        department: assignedDept,
        role: assignedRole,
        academicYear: assignedYear,
        redeemedInviteId: provId,
        academicTitle: sanitizeText(
          claimedProvision.academicTitle || '',
          VALIDATION_CONSTRAINTS.ACADEMIC_TITLE_MAX_LENGTH
        ),
        officeLocation: sanitizeText(
          claimedProvision.officeLocation || '',
          VALIDATION_CONSTRAINTS.OFFICE_LOCATION_MAX_LENGTH
        ),
        consultationHours: sanitizeText(
          claimedProvision.consultationHours || '',
          VALIDATION_CONSTRAINTS.CONSULTATION_HOURS_MAX_LENGTH
        ),
        studyYear: sanitizeText(
          claimedProvision.studyYear || '',
          VALIDATION_CONSTRAINTS.STUDY_YEAR_MAX_LENGTH
        ),
        studyTrack: sanitizeText(assignedTrack, VALIDATION_CONSTRAINTS.STUDY_TRACK_MAX_LENGTH),
        personalNote: '',
        notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'provisionedAccounts', provId), {
        status: 'claimed',
        authUid: uid,
        updatedAt: serverTimestamp(),
      });

      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, profilePath);
      }

      if (assignedIndex) {
        try {
          const dirRef = doc(db, 'studentDirectory', assignedIndex);
          const dirSnap = await getDoc(dirRef);
          if (!dirSnap.exists()) {
            await setDoc(dirRef, {
              studentIndex: assignedIndex,
              uid,
              fullName: assignedName,
              department:
                sanitizeText(
                  formatStudentRosterProgramLabel(assignedDept, assignedTrack),
                  VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH
                ) || assignedDept,
              isSeed: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch {
          // Optional directory sync
        }
      }

      profile = {
        uid,
        fullName: assignedName,
        studentIndex: assignedIndex,
        department: assignedDept,
        role: assignedRole,
        academicYear: assignedYear,
        redeemedInviteId: provId,
        academicTitle: claimedProvision.academicTitle || '',
        officeLocation: claimedProvision.officeLocation || '',
        consultationHours: claimedProvision.consultationHours || '',
        studyYear: claimedProvision.studyYear || '',
        studyTrack: assignedTrack,
        personalNote: '',
        notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
        isSeed: false,
      };
    } else {
      const defaultIndex = isAdminUser ? '19001' : '';
      const initialRole = isAdminUser ? UserRole.ADMIN : UserRole.STUDENT;

      const payload: Record<string, unknown> = {
        uid,
        fullName: cleanName,
        studentIndex: defaultIndex,
        department: 'Računarstvo i informatika',
        role: initialRole,
        academicYear: '2026/2027',
        redeemedInviteId: '',
        academicTitle: isAdminUser ? 'vanr. prof. dr.' : '',
        officeLocation: isAdminUser ? 'Kabinet 3-14, Kampus UNSA' : '',
        consultationHours: isAdminUser ? 'Utorak 12:00–14:00, Četvrtak 11:00–12:00' : '',
        studyYear: 'II godina · I ciklus (Bachelor)',
        studyTrack: 'Bachelor · Računarstvo i informatika',
        personalNote: '',
        notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (isAdminUser) {
        payload.provisionedByAdmin = true;
      }

      try {
        await setDoc(doc(db, 'userProfiles', uid), payload);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, profilePath);
      }

      if (defaultIndex) {
        try {
          const dirSnap = await getDoc(doc(db, 'studentDirectory', defaultIndex));
          if (!dirSnap.exists()) {
            await setDoc(doc(db, 'studentDirectory', defaultIndex), {
              studentIndex: defaultIndex,
              uid,
              fullName: cleanName,
              department: 'Računarstvo i informatika',
              isSeed: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch {
          // Optional index sync
        }
      }

      profile = {
        uid,
        fullName: cleanName,
        studentIndex: defaultIndex,
        department: 'Računarstvo i informatika',
        role: initialRole,
        academicYear: '2026/2027',
        redeemedInviteId: '',
        academicTitle: isAdminUser ? 'vanr. prof. dr.' : '',
        officeLocation: isAdminUser ? 'Kabinet 3-14, Kampus UNSA' : '',
        consultationHours: isAdminUser ? 'Utorak 12:00–14:00, Četvrtak 11:00–12:00' : '',
        studyYear: 'II godina · I ciklus (Bachelor)',
        studyTrack: 'Bachelor · Računarstvo i informatika',
        personalNote: '',
        provisionedByAdmin: isAdminUser ? true : undefined,
        notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
        isSeed: false,
      };
    }
  } else {
    const data = profileSnap.data() as UserProfile;
    const isProfEmail = email.toLowerCase() === 'sribic@etf.unsa.ba';
    const isAdminEmail =
      email.toLowerCase() === 'samir.admin@etf.unsa.ba' ||
      email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();

    const effectiveRole = isAdminEmail || hasAdminDoc
      ? UserRole.ADMIN
      : isProfEmail
        ? UserRole.PROFESSOR
        : data.role;

    if (
      data.role !== effectiveRole ||
      !data.provisionedByAdmin ||
      (isProfEmail && data.role !== UserRole.PROFESSOR)
    ) {
      try {
        await updateDoc(doc(db, 'userProfiles', uid), {
          role: effectiveRole,
          provisionedByAdmin: true,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking profile flag sync
      }
    }

    if (effectiveRole === UserRole.ADMIN && !hasAdminDoc && !isBootstrap) {
      try {
        await setDoc(doc(db, 'admins', uid), {
          uid,
          grantedBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        hasAdminDoc = true;
      } catch {
        // Non-blocking admin registry sync
      }
    }

    if (isProfEmail) {
      try {
        const osRef = doc(db, 'courses', 'seed_crs_os');
        const osSnap = await getDoc(osRef);
        if (osSnap.exists()) {
          const osData = osSnap.data() as Course;
          if (!osData.professorIds.includes(uid)) {
            await updateDoc(osRef, {
              professorIds: Array.from(new Set([...osData.professorIds, uid])).slice(
                0,
                VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
              ),
              updatedAt: serverTimestamp(),
            });
          }
        }
      } catch {
        // Non-blocking course sync
      }

      try {
        const arRef = doc(db, 'courses', 'seed_crs_ar');
        const arSnap = await getDoc(arRef);
        if (arSnap.exists()) {
          const arData = arSnap.data() as Course;
          if (!arData.professorIds.includes(uid)) {
            await updateDoc(arRef, {
              professorIds: Array.from(new Set([...arData.professorIds, uid])).slice(
                0,
                VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
              ),
              updatedAt: serverTimestamp(),
            });
          }
        }
      } catch {
        // Non-blocking course sync
      }
    }

    profile = {
      ...data,
      uid,
      role: effectiveRole,
      studyTrack: data.studyTrack ? normalizeStudyTrack(data.studyTrack) : data.studyTrack,
      notificationPrefs: data.notificationPrefs
        ? { ...DEFAULT_NOTIFICATION_PREFS, ...data.notificationPrefs }
        : DEFAULT_NOTIFICATION_PREFS,
    };
  }

  let privateSnap;
  try {
    privateSnap = await getDoc(doc(db, 'userPrivate', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, privatePath);
  }

  const safeEmail = sanitizeText(email, VALIDATION_CONSTRAINTS.EMAIL_MAX_LENGTH);
  let resolvedPhone = '';
  let resolvedEmail = safeEmail;

  if (!privateSnap.exists()) {
    if (emailVerified && safeEmail) {
      try {
        await setDoc(doc(db, 'userPrivate', uid), {
          uid,
          email: safeEmail,
          phone: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, privatePath);
      }
    }
  } else {
    const priv = privateSnap.data() as UserPrivate;
    resolvedEmail = priv.email || safeEmail;
    resolvedPhone = priv.phone || '';
  }

  return {
    profile,
    privateData: { uid, email: resolvedEmail, phone: resolvedPhone },
    isAdminUser: isAdminUser || profile.role === UserRole.ADMIN,
  };
}

/**
 * Student self-service profile update: strictly writes ONLY personalNote and notificationPrefs
 * on userProfiles/{uid}, and phone on userPrivate/{uid}. Faculty-assigned fields (studentIndex,
 * studyTrack, studyYear, department, fullName, academicYear) are locked by both UI and Firestore rules.
 */
export async function updateStudentOwnAllowedProfile(
  uid: string,
  updates: {
    personalNote: string;
    notificationPrefs: NotificationPreferences;
    phone: string;
  }
): Promise<void> {
  const cleanNote = sanitizeText(
    updates.personalNote,
    VALIDATION_CONSTRAINTS.PERSONAL_NOTE_MAX_LENGTH
  );
  const cleanPhone = sanitizeText(updates.phone, VALIDATION_CONSTRAINTS.PHONE_MAX_LENGTH);
  const cleanPrefs: NotificationPreferences = {
    resultsPublished: Boolean(updates.notificationPrefs.resultsPublished),
    pointsChanged: Boolean(updates.notificationPrefs.pointsChanged),
    attendanceRecorded: Boolean(updates.notificationPrefs.attendanceRecorded),
    newExamTerm: Boolean(updates.notificationPrefs.newExamTerm),
    announcements: Boolean(updates.notificationPrefs.announcements),
  };

  try {
    await updateDoc(doc(db, 'userProfiles', uid), {
      personalNote: cleanNote,
      notificationPrefs: cleanPrefs,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `userProfiles/${uid}`);
  }

  try {
    const privRef = doc(db, 'userPrivate', uid);
    const privSnap = await getDoc(privRef);
    if (privSnap.exists()) {
      await updateDoc(privRef, {
        phone: cleanPhone,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `userPrivate/${uid}`);
  }
}

/**
 * Professor / Admin self-service profile update: allows editing all professor fields
 * plus optional contact phone and personal note.
 */
export async function updateProfessorOwnProfile(
  uid: string,
  updates: {
    fullName: string;
    department: string;
    academicYear: string;
    academicTitle: string;
    officeLocation: string;
    consultationHours: string;
    personalNote?: string;
    phone?: string;
  }
): Promise<void> {
  const fullName = sanitizeText(updates.fullName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH);
  if (!fullName) {
    throw new Error('Ime i prezime nastavnika je obavezno.');
  }
  const department =
    sanitizeText(updates.department, VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH) ||
    'Računarstvo i informatika';
  const academicYear =
    sanitizeText(updates.academicYear, VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH) ||
    '2026/2027';

  const patch: Record<string, unknown> = {
    fullName,
    department,
    academicYear,
    academicTitle: sanitizeText(
      updates.academicTitle,
      VALIDATION_CONSTRAINTS.ACADEMIC_TITLE_MAX_LENGTH
    ),
    officeLocation: sanitizeText(
      updates.officeLocation,
      VALIDATION_CONSTRAINTS.OFFICE_LOCATION_MAX_LENGTH
    ),
    consultationHours: sanitizeText(
      updates.consultationHours,
      VALIDATION_CONSTRAINTS.CONSULTATION_HOURS_MAX_LENGTH
    ),
    updatedAt: serverTimestamp(),
  };

  if (updates.personalNote !== undefined) {
    patch.personalNote = sanitizeText(
      updates.personalNote,
      VALIDATION_CONSTRAINTS.PERSONAL_NOTE_MAX_LENGTH
    );
  }

  try {
    await updateDoc(doc(db, 'userProfiles', uid), patch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `userProfiles/${uid}`);
  }

  if (updates.phone !== undefined) {
    const cleanPhone = sanitizeText(updates.phone, VALIDATION_CONSTRAINTS.PHONE_MAX_LENGTH);
    try {
      const privRef = doc(db, 'userPrivate', uid);
      const privSnap = await getDoc(privRef);
      if (privSnap.exists()) {
        await updateDoc(privRef, {
          phone: cleanPhone,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `userPrivate/${uid}`);
    }
  }
}

export async function updateOwnProfile(
  uid: string,
  prevIndex: string,
  updates: {
    fullName: string;
    studentIndex: string;
    department: string;
    academicYear: string;
    academicTitle?: string;
    officeLocation?: string;
    consultationHours?: string;
    studyYear?: string;
    studyTrack?: string;
  }
): Promise<void> {
  const fullName = sanitizeText(updates.fullName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH);
  const studentIndex = sanitizeText(
    updates.studentIndex,
    VALIDATION_CONSTRAINTS.STUDENT_INDEX_MAX_LENGTH
  );
  const department =
    sanitizeText(updates.department, VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH) ||
    'Računarstvo i informatika';
  const academicYear =
    sanitizeText(updates.academicYear, VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH) ||
    '2026/2027';

  if (!fullName) {
    throw new Error('Ime i prezime je obavezno.');
  }
  if (studentIndex && !VALIDATION_CONSTRAINTS.STUDENT_INDEX_PATTERN.test(studentIndex)) {
    throw new Error('Broj indeksa smije sadržavati samo slova, brojeve, crticu ili donju crtu.');
  }

  if (studentIndex && studentIndex !== prevIndex) {
    const existingDir = await getDoc(doc(db, 'studentDirectory', studentIndex));
    if (existingDir.exists() && existingDir.data().uid !== uid) {
      throw new Error(`Broj indeksa ${studentIndex} već koristi drugi student.`);
    }
  }

  const profilePatch: Record<string, unknown> = {
    fullName,
    studentIndex,
    department,
    academicYear,
    updatedAt: serverTimestamp(),
  };

  if (updates.academicTitle !== undefined) {
    profilePatch.academicTitle = sanitizeText(
      updates.academicTitle,
      VALIDATION_CONSTRAINTS.ACADEMIC_TITLE_MAX_LENGTH
    );
  }
  if (updates.officeLocation !== undefined) {
    profilePatch.officeLocation = sanitizeText(
      updates.officeLocation,
      VALIDATION_CONSTRAINTS.OFFICE_LOCATION_MAX_LENGTH
    );
  }
  if (updates.consultationHours !== undefined) {
    profilePatch.consultationHours = sanitizeText(
      updates.consultationHours,
      VALIDATION_CONSTRAINTS.CONSULTATION_HOURS_MAX_LENGTH
    );
  }
  if (updates.studyYear !== undefined) {
    profilePatch.studyYear = sanitizeText(
      updates.studyYear,
      VALIDATION_CONSTRAINTS.STUDY_YEAR_MAX_LENGTH
    );
  }
  if (updates.studyTrack !== undefined) {
    profilePatch.studyTrack = sanitizeText(
      updates.studyTrack,
      VALIDATION_CONSTRAINTS.STUDY_TRACK_MAX_LENGTH
    );
  }

  try {
    await updateDoc(doc(db, 'userProfiles', uid), profilePatch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `userProfiles/${uid}`);
  }

  // Sync studentDirectory
  if (prevIndex && prevIndex !== studentIndex) {
    try {
      const oldSnap = await getDoc(doc(db, 'studentDirectory', prevIndex));
      if (oldSnap.exists() && oldSnap.data().uid === uid) {
        await deleteDoc(doc(db, 'studentDirectory', prevIndex));
      }
    } catch {
      // Ignore cleanup if not owner
    }
  }

  if (studentIndex) {
    const dirDepartmentLabel =
      sanitizeText(
        formatStudentRosterProgramLabel(department, updates.studyTrack),
        VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH
      ) || department;

    const dirRef = doc(db, 'studentDirectory', studentIndex);
    try {
      const snap = await getDoc(dirRef);
      if (!snap.exists()) {
        await setDoc(dirRef, {
          studentIndex,
          uid,
          fullName,
          department: dirDepartmentLabel,
          isSeed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (snap.data().uid === uid) {
        await updateDoc(dirRef, {
          fullName,
          department: dirDepartmentLabel,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `studentDirectory/${studentIndex}`);
    }
  }
}

export async function createProfessorInvitation(params: {
  adminUid: string;
  targetEmail: string;
}): Promise<string> {
  const cleanEmail = sanitizeText(
    params.targetEmail.toLowerCase(),
    VALIDATION_CONSTRAINTS.EMAIL_MAX_LENGTH
  );
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Unesite ispravnu e-mail adresu profesora.');
  }

  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  const code = `INV-ETF-${randomPart}`;

  try {
    await setDoc(doc(db, 'invitations', code), {
      code,
      targetEmail: cleanEmail,
      role: 'professor',
      status: InvitationStatus.PENDING,
      createdBy: params.adminUid,
      acceptedBy: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return code;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `invitations/${code}`);
  }
}

export async function redeemProfessorInvitation(params: {
  uid: string;
  userEmail: string;
  inviteCode: string;
}): Promise<void> {
  const code = sanitizeText(params.inviteCode, VALIDATION_CONSTRAINTS.INVITE_CODE_MAX_LENGTH);
  if (!isValidResourceId(code, VALIDATION_CONSTRAINTS.INVITE_CODE_MAX_LENGTH)) {
    throw new Error('Kod pozivnice nije u ispravnom formatu.');
  }

  let inviteSnap;
  try {
    inviteSnap = await getDoc(doc(db, 'invitations', code));
  } catch {
    throw new Error(
      'Pozivnica nije pronađena ili ne pripada vašoj prijavljenoj e-mail adresi.'
    );
  }

  if (!inviteSnap.exists()) {
    throw new Error('Pozivnica sa unesenim kodom ne postoji.');
  }

  const invite = inviteSnap.data() as Invitation;
  if (invite.status !== InvitationStatus.PENDING) {
    throw new Error('Ova pozivnica je već iskorištena ili opozvana.');
  }
  if (invite.targetEmail.toLowerCase() !== params.userEmail.toLowerCase()) {
    throw new Error('Ova pozivnica je izdata za drugu e-mail adresu.');
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'invitations', code), {
    status: InvitationStatus.ACCEPTED,
    acceptedBy: params.uid,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'userProfiles', params.uid), {
    role: UserRole.PROFESSOR,
    redeemedInviteId: code,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `invitations/${code}`);
  }
}

// ============================================================================
// Student Real-time Subscriptions & Fetches
// ============================================================================

export function subscribeStudentEnrollments(
  studentId: string,
  onData: (enrollments: Enrollment[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const q = query(collection(db, 'enrollments'), where('studentId', '==', studentId));
  return onSnapshot(
    q,
    (snap) => {
      const list: Enrollment[] = snap.docs.map((d) => ({
        ...(d.data() as Omit<Enrollment, 'id'>),
        id: d.id,
      }));
      onData(list);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, 'enrollments');
    }
  );
}

export function subscribeStudentScores(
  studentId: string,
  onData: (scores: Score[]) => void
): Unsubscribe {
  const q = query(collection(db, 'scores'), where('studentId', '==', studentId));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<Score, 'id'>), id: d.id })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'scores')
  );
}

export function subscribeStudentAttendanceRecords(
  studentId: string,
  onData: (records: AttendanceRecord[]) => void
): Unsubscribe {
  const q = query(collection(db, 'attendanceRecords'), where('studentId', '==', studentId));
  return onSnapshot(
    q,
    (snap) => {
      onData(
        snap.docs.map((d) => ({ ...(d.data() as Omit<AttendanceRecord, 'id'>), id: d.id }))
      );
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'attendanceRecords')
  );
}

export function subscribeStudentFinalGrades(
  studentId: string,
  onData: (grades: FinalGrade[]) => void
): Unsubscribe {
  const q = query(collection(db, 'finalGrades'), where('studentId', '==', studentId));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<FinalGrade, 'id'>), id: d.id })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'finalGrades')
  );
}

export function subscribeStudentExamRegistrations(
  studentId: string,
  onData: (registrations: ExamRegistration[]) => void
): Unsubscribe {
  const q = query(collection(db, 'examRegistrations'), where('studentId', '==', studentId));
  return onSnapshot(
    q,
    (snap) => {
      onData(
        snap.docs.map((d) => ({ ...(d.data() as Omit<ExamRegistration, 'id'>), id: d.id }))
      );
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'examRegistrations')
  );
}

export function subscribeStudentActivityAwards(
  studentId: string,
  onData: (awards: ActivityAward[]) => void
): Unsubscribe {
  const q = query(collection(db, 'activityAwards'), where('studentId', '==', studentId));
  return onSnapshot(
    q,
    (snap) => {
      onData(
        snap.docs.map((d) => ({ ...(d.data() as Omit<ActivityAward, 'id'>), id: d.id }))
      );
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'activityAwards')
  );
}

export interface StudentCourseBundle {
  course: Course | null;
  categories: GradingCategory[];
  items: GradingItem[];
  sessions: AttendanceSession[];
  examTerms: ExamTerm[];
  scheduleEvents: ScheduleEvent[];
}

export async function fetchCourseBundleByIds(courseId: string): Promise<StudentCourseBundle> {
  let courseSnap;
  try {
    courseSnap = await getDoc(doc(db, 'courses', courseId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `courses/${courseId}`);
  }

  if (!courseSnap.exists()) {
    return {
      course: null,
      categories: [],
      items: [],
      sessions: [],
      examTerms: [],
      scheduleEvents: [],
    };
  }

  const rawCourse = courseSnap.data() as Omit<Course, 'id'>;
  const course: Course = {
    ...rawCourse,
    id: courseSnap.id,
    studyProgram: rawCourse.studyProgram ? normalizeStudyTrack(rawCourse.studyProgram) : undefined,
  };

  const examTermIds = course.examTermIds ?? [];
  const scheduleEventIds = course.scheduleEventIds ?? [];

  const [catSnaps, itemSnaps, sessionSnaps, termSnaps, schedSnaps] = await Promise.all([
    Promise.all(
      course.categoryIds.map(async (catId) => {
        try {
          return await getDoc(doc(db, 'gradingCategories', catId));
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `gradingCategories/${catId}`);
        }
      })
    ),
    Promise.all(
      course.itemIds.map(async (itemId) => {
        try {
          return await getDoc(doc(db, 'gradingItems', itemId));
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `gradingItems/${itemId}`);
        }
      })
    ),
    Promise.all(
      course.sessionIds.map(async (sesId) => {
        try {
          return await getDoc(doc(db, 'attendanceSessions', sesId));
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `attendanceSessions/${sesId}`);
        }
      })
    ),
    Promise.all(
      examTermIds.map(async (termId) => {
        try {
          return await getDoc(doc(db, 'examTerms', termId));
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `examTerms/${termId}`);
        }
      })
    ),
    Promise.all(
      scheduleEventIds.map(async (evId) => {
        try {
          return await getDoc(doc(db, 'scheduleEvents', evId));
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `scheduleEvents/${evId}`);
        }
      })
    ),
  ]);

  const categories: GradingCategory[] = catSnaps
    .filter((s) => s.exists())
    .map((s) => ({ ...(s.data() as Omit<GradingCategory, 'id'>), id: s.id }));

  const items: GradingItem[] = itemSnaps
    .filter((s) => s.exists())
    .map((s) => ({ ...(s.data() as Omit<GradingItem, 'id'>), id: s.id }));

  const sessions: AttendanceSession[] = sessionSnaps
    .filter((s) => s.exists())
    .map((s) => ({ ...(s.data() as Omit<AttendanceSession, 'id'>), id: s.id }));

  const examTerms: ExamTerm[] = termSnaps
    .filter((s) => s.exists())
    .map((s) => ({ ...(s.data() as Omit<ExamTerm, 'id'>), id: s.id }));

  const scheduleEvents: ScheduleEvent[] = schedSnaps
    .filter((s) => s.exists())
    .map((s) => ({ ...(s.data() as Omit<ScheduleEvent, 'id'>), id: s.id }));

  return { course, categories, items, sessions, examTerms, scheduleEvents };
}

/**
 * Subscribes live to an enrolled course document, its published exam terms,
 * and its schedule events so students immediately see newly published exam dates,
 * deadline updates, or schedule changes without refreshing.
 */
export function subscribeStudentEnrolledCourseLive(
  courseId: string,
  onBundle: (bundle: StudentCourseBundle) => void
): Unsubscribe {
  let childUnsubs: Unsubscribe[] = [];
  let active = true;

  const cleanupChildren = () => {
    for (const u of childUnsubs) u();
    childUnsubs = [];
  };

  const unsubCourse = onSnapshot(
    doc(db, 'courses', courseId),
    async (courseSnap) => {
      cleanupChildren();
      if (!active) return;

      if (!courseSnap.exists()) {
        onBundle({
          course: null,
          categories: [],
          items: [],
          sessions: [],
          examTerms: [],
          scheduleEvents: [],
        });
        return;
      }

      const rawCourse = courseSnap.data() as Omit<Course, 'id'>;
      const course: Course = {
        ...rawCourse,
        id: courseSnap.id,
        studyProgram: rawCourse.studyProgram
          ? normalizeStudyTrack(rawCourse.studyProgram)
          : undefined,
      };

      const [catSnaps, itemSnaps, sessionSnaps] = await Promise.all([
        Promise.all(
          course.categoryIds.map(async (catId) => {
            try {
              return await getDoc(doc(db, 'gradingCategories', catId));
            } catch (error) {
              handleFirestoreError(error, OperationType.GET, `gradingCategories/${catId}`);
            }
          })
        ),
        Promise.all(
          course.itemIds.map(async (itemId) => {
            try {
              return await getDoc(doc(db, 'gradingItems', itemId));
            } catch (error) {
              handleFirestoreError(error, OperationType.GET, `gradingItems/${itemId}`);
            }
          })
        ),
        Promise.all(
          course.sessionIds.map(async (sesId) => {
            try {
              return await getDoc(doc(db, 'attendanceSessions', sesId));
            } catch (error) {
              handleFirestoreError(error, OperationType.GET, `attendanceSessions/${sesId}`);
            }
          })
        ),
      ]);

      if (!active) return;

      const categories: GradingCategory[] = catSnaps
        .filter((s) => s.exists())
        .map((s) => ({ ...(s.data() as Omit<GradingCategory, 'id'>), id: s.id }));
      const items: GradingItem[] = itemSnaps
        .filter((s) => s.exists())
        .map((s) => ({ ...(s.data() as Omit<GradingItem, 'id'>), id: s.id }));
      const sessions: AttendanceSession[] = sessionSnaps
        .filter((s) => s.exists())
        .map((s) => ({ ...(s.data() as Omit<AttendanceSession, 'id'>), id: s.id }));

      const termIds = course.examTermIds ?? [];
      const schedIds = course.scheduleEventIds ?? [];

      if (termIds.length === 0 && schedIds.length === 0) {
        onBundle({
          course,
          categories,
          items,
          sessions,
          examTerms: [],
          scheduleEvents: [],
        });
        return;
      }

      const liveTermsMap = new Map<string, ExamTerm>();
      const liveSchedMap = new Map<string, ScheduleEvent>();

      const emit = () => {
        if (!active) return;
        const orderedTerms = termIds
          .map((id) => liveTermsMap.get(id))
          .filter((t): t is ExamTerm => Boolean(t));
        const orderedSched = schedIds
          .map((id) => liveSchedMap.get(id))
          .filter((ev): ev is ScheduleEvent => Boolean(ev));
        onBundle({
          course,
          categories,
          items,
          sessions,
          examTerms: orderedTerms,
          scheduleEvents: orderedSched,
        });
      };

      const tUnsubs = termIds.map((termId) =>
        onSnapshot(
          doc(db, 'examTerms', termId),
          (tSnap) => {
            if (tSnap.exists()) {
              liveTermsMap.set(termId, {
                ...(tSnap.data() as Omit<ExamTerm, 'id'>),
                id: tSnap.id,
              });
            } else {
              liveTermsMap.delete(termId);
            }
            emit();
          },
          (err) => handleFirestoreError(err, OperationType.GET, `examTerms/${termId}`)
        )
      );

      const sUnsubs = schedIds.map((evId) =>
        onSnapshot(
          doc(db, 'scheduleEvents', evId),
          (sSnap) => {
            if (sSnap.exists()) {
              liveSchedMap.set(evId, {
                ...(sSnap.data() as Omit<ScheduleEvent, 'id'>),
                id: sSnap.id,
              });
            } else {
              liveSchedMap.delete(evId);
            }
            emit();
          },
          (err) => handleFirestoreError(err, OperationType.GET, `scheduleEvents/${evId}`)
        )
      );

      childUnsubs = [...tUnsubs, ...sUnsubs];
    },
    (err) => handleFirestoreError(err, OperationType.GET, `courses/${courseId}`)
  );

  return () => {
    active = false;
    cleanupChildren();
    unsubCourse();
  };
}

// ============================================================================
// Professor Subscriptions & Mutations
// ============================================================================

export function buildCourseChildProfessorIds(course: Course, actorUid?: string): string[] {
  const raw = [
    course.leadProfessorId,
    ...(course.professorIds ?? []),
    ...(actorUid ? [actorUid] : []),
    ...(auth.currentUser?.uid ? [auth.currentUser.uid] : []),
  ].filter((id): id is string => Boolean(id && id.trim()));
  return Array.from(new Set(raw)).slice(0, VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE);
}

export async function ensureCourseChildrenSyncedForProfessor(
  course: Course,
  professorUid: string
): Promise<void> {
  if (!professorUid) return;
  const isHolderOrMember =
    course.leadProfessorId === professorUid || (course.professorIds ?? []).includes(professorUid);
  if (!isHolderOrMember) return;

  const targetProfIds = buildCourseChildProfessorIds(course, professorUid);

  if (!(course.professorIds ?? []).includes(professorUid) && course.leadProfessorId === professorUid) {
    try {
      await updateDoc(doc(db, 'courses', course.id), {
        professorIds: targetProfIds,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-blocking sync
    }
  }

  const childTargets: Array<{ col: string; ids: string[] }> = [
    { col: 'gradingCategories', ids: course.categoryIds ?? [] },
    { col: 'gradingItems', ids: course.itemIds ?? [] },
    { col: 'attendanceSessions', ids: course.sessionIds ?? [] },
    { col: 'examTerms', ids: course.examTermIds ?? [] },
    { col: 'scheduleEvents', ids: course.scheduleEventIds ?? [] },
  ];

  for (const group of childTargets) {
    await runParallelChunks(group.ids, 10, async (id) => {
      try {
        const ref = doc(db, group.col, id);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const currentIds = (snap.data().professorIds as string[] | undefined) ?? [];
        if (!currentIds.includes(professorUid)) {
          const merged = Array.from(new Set([...targetProfIds, ...currentIds])).slice(
            0,
            VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
          );
          await updateDoc(ref, {
            professorIds: merged,
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Non-blocking repair for legacy/unsynced child documents
      }
    });
  }
}

export function subscribeProfessorCourses(
  professorUid: string,
  onData: (courses: Course[]) => void
): Unsubscribe {
  let byMember: Course[] = [];
  let byLead: Course[] = [];
  let loadedMember = false;
  let loadedLead = false;

  const emitMerged = () => {
    if (!loadedMember && !loadedLead) return;
    const map = new Map<string, Course>();
    for (const c of byMember) map.set(c.id, c);
    for (const c of byLead) map.set(c.id, c);
    onData(Array.from(map.values()));
  };

  const unsubMember = onSnapshot(
    query(collection(db, 'courses'), where('professorIds', 'array-contains', professorUid)),
    (snap) => {
      byMember = snap.docs.map((d) => ({ ...(d.data() as Omit<Course, 'id'>), id: d.id }));
      loadedMember = true;
      emitMerged();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'courses')
  );

  const unsubLead = onSnapshot(
    query(collection(db, 'courses'), where('leadProfessorId', '==', professorUid)),
    (snap) => {
      byLead = snap.docs.map((d) => ({ ...(d.data() as Omit<Course, 'id'>), id: d.id }));
      loadedLead = true;
      emitMerged();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'courses')
  );

  return () => {
    unsubMember();
    unsubLead();
  };
}

export function subscribeProfessorAllExamData(
  professorUid: string,
  callbacks: {
    onExamTerms: (rows: ExamTerm[]) => void;
    onExamRegistrations: (rows: ExamRegistration[]) => void;
  }
): Unsubscribe {
  const unsubTerms = onSnapshot(
    query(collection(db, 'examTerms'), where('professorIds', 'array-contains', professorUid)),
    (snap) =>
      callbacks.onExamTerms(
        snap.docs.map((d) => ({ ...(d.data() as Omit<ExamTerm, 'id'>), id: d.id }))
      ),
    (err) => handleFirestoreError(err, OperationType.LIST, 'examTerms')
  );

  const unsubRegs = onSnapshot(
    query(
      collection(db, 'examRegistrations'),
      where('professorIds', 'array-contains', professorUid)
    ),
    (snap) =>
      callbacks.onExamRegistrations(
        snap.docs.map((d) => ({ ...(d.data() as Omit<ExamRegistration, 'id'>), id: d.id }))
      ),
    (err) => handleFirestoreError(err, OperationType.LIST, 'examRegistrations')
  );

  return () => {
    unsubTerms();
    unsubRegs();
  };
}

export function subscribeProfessorCourseData(
  professorUid: string,
  courseId: string,
  callbacks: {
    onEnrollments: (rows: Enrollment[]) => void;
    onCategories: (rows: GradingCategory[]) => void;
    onItems: (rows: GradingItem[]) => void;
    onScores: (rows: Score[]) => void;
    onSessions: (rows: AttendanceSession[]) => void;
    onAttendanceRecords: (rows: AttendanceRecord[]) => void;
    onFinalGrades: (rows: FinalGrade[]) => void;
    onActivityAwards?: (rows: ActivityAward[]) => void;
  }
): Unsubscribe {
  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'enrollments'),
        where('professorIds', 'array-contains', professorUid),
        where('courseId', '==', courseId)
      ),
      (snap) =>
        callbacks.onEnrollments(
          snap.docs.map((d) => ({ ...(d.data() as Omit<Enrollment, 'id'>), id: d.id }))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'enrollments')
    )
  );

  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'gradingCategories'),
        where('professorIds', 'array-contains', professorUid),
        where('courseId', '==', courseId)
      ),
      (snap) =>
        callbacks.onCategories(
          snap.docs.map((d) => ({ ...(d.data() as Omit<GradingCategory, 'id'>), id: d.id }))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'gradingCategories')
    )
  );

  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'gradingItems'),
        where('professorIds', 'array-contains', professorUid),
        where('courseId', '==', courseId)
      ),
      (snap) =>
        callbacks.onItems(
          snap.docs.map((d) => ({ ...(d.data() as Omit<GradingItem, 'id'>), id: d.id }))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'gradingItems')
    )
  );

  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'scores'),
        where('professorIds', 'array-contains', professorUid),
        where('courseId', '==', courseId)
      ),
      (snap) =>
        callbacks.onScores(
          snap.docs.map((d) => ({ ...(d.data() as Omit<Score, 'id'>), id: d.id }))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'scores')
    )
  );

  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'attendanceSessions'),
        where('professorIds', 'array-contains', professorUid),
        where('courseId', '==', courseId)
      ),
      (snap) =>
        callbacks.onSessions(
          snap.docs.map((d) => ({ ...(d.data() as Omit<AttendanceSession, 'id'>), id: d.id }))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'attendanceSessions')
    )
  );

  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'attendanceRecords'),
        where('professorIds', 'array-contains', professorUid),
        where('courseId', '==', courseId)
      ),
      (snap) =>
        callbacks.onAttendanceRecords(
          snap.docs.map((d) => ({ ...(d.data() as Omit<AttendanceRecord, 'id'>), id: d.id }))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'attendanceRecords')
    )
  );

  unsubs.push(
    onSnapshot(
      query(
        collection(db, 'finalGrades'),
        where('professorIds', 'array-contains', professorUid),
        where('courseId', '==', courseId)
      ),
      (snap) =>
        callbacks.onFinalGrades(
          snap.docs.map((d) => ({ ...(d.data() as Omit<FinalGrade, 'id'>), id: d.id }))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'finalGrades')
    )
  );

  if (callbacks.onActivityAwards) {
    const onAwards = callbacks.onActivityAwards;
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'activityAwards'),
          where('professorIds', 'array-contains', professorUid),
          where('courseId', '==', courseId)
        ),
        (snap) =>
          onAwards(
            snap.docs.map((d) => ({ ...(d.data() as Omit<ActivityAward, 'id'>), id: d.id }))
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'activityAwards')
      )
    );
  }

  return () => {
    for (const u of unsubs) u();
  };
}

export async function createCourse(params: {
  professorUid: string;
  professorName: string;
  professorNames?: string[];
  assistantNames?: string[];
  studyProgram?: string;
  code: string;
  name: string;
  semester: string;
  academicYear: string;
  ects: number;
  attendanceEnabled: boolean;
  attendanceMaxPoints: number;
  activityMarksEnabled?: boolean;
}): Promise<string> {
  const code = sanitizeText(
    params.code.toUpperCase().replace(/\s+/g, '-'),
    VALIDATION_CONSTRAINTS.COURSE_CODE_MAX_LENGTH
  );
  if (!VALIDATION_CONSTRAINTS.COURSE_CODE_PATTERN.test(code)) {
    throw new Error('Šifra predmeta smije sadržavati samo slova, brojeve i crtice (npr. OR-AR).');
  }
  const name = sanitizeText(params.name, VALIDATION_CONSTRAINTS.COURSE_NAME_MAX_LENGTH);
  if (!name) throw new Error('Naziv predmeta je obavezan.');

  const cleanLeadProf =
    sanitizeText(params.professorName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH) || 'Profesor';

  const cleanProfessorNames = sanitizeStaffList(
    params.professorNames && params.professorNames.length > 0
      ? [cleanLeadProf, ...params.professorNames]
      : [cleanLeadProf],
    VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
  );

  const cleanAssistantNames = sanitizeStaffList(
    params.assistantNames ?? [],
    VALIDATION_CONSTRAINTS.MAX_ASSISTANTS_PER_COURSE
  );

  const cleanStudyProgram = sanitizeText(
    params.studyProgram || 'Bachelor · Računarstvo i informatika',
    VALIDATION_CONSTRAINTS.STUDY_PROGRAM_MAX_LENGTH
  );

  const courseId = makeEntityId('crs');

  // Create default ETF grading categories alongside the course
  const defaultCats = [
    { id: makeEntityId('cat'), name: 'Zadaci', maxPoints: 10, order: 1 },
    { id: makeEntityId('cat'), name: 'Vježbe', maxPoints: 10, order: 2 },
    { id: makeEntityId('cat'), name: 'I parcijalni ispit', maxPoints: 20, order: 3 },
    { id: makeEntityId('cat'), name: 'II parcijalni ispit', maxPoints: 20, order: 4 },
    { id: makeEntityId('cat'), name: 'Završni ispit', maxPoints: 30, order: 5 },
  ];

  try {
    await setDoc(doc(db, 'courses', courseId), {
      code,
      name,
      semester: sanitizeText(
        params.semester || 'Zimski semestar',
        VALIDATION_CONSTRAINTS.SEMESTER_MAX_LENGTH
      ),
      academicYear: sanitizeText(
        params.academicYear || '2026/2027',
        VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH
      ),
      ects: Math.max(1, Math.min(30, Math.round(params.ects || 6))),
      leadProfessorId: params.professorUid,
      leadProfessorName: cleanProfessorNames[0] || cleanLeadProf,
      professorIds: [params.professorUid],
      professorNames: cleanProfessorNames,
      assistantNames: cleanAssistantNames,
      studyProgram: cleanStudyProgram,
      categoryIds: defaultCats.map((c) => c.id),
      itemIds: [],
      sessionIds: [],
      examTermIds: [],
      attendanceEnabled: params.attendanceEnabled,
      attendanceMaxPoints: params.attendanceEnabled
        ? Math.max(0, Math.min(100, Number(params.attendanceMaxPoints ?? 10)))
        : 0,
      allowBonusPoints: false,
      activityMarksEnabled: Boolean(params.activityMarksEnabled),
      grade6Threshold: 55,
      grade7Threshold: 65,
      grade8Threshold: 75,
      grade9Threshold: 85,
      grade10Threshold: 95,
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `courses/${courseId}`);
  }

  await Promise.all(
    defaultCats.map(async (cat) => {
      try {
        await setDoc(doc(db, 'gradingCategories', cat.id), {
          courseId,
          name: cat.name,
          maxPoints: cat.maxPoints,
          order: cat.order,
          professorIds: [params.professorUid],
          isSeed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `gradingCategories/${cat.id}`);
      }
    })
  );

  void mutateAdminIndex({ addCourseIds: [courseId] });
  return courseId;
}

export async function updateCourseSettings(
  courseId: string,
  updates: {
    name: string;
    semester: string;
    academicYear: string;
    ects: number;
    leadProfessorName: string;
    professorNames?: string[];
    assistantNames?: string[];
    studyProgram?: string;
    attendanceEnabled: boolean;
    attendanceMaxPoints: number;
    allowBonusPoints: boolean;
    activityMarksEnabled?: boolean;
    grade6Threshold: number;
    grade7Threshold: number;
    grade8Threshold: number;
    grade9Threshold: number;
    grade10Threshold: number;
  }
): Promise<void> {
  const thresholdValidation = validateGradeThresholds(updates);
  if (!thresholdValidation.valid) {
    throw new Error(thresholdValidation.error);
  }
  if (updates.attendanceMaxPoints < 0 || updates.attendanceMaxPoints > 100) {
    throw new Error('Maksimalni bodovi za prisustvo moraju biti između 0 i 100.');
  }

  const cleanLead = sanitizeText(
    updates.leadProfessorName,
    VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH
  );
  if (!cleanLead) {
    throw new Error('Ime odgovornog nastavnika je obavezno.');
  }

  const patch: Record<string, unknown> = {
    name: sanitizeText(updates.name, VALIDATION_CONSTRAINTS.COURSE_NAME_MAX_LENGTH),
    semester: sanitizeText(updates.semester, VALIDATION_CONSTRAINTS.SEMESTER_MAX_LENGTH),
    academicYear: sanitizeText(
      updates.academicYear,
      VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH
    ),
    ects: Math.max(1, Math.min(30, Number(updates.ects))),
    leadProfessorName: cleanLead,
    attendanceEnabled: updates.attendanceEnabled,
    attendanceMaxPoints: Number(updates.attendanceMaxPoints),
    allowBonusPoints: updates.allowBonusPoints,
    grade6Threshold: Number(updates.grade6Threshold),
    grade7Threshold: Number(updates.grade7Threshold),
    grade8Threshold: Number(updates.grade8Threshold),
    grade9Threshold: Number(updates.grade9Threshold),
    grade10Threshold: Number(updates.grade10Threshold),
    updatedAt: serverTimestamp(),
  };

  if (updates.professorNames) {
    const cleanedProfs = sanitizeStaffList(
      [cleanLead, ...updates.professorNames.slice(1)],
      VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
    );
    patch.professorNames = cleanedProfs.length > 0 ? cleanedProfs : [cleanLead];
  }
  if (updates.assistantNames !== undefined) {
    patch.assistantNames = sanitizeStaffList(
      updates.assistantNames,
      VALIDATION_CONSTRAINTS.MAX_ASSISTANTS_PER_COURSE
    );
  }
  if (updates.studyProgram !== undefined) {
    patch.studyProgram = sanitizeText(
      updates.studyProgram,
      VALIDATION_CONSTRAINTS.STUDY_PROGRAM_MAX_LENGTH
    );
  }
  if (updates.activityMarksEnabled !== undefined) {
    patch.activityMarksEnabled = Boolean(updates.activityMarksEnabled);
  }

  try {
    await updateDoc(doc(db, 'courses', courseId), patch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${courseId}`);
  }
}

export function formatProfessorDisplayName(
  prof: Pick<UserProfile, 'fullName' | 'academicTitle'>
): string {
  const titlePrefix = prof.academicTitle?.trim() || '';
  const raw =
    titlePrefix && !prof.fullName.toLowerCase().startsWith(titlePrefix.toLowerCase())
      ? `${titlePrefix} ${prof.fullName}`
      : prof.fullName;
  return sanitizeText(raw, VALIDATION_CONSTRAINTS.STAFF_NAME_MAX_LENGTH) || 'Nastavnik';
}

async function syncCourseProfessorIdsForAdmin(params: {
  course: Course;
  nextProfessorIds: string[];
  nextLeadProfessorName?: string;
  courseEnrollments?: Enrollment[];
  courseScheduleEvents?: ScheduleEvent[];
}): Promise<void> {
  const {
    course,
    nextProfessorIds,
    nextLeadProfessorName,
    courseEnrollments = [],
    courseScheduleEvents = [],
  } = params;

  if (isCurrentSessionBootstrapAdmin()) {
    const childCollections = [
      'enrollments',
      'gradingCategories',
      'gradingItems',
      'attendanceSessions',
      'examTerms',
      'scheduleEvents',
      'scores',
      'activityAwards',
      'attendanceRecords',
      'examRegistrations',
      'finalGrades',
    ] as const;

    for (const colName of childCollections) {
      try {
        const snap = await getDocs(
          query(collection(db, colName), where('courseId', '==', course.id))
        );
        await runParallelChunks(snap.docs, 15, async (d) => {
          const patch: Record<string, unknown> = {
            professorIds: nextProfessorIds,
            updatedAt: serverTimestamp(),
          };
          if (colName === 'enrollments' && nextLeadProfessorName) {
            patch.leadProfessorName = nextLeadProfessorName;
          }
          await updateDoc(d.ref, patch);
        });
      } catch {
        // Non-blocking child sync
      }
    }
    return;
  }

  // Delegated Admin path: update by known IDs (respects Pillar 8 list rules via allow get + allow update)
  if (courseEnrollments.length > 0) {
    await runParallelChunks(courseEnrollments, 15, async (enr) => {
      try {
        const patch: Record<string, unknown> = {
          professorIds: nextProfessorIds,
          updatedAt: serverTimestamp(),
        };
        if (nextLeadProfessorName) {
          patch.leadProfessorName = nextLeadProfessorName;
        }
        await updateDoc(doc(db, 'enrollments', enr.id), patch);
      } catch {
        // Non-blocking sync
      }
    });
  }

  const directDocPairs: Array<[string, string[]]> = [
    ['gradingCategories', course.categoryIds ?? []],
    ['gradingItems', course.itemIds ?? []],
    ['attendanceSessions', course.sessionIds ?? []],
    ['examTerms', course.examTermIds ?? []],
    [
      'scheduleEvents',
      Array.from(
        new Set([
          ...(course.scheduleEventIds ?? []),
          ...courseScheduleEvents.filter((ev) => ev.courseId === course.id).map((ev) => ev.id),
        ])
      ),
    ],
  ];

  for (const [colName, ids] of directDocPairs) {
    if (ids.length === 0) continue;
    await runParallelChunks(ids, 15, async (docId) => {
      try {
        const ref = doc(db, colName, docId);
        if ((await getDoc(ref)).exists()) {
          await updateDoc(ref, {
            professorIds: nextProfessorIds,
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Non-blocking sync
      }
    });
  }

  const studentIds = courseEnrollments.map((e) => e.studentId);
  if (studentIds.length > 0) {
    const candidateRefs: Array<[string, string]> = [];
    for (const stuId of studentIds) {
      candidateRefs.push(['finalGrades', `${course.id}_${stuId}`]);
      for (const itemId of course.itemIds ?? []) {
        candidateRefs.push(['scores', `${itemId}_${stuId}`]);
      }
      for (const sessId of course.sessionIds ?? []) {
        candidateRefs.push(['attendanceRecords', `${sessId}_${stuId}`]);
      }
      for (const termId of course.examTermIds ?? []) {
        candidateRefs.push(['examRegistrations', `${termId}_${stuId}`]);
      }
    }

    await runParallelChunks(candidateRefs, 20, async ([colName, docId]) => {
      try {
        const ref = doc(db, colName, docId);
        if ((await getDoc(ref)).exists()) {
          await updateDoc(ref, {
            professorIds: nextProfessorIds,
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Non-blocking sync
      }
    });
  }

  const curUid = auth.currentUser?.uid;
  if (curUid && course.professorIds.includes(curUid)) {
    try {
      const actSnap = await getDocs(
        query(
          collection(db, 'activityAwards'),
          where('professorIds', 'array-contains', curUid),
          where('courseId', '==', course.id)
        )
      );
      await runParallelChunks(actSnap.docs, 15, async (d) => {
        await updateDoc(d.ref, {
          professorIds: nextProfessorIds,
          updatedAt: serverTimestamp(),
        });
      });
    } catch {
      // Non-blocking sync
    }
  }
}

export async function adminAssignProfessorToCourse(params: {
  course: Course;
  professor: UserProfile;
  makeLead?: boolean;
  courseEnrollments?: Enrollment[];
  courseScheduleEvents?: ScheduleEvent[];
}): Promise<void> {
  const {
    course,
    professor,
    makeLead = false,
    courseEnrollments = [],
    courseScheduleEvents = [],
  } = params;

  if (!professor.uid || !isValidResourceId(professor.uid, 128)) {
    throw new Error('Odabrani nalog nastavnika još nema aktivan Firebase ID.');
  }
  if (
    !course.professorIds.includes(professor.uid) &&
    course.professorIds.length >= VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
  ) {
    throw new Error('Dostignut je maksimalan broj profesora na jednom predmetu (10).');
  }

  const formattedName = formatProfessorDisplayName(professor);
  const currentNames =
    course.professorNames && course.professorNames.length > 0
      ? course.professorNames
      : [course.leadProfessorName];

  const nextProfIds = makeLead
    ? [professor.uid, ...course.professorIds.filter((id) => id !== professor.uid)]
    : Array.from(new Set([...course.professorIds, professor.uid]));

  const nextProfNames = sanitizeStaffList(
    makeLead
      ? [
          formattedName,
          ...currentNames.filter(
            (n) =>
              n.toLowerCase() !== formattedName.toLowerCase() &&
              !n.toLowerCase().includes(professor.fullName.toLowerCase())
          ),
        ]
      : [...currentNames, formattedName],
    VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
  );

  const nextLeadId = makeLead ? professor.uid : course.leadProfessorId;
  const nextLeadName =
    sanitizeText(
      makeLead ? formattedName : nextProfNames[0] || course.leadProfessorName,
      VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH
    ) || formattedName;
  const cleanAssistants = sanitizeStaffList(
    course.assistantNames ?? [],
    VALIDATION_CONSTRAINTS.MAX_ASSISTANTS_PER_COURSE
  );

  try {
    await updateDoc(doc(db, 'courses', course.id), {
      leadProfessorId: nextLeadId,
      leadProfessorName: nextLeadName,
      professorIds: nextProfIds.slice(0, VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE),
      professorNames: nextProfNames.length > 0 ? nextProfNames : [nextLeadName],
      assistantNames: cleanAssistants,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  await syncCourseProfessorIdsForAdmin({
    course,
    nextProfessorIds: nextProfIds,
    nextLeadProfessorName: nextLeadName !== course.leadProfessorName ? nextLeadName : undefined,
    courseEnrollments,
    courseScheduleEvents,
  });

  void mutateAdminIndex({});
}

export async function adminUnassignProfessorFromCourse(params: {
  course: Course;
  professor: UserProfile;
  allStaffProfiles?: UserProfile[];
  courseEnrollments?: Enrollment[];
  courseScheduleEvents?: ScheduleEvent[];
}): Promise<void> {
  const {
    course,
    professor,
    allStaffProfiles = [],
    courseEnrollments = [],
    courseScheduleEvents = [],
  } = params;

  const nextProfIds = course.professorIds.filter((id) => id !== professor.uid);
  if (nextProfIds.length === 0) {
    throw new Error(
      'Predmet mora imati najmanje jednog dodijeljenog nastavnika. Prvo dodijelite drugog profesora prije uklanjanja.'
    );
  }

  const formattedTarget = formatProfessorDisplayName(professor).toLowerCase();
  const rawTarget = professor.fullName.trim().toLowerCase();
  const currentNames =
    course.professorNames && course.professorNames.length > 0
      ? course.professorNames
      : [course.leadProfessorName];

  let filteredNames = currentNames.filter((n) => {
    const low = n.trim().toLowerCase();
    return low !== formattedTarget && low !== rawTarget;
  });

  const nextLeadId =
    course.leadProfessorId === professor.uid ? nextProfIds[0] : course.leadProfessorId;
  const fallbackProfile = allStaffProfiles.find((p) => p.uid === nextLeadId);

  if (filteredNames.length === 0) {
    filteredNames = [
      fallbackProfile ? formatProfessorDisplayName(fallbackProfile) : course.leadProfessorName,
    ];
  } else if (course.leadProfessorId === professor.uid && fallbackProfile) {
    const fbName = formatProfessorDisplayName(fallbackProfile);
    filteredNames = sanitizeStaffList(
      [fbName, ...filteredNames.filter((n) => n.toLowerCase() !== fbName.toLowerCase())],
      VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
    );
  }

  const nextLeadName =
    sanitizeText(
      filteredNames[0] || course.leadProfessorName,
      VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH
    ) || 'Nastavnik';
  const cleanAssistants = sanitizeStaffList(
    course.assistantNames ?? [],
    VALIDATION_CONSTRAINTS.MAX_ASSISTANTS_PER_COURSE
  );

  try {
    await updateDoc(doc(db, 'courses', course.id), {
      leadProfessorId: nextLeadId,
      leadProfessorName: nextLeadName,
      professorIds: nextProfIds.slice(0, VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE),
      professorNames: filteredNames,
      assistantNames: cleanAssistants,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  await syncCourseProfessorIdsForAdmin({
    course,
    nextProfessorIds: nextProfIds,
    nextLeadProfessorName: nextLeadName !== course.leadProfessorName ? nextLeadName : undefined,
    courseEnrollments,
    courseScheduleEvents,
  });

  void mutateAdminIndex({});
}

export async function updateCourseTeachingStaff(params: {
  course: Course;
  professorNames: string[];
  assistantNames: string[];
  enrollments?: Enrollment[];
  professorIds?: string[];
  leadProfessorId?: string;
  courseScheduleEvents?: ScheduleEvent[];
}): Promise<void> {
  const {
    course,
    professorNames,
    assistantNames,
    enrollments = [],
    professorIds,
    leadProfessorId,
    courseScheduleEvents = [],
  } = params;

  const cleanedProfessors = sanitizeStaffList(
    professorNames,
    VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
  );
  if (cleanedProfessors.length === 0) {
    throw new Error('Predmet mora imati najmanje jednog dodijeljenog profesora.');
  }

  const cleanedAssistants = sanitizeStaffList(
    assistantNames,
    VALIDATION_CONSTRAINTS.MAX_ASSISTANTS_PER_COURSE
  );

  const nextLeadName = cleanedProfessors[0];
  const nextProfIds =
    professorIds && professorIds.length > 0
      ? Array.from(new Set(professorIds)).slice(0, VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE)
      : course.professorIds;
  const nextLeadId =
    leadProfessorId && nextProfIds.includes(leadProfessorId)
      ? leadProfessorId
      : nextProfIds.includes(course.leadProfessorId)
        ? course.leadProfessorId
        : nextProfIds[0];

  const patch: Record<string, unknown> = {
    leadProfessorName: nextLeadName,
    professorNames: cleanedProfessors,
    assistantNames: cleanedAssistants,
    updatedAt: serverTimestamp(),
  };

  const idsChanged =
    nextProfIds.length !== course.professorIds.length ||
    nextProfIds.some((id, idx) => course.professorIds[idx] !== id) ||
    nextLeadId !== course.leadProfessorId;

  if (professorIds && professorIds.length > 0) {
    patch.professorIds = nextProfIds;
    patch.leadProfessorId = nextLeadId;
  }

  try {
    await updateDoc(doc(db, 'courses', course.id), patch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  if (idsChanged) {
    await syncCourseProfessorIdsForAdmin({
      course,
      nextProfessorIds: nextProfIds,
      nextLeadProfessorName: nextLeadName !== course.leadProfessorName ? nextLeadName : undefined,
      courseEnrollments: enrollments,
      courseScheduleEvents,
    });
  } else if (enrollments.length > 0 && nextLeadName !== course.leadProfessorName) {
    await runParallelChunks(enrollments, 15, async (enr) => {
      try {
        await updateDoc(doc(db, 'enrollments', enr.id), {
          leadProfessorName: nextLeadName,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking denormalized label sync
      }
    });
  }
  void mutateAdminIndex({});
}

async function syncCourseProfessorIdsAcrossChildren(params: {
  courseId: string;
  actorUid: string;
  nextProfessorIds: string[];
  isAdminUser?: boolean;
}): Promise<void> {
  const { courseId, actorUid, nextProfessorIds } = params;
  const standardCollections = [
    'enrollments',
    'gradingCategories',
    'gradingItems',
    'attendanceSessions',
    'examTerms',
    'examRegistrations',
    'scheduleEvents',
    'scores',
    'activityAwards',
    'attendanceRecords',
  ] as const;

  for (const colName of standardCollections) {
    try {
      const q = query(
        collection(db, colName),
        where('professorIds', 'array-contains', actorUid),
        where('courseId', '==', courseId)
      );
      const snap = await getDocs(q);
      await runParallelChunks(snap.docs, 15, async (d) => {
        await updateDoc(d.ref, {
          professorIds: nextProfessorIds,
          updatedAt: serverTimestamp(),
        });
      });
    } catch {
      // Best-effort sync
    }
  }

  try {
    const fgQ = query(
      collection(db, 'finalGrades'),
      where('professorIds', 'array-contains', actorUid),
      where('courseId', '==', courseId)
    );
    const fgSnap = await getDocs(fgQ);
    await runParallelChunks(fgSnap.docs, 15, async (d) => {
      await updateDoc(d.ref, {
        professorIds: nextProfessorIds,
        updatedAt: serverTimestamp(),
      });
    });
  } catch {
    // Best-effort sync
  }
}

export async function linkCourseCoProfessorByUid(params: {
  course: Course;
  coProfessorUid: string;
  actorUid: string;
  isAdminUser?: boolean;
}): Promise<string> {
  const { course, coProfessorUid, actorUid, isAdminUser } = params;
  const cleanUid = sanitizeText(coProfessorUid, VALIDATION_CONSTRAINTS.ID_MAX_LENGTH);
  if (!isValidResourceId(cleanUid)) {
    throw new Error('Unesite ispravan Nastavnički ID ko-profesora.');
  }
  if (course.professorIds.includes(cleanUid)) {
    throw new Error('Ovaj profesor je već povezan sa predmetom.');
  }
  if (course.professorIds.length >= VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE) {
    throw new Error('Dostignut je maksimalan broj profesora na predmetu (10).');
  }

  let targetSnap;
  try {
    targetSnap = await getDoc(doc(db, 'userProfiles', cleanUid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `userProfiles/${cleanUid}`);
  }

  if (!targetSnap.exists()) {
    throw new Error('Korisnički profil sa unesenim Nastavničkim ID-om nije pronađen.');
  }

  const targetData = targetSnap.data() as UserProfile;
  if (targetData.role !== UserRole.PROFESSOR && targetData.role !== UserRole.ADMIN) {
    throw new Error('Uneseni nalog nema ulogu profesora na portalu.');
  }

  const titlePrefix = targetData.academicTitle?.trim() || 'dr.';
  const formattedName = sanitizeText(
    targetData.fullName.toLowerCase().startsWith(titlePrefix.toLowerCase())
      ? targetData.fullName
      : `${titlePrefix} ${targetData.fullName}`,
    VALIDATION_CONSTRAINTS.STAFF_NAME_MAX_LENGTH
  );

  const currentProfNames =
    course.professorNames && course.professorNames.length > 0
      ? course.professorNames
      : [course.leadProfessorName];

  const nextProfNames = sanitizeStaffList(
    [...currentProfNames, formattedName],
    VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
  );
  const nextProfIds = [...course.professorIds, cleanUid];

  try {
    await updateDoc(doc(db, 'courses', course.id), {
      leadProfessorName: nextProfNames[0] || course.leadProfessorName,
      professorIds: nextProfIds,
      professorNames: nextProfNames,
      assistantNames: course.assistantNames ?? [],
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  await syncCourseProfessorIdsAcrossChildren({
    courseId: course.id,
    actorUid,
    nextProfessorIds: nextProfIds,
    isAdminUser,
  });

  return formattedName;
}

export async function unlinkCourseCoProfessorUid(params: {
  course: Course;
  coProfessorUid: string;
  actorUid: string;
  isAdminUser?: boolean;
}): Promise<void> {
  const { course, coProfessorUid, actorUid, isAdminUser } = params;
  if (coProfessorUid === course.leadProfessorId) {
    throw new Error('Odgovorni nastavnik predmeta ne može biti uklonjen.');
  }
  const nextProfIds = course.professorIds.filter((id) => id !== coProfessorUid);
  if (nextProfIds.length === 0) {
    throw new Error('Predmet mora zadržati najmanje jednog profesora.');
  }

  try {
    await updateDoc(doc(db, 'courses', course.id), {
      leadProfessorName: course.leadProfessorName,
      professorIds: nextProfIds,
      professorNames:
        course.professorNames && course.professorNames.length > 0
          ? course.professorNames
          : [course.leadProfessorName],
      assistantNames: course.assistantNames ?? [],
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  await syncCourseProfessorIdsAcrossChildren({
    courseId: course.id,
    actorUid,
    nextProfessorIds: nextProfIds,
    isAdminUser,
  });
}

export async function enrollStudentByIndex(params: {
  course: Course;
  studentIndex: string;
}): Promise<StudentDirectoryEntry> {
  const cleanIdx = sanitizeText(
    params.studentIndex,
    VALIDATION_CONSTRAINTS.STUDENT_INDEX_MAX_LENGTH
  );
  if (!VALIDATION_CONSTRAINTS.STUDENT_INDEX_REQUIRED_PATTERN.test(cleanIdx)) {
    throw new Error('Unesite ispravan broj indeksa (npr. 18942).');
  }

  let dirSnap;
  try {
    dirSnap = await getDoc(doc(db, 'studentDirectory', cleanIdx));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `studentDirectory/${cleanIdx}`);
  }

  if (!dirSnap.exists()) {
    throw new Error(
      `Student sa brojem indeksa "${cleanIdx}" nije pronađen u registru. Student najprije treba unijeti broj indeksa na svom profilu.`
    );
  }

  const entry = dirSnap.data() as StudentDirectoryEntry;
  const enrollmentId = `${params.course.id}_${entry.uid}`;

  const existingEnroll = await getDoc(doc(db, 'enrollments', enrollmentId));
  if (existingEnroll.exists()) {
    throw new Error(`Student ${entry.fullName} (${cleanIdx}) je već upisan na ovaj predmet.`);
  }

  try {
    await setDoc(doc(db, 'enrollments', enrollmentId), {
      courseId: params.course.id,
      courseCode: params.course.code,
      courseName: params.course.name,
      leadProfessorName: params.course.leadProfessorName,
      academicYear: params.course.academicYear,
      studentId: entry.uid,
      studentName: entry.fullName,
      studentIndex: entry.studentIndex,
      studentDepartment: entry.department,
      professorIds: buildCourseChildProfessorIds(params.course),
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return entry;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `enrollments/${enrollmentId}`);
  }
}

export async function removeEnrollment(enrollmentId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'enrollments', enrollmentId));
    void mutateAdminIndex({ removeEnrollmentIds: [enrollmentId] });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `enrollments/${enrollmentId}`);
  }
}

export async function createGradingCategory(params: {
  course: Course;
  name: string;
  maxPoints: number;
  order: number;
}): Promise<string> {
  if (params.course.categoryIds.length >= VALIDATION_CONSTRAINTS.MAX_CATEGORIES_PER_COURSE) {
    throw new Error('Dostignut je maksimalan broj kategorija za ovaj predmet (20).');
  }
  const cleanName = sanitizeText(params.name, VALIDATION_CONSTRAINTS.CATEGORY_NAME_MAX_LENGTH);
  if (!cleanName) throw new Error('Naziv kategorije je obavezan.');
  if (
    params.course.attendanceEnabled &&
    cleanName.toLowerCase() === 'prisustvo'
  ) {
    throw new Error(
      'Prisustvo se već automatski obračunava kroz modul Prisustvo. Nemojte dodavati duplu kategoriju "Prisustvo".'
    );
  }
  if (params.maxPoints < 0 || params.maxPoints > 100) {
    throw new Error('Maksimalni bodovi kategorije moraju biti između 0 i 100.');
  }

  const categoryId = makeEntityId('cat');
  const childProfessorIds = buildCourseChildProfessorIds(params.course);

  try {
    await setDoc(doc(db, 'gradingCategories', categoryId), {
      courseId: params.course.id,
      name: cleanName,
      maxPoints: Number(params.maxPoints),
      order: Math.max(0, Math.min(50, Math.round(params.order))),
      professorIds: childProfessorIds,
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `gradingCategories/${categoryId}`);
  }

  try {
    await updateDoc(doc(db, 'courses', params.course.id), {
      categoryIds: Array.from(new Set([...params.course.categoryIds, categoryId])),
      updatedAt: serverTimestamp(),
    });
    return categoryId;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${params.course.id}`);
  }
}

export async function updateGradingCategory(
  categoryId: string,
  professorIds: string[],
  updates: { name: string; maxPoints: number; order: number }
): Promise<void> {
  const cleanName = sanitizeText(updates.name, VALIDATION_CONSTRAINTS.CATEGORY_NAME_MAX_LENGTH);
  if (!cleanName) throw new Error('Naziv kategorije je obavezan.');

  const safeProfIds = Array.from(
    new Set([...professorIds, ...(auth.currentUser?.uid ? [auth.currentUser.uid] : [])])
  ).slice(0, VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE);

  try {
    await updateDoc(doc(db, 'gradingCategories', categoryId), {
      name: cleanName,
      maxPoints: Math.max(0, Math.min(100, Number(updates.maxPoints))),
      order: Math.max(0, Math.min(50, Math.round(updates.order))),
      professorIds: safeProfIds,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `gradingCategories/${categoryId}`);
  }
}

export async function deleteGradingCategory(params: {
  course: Course;
  categoryId: string;
  itemsInCategory: GradingItem[];
  scoresInCategory: Score[];
}): Promise<void> {
  const { course, categoryId, itemsInCategory, scoresInCategory } = params;
  const removedItemIds = new Set(itemsInCategory.map((i) => i.id));

  await runParallelChunks(scoresInCategory, 20, async (sc) => {
    try {
      await deleteDoc(doc(db, 'scores', sc.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `scores/${sc.id}`);
    }
  });

  await runParallelChunks(itemsInCategory, 20, async (it) => {
    try {
      await deleteDoc(doc(db, 'gradingItems', it.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `gradingItems/${it.id}`);
    }
  });

  const nextCatIds = course.categoryIds.filter((id) => id !== categoryId);
  const nextItemIds = course.itemIds.filter((id) => !removedItemIds.has(id));

  try {
    if (removedItemIds.size > 0) {
      await updateDoc(doc(db, 'courses', course.id), {
        categoryIds: nextCatIds,
        itemIds: nextItemIds,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'courses', course.id), {
        categoryIds: nextCatIds,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  try {
    await deleteDoc(doc(db, 'gradingCategories', categoryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `gradingCategories/${categoryId}`);
  }
}

export async function createGradingItem(params: {
  course: Course;
  categoryId: string;
  name: string;
  maxPoints: number;
  date: string;
  description: string;
  order: number;
}): Promise<string> {
  if (params.course.itemIds.length >= VALIDATION_CONSTRAINTS.MAX_ITEMS_PER_COURSE) {
    throw new Error('Dostignut je maksimalan broj stavki ocjenjivanja za ovaj predmet (60).');
  }
  const cleanName = sanitizeText(params.name, VALIDATION_CONSTRAINTS.ITEM_NAME_MAX_LENGTH);
  if (!cleanName) throw new Error('Naziv stavke je obavezan.');
  if (params.maxPoints <= 0 || params.maxPoints > 100) {
    throw new Error('Maksimalni bodovi stavke moraju biti veći od 0 i najviše 100.');
  }
  if (!isValidIsoDate(params.date)) {
    throw new Error('Unesite ispravan datum u formatu YYYY-MM-DD.');
  }

  const itemId = makeEntityId('itm');
  const childProfessorIds = buildCourseChildProfessorIds(params.course);

  try {
    await setDoc(doc(db, 'gradingItems', itemId), {
      courseId: params.course.id,
      categoryId: params.categoryId,
      name: cleanName,
      maxPoints: Number(params.maxPoints),
      date: params.date,
      description: sanitizeText(params.description, VALIDATION_CONSTRAINTS.DESCRIPTION_MAX_LENGTH),
      order: Math.max(0, Math.min(200, Math.round(params.order))),
      professorIds: childProfessorIds,
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `gradingItems/${itemId}`);
  }

  try {
    await updateDoc(doc(db, 'courses', params.course.id), {
      itemIds: Array.from(new Set([...params.course.itemIds, itemId])),
      updatedAt: serverTimestamp(),
    });
    return itemId;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${params.course.id}`);
  }
}

export async function updateGradingItem(
  itemId: string,
  professorIds: string[],
  updates: {
    categoryId: string;
    name: string;
    maxPoints: number;
    date: string;
    description: string;
    order: number;
  }
): Promise<void> {
  const cleanName = sanitizeText(updates.name, VALIDATION_CONSTRAINTS.ITEM_NAME_MAX_LENGTH);
  if (!cleanName) throw new Error('Naziv stavke je obavezan.');
  if (updates.maxPoints <= 0 || updates.maxPoints > 100) {
    throw new Error('Maksimalni bodovi moraju biti između 0.1 i 100.');
  }
  if (!isValidIsoDate(updates.date)) {
    throw new Error('Unesite ispravan datum.');
  }

  const safeProfIds = Array.from(
    new Set([...professorIds, ...(auth.currentUser?.uid ? [auth.currentUser.uid] : [])])
  ).slice(0, VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE);

  try {
    await updateDoc(doc(db, 'gradingItems', itemId), {
      categoryId: updates.categoryId,
      name: cleanName,
      maxPoints: Number(updates.maxPoints),
      date: updates.date,
      description: sanitizeText(updates.description, VALIDATION_CONSTRAINTS.DESCRIPTION_MAX_LENGTH),
      order: Math.max(0, Math.min(200, Math.round(updates.order))),
      professorIds: safeProfIds,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `gradingItems/${itemId}`);
  }
}

export async function deleteGradingItem(params: {
  course: Course;
  itemId: string;
  itemScores: Score[];
}): Promise<void> {
  const { course, itemId, itemScores } = params;

  await runParallelChunks(itemScores, 20, async (sc) => {
    try {
      await deleteDoc(doc(db, 'scores', sc.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `scores/${sc.id}`);
    }
  });

  try {
    await updateDoc(doc(db, 'courses', course.id), {
      itemIds: course.itemIds.filter((id) => id !== itemId),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  try {
    await deleteDoc(doc(db, 'gradingItems', itemId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `gradingItems/${itemId}`);
  }
}

export async function saveStudentScore(params: {
  course: Course;
  item: GradingItem;
  studentId: string;
  points: number;
  feedback: string;
  professorUid: string;
  existingScore?: Score;
}): Promise<void> {
  const { course, item, studentId, points, feedback, professorUid, existingScore } = params;
  const check = validateScoreInput(points, item.maxPoints, course.allowBonusPoints);
  if (!check.valid) {
    throw new Error(check.error);
  }

  const scoreId = `${item.id}_${studentId}`;
  const cleanFeedback = sanitizeText(feedback, VALIDATION_CONSTRAINTS.FEEDBACK_MAX_LENGTH);
  const childProfessorIds = buildCourseChildProfessorIds(course, professorUid);

  if (existingScore) {
    try {
      await updateDoc(doc(db, 'scores', scoreId), {
        points: Number(points),
        feedback: cleanFeedback,
        gradedBy: professorUid,
        professorIds: childProfessorIds,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `scores/${scoreId}`);
    }
  } else {
    try {
      await setDoc(doc(db, 'scores', scoreId), {
        courseId: course.id,
        categoryId: item.categoryId,
        itemId: item.id,
        studentId,
        points: Number(points),
        feedback: cleanFeedback,
        gradedBy: professorUid,
        professorIds: childProfessorIds,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `scores/${scoreId}`);
    }
  }
}

export async function createAttendanceSessionWithInitialMarks(params: {
  course: Course;
  date: string;
  time: string;
  topic: string;
  markAllPresent: boolean;
  enrolledStudents: Enrollment[];
  professorUid: string;
}): Promise<string> {
  const { course, date, time, topic, markAllPresent, enrolledStudents, professorUid } = params;
  if (course.sessionIds.length >= VALIDATION_CONSTRAINTS.MAX_SESSIONS_PER_COURSE) {
    throw new Error('Dostignut je maksimalan broj termina prisustva za ovaj predmet (60).');
  }
  if (!isValidIsoDate(date)) {
    throw new Error('Unesite ispravan datum termina (YYYY-MM-DD).');
  }

  const sessionId = makeEntityId('ses');
  const childProfessorIds = buildCourseChildProfessorIds(course, professorUid);

  try {
    await setDoc(doc(db, 'attendanceSessions', sessionId), {
      courseId: course.id,
      date,
      time: sanitizeText(time, VALIDATION_CONSTRAINTS.SESSION_TIME_MAX_LENGTH),
      topic: sanitizeText(topic, VALIDATION_CONSTRAINTS.SESSION_TOPIC_MAX_LENGTH),
      isCancelled: false,
      professorIds: childProfessorIds,
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `attendanceSessions/${sessionId}`);
  }

  try {
    await updateDoc(doc(db, 'courses', course.id), {
      sessionIds: Array.from(new Set([...course.sessionIds, sessionId])),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  if (markAllPresent && enrolledStudents.length > 0) {
    await runParallelChunks(enrolledStudents, 15, async (enr) => {
      const recordId = `${sessionId}_${enr.studentId}`;
      try {
        await setDoc(doc(db, 'attendanceRecords', recordId), {
          courseId: course.id,
          sessionId,
          studentId: enr.studentId,
          present: true,
          note: '',
          markedBy: professorUid,
          professorIds: childProfessorIds,
          isSeed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `attendanceRecords/${recordId}`);
      }
    });
  }

  return sessionId;
}

export async function updateAttendanceSession(
  session: AttendanceSession,
  updates: { date: string; time: string; topic: string; isCancelled: boolean }
): Promise<void> {
  if (!isValidIsoDate(updates.date)) {
    throw new Error('Unesite ispravan datum termina.');
  }
  const safeProfIds = Array.from(
    new Set([...session.professorIds, ...(auth.currentUser?.uid ? [auth.currentUser.uid] : [])])
  ).slice(0, VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE);
  try {
    await updateDoc(doc(db, 'attendanceSessions', session.id), {
      date: updates.date,
      time: sanitizeText(updates.time, VALIDATION_CONSTRAINTS.SESSION_TIME_MAX_LENGTH),
      topic: sanitizeText(updates.topic, VALIDATION_CONSTRAINTS.SESSION_TOPIC_MAX_LENGTH),
      isCancelled: updates.isCancelled,
      professorIds: safeProfIds,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `attendanceSessions/${session.id}`);
  }
}

export async function deleteAttendanceSession(params: {
  course: Course;
  sessionId: string;
  sessionRecords: AttendanceRecord[];
}): Promise<void> {
  const { course, sessionId, sessionRecords } = params;

  await runParallelChunks(sessionRecords, 20, async (r) => {
    try {
      await deleteDoc(doc(db, 'attendanceRecords', r.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `attendanceRecords/${r.id}`);
    }
  });

  try {
    await updateDoc(doc(db, 'courses', course.id), {
      sessionIds: course.sessionIds.filter((id) => id !== sessionId),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  try {
    await deleteDoc(doc(db, 'attendanceSessions', sessionId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `attendanceSessions/${sessionId}`);
  }
}

export async function setStudentAttendance(params: {
  course: Course;
  sessionId: string;
  studentId: string;
  present: boolean;
  note?: string;
  professorUid: string;
  existingRecord?: AttendanceRecord;
}): Promise<void> {
  const {
    course,
    sessionId,
    studentId,
    present,
    note = '',
    professorUid,
    existingRecord,
  } = params;
  const recordId = `${sessionId}_${studentId}`;
  const cleanNote = sanitizeText(note, VALIDATION_CONSTRAINTS.ATTENDANCE_NOTE_MAX_LENGTH);
  const childProfessorIds = buildCourseChildProfessorIds(course, professorUid);

  if (existingRecord) {
    try {
      await updateDoc(doc(db, 'attendanceRecords', recordId), {
        present,
        note: cleanNote,
        markedBy: professorUid,
        professorIds: childProfessorIds,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `attendanceRecords/${recordId}`);
    }
  } else {
    try {
      await setDoc(doc(db, 'attendanceRecords', recordId), {
        courseId: course.id,
        sessionId,
        studentId,
        present,
        note: cleanNote,
        markedBy: professorUid,
        professorIds: childProfessorIds,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `attendanceRecords/${recordId}`);
    }
  }
}

export async function markAllStudentsPresentInSession(params: {
  course: Course;
  sessionId: string;
  enrolledStudents: Enrollment[];
  existingRecords: AttendanceRecord[];
  professorUid: string;
}): Promise<void> {
  const { course, sessionId, enrolledStudents, existingRecords, professorUid } = params;
  const existingMap = new Map(existingRecords.map((r) => [r.studentId, r]));
  const childProfessorIds = buildCourseChildProfessorIds(course, professorUid);

  await runParallelChunks(enrolledStudents, 15, async (enr) => {
    const recordId = `${sessionId}_${enr.studentId}`;
    const existing = existingMap.get(enr.studentId);
    if (existing) {
      if (existing.present) return;
      try {
        await updateDoc(doc(db, 'attendanceRecords', recordId), {
          present: true,
          note: existing.note,
          markedBy: professorUid,
          professorIds: childProfessorIds,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `attendanceRecords/${recordId}`);
      }
    } else {
      try {
        await setDoc(doc(db, 'attendanceRecords', recordId), {
          courseId: course.id,
          sessionId,
          studentId: enr.studentId,
          present: true,
          note: '',
          markedBy: professorUid,
          professorIds: childProfessorIds,
          isSeed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `attendanceRecords/${recordId}`);
      }
    }
  });
}

export async function saveFinalGradeRecord(params: {
  course: Course;
  studentId: string;
  totalPoints: number;
  finalGrade: number;
  status: FinalGradeStatus;
  comment: string;
  professorUid: string;
  existingGrade?: FinalGrade;
}): Promise<void> {
  const {
    course,
    studentId,
    totalPoints,
    finalGrade,
    status,
    comment,
    professorUid,
    existingGrade,
  } = params;

  if (finalGrade < 5 || finalGrade > 10) {
    throw new Error('Ocjena mora biti u rasponu od 5 do 10.');
  }
  if (status === FinalGradeStatus.FINALIZED && totalPoints < course.grade6Threshold && finalGrade >= 6) {
    throw new Error(
      `Nije moguće zaključiti prolaznu ocjenu prije ostvarenog praga predmeta (${course.grade6Threshold} bodova).`
    );
  }

  const gradeId = `${course.id}_${studentId}`;
  const cleanComment = sanitizeText(
    comment,
    VALIDATION_CONSTRAINTS.FINAL_GRADE_COMMENT_MAX_LENGTH
  );
  const childProfessorIds = buildCourseChildProfessorIds(course, professorUid);

  if (existingGrade) {
    try {
      await updateDoc(doc(db, 'finalGrades', gradeId), {
        totalPoints: Number(totalPoints.toFixed(2)),
        finalGrade: Math.round(finalGrade),
        status,
        finalizedBy: professorUid,
        comment: cleanComment,
        professorIds: childProfessorIds,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `finalGrades/${gradeId}`);
    }
  } else {
    try {
      await setDoc(doc(db, 'finalGrades', gradeId), {
        courseId: course.id,
        studentId,
        totalPoints: Number(totalPoints.toFixed(2)),
        finalGrade: Math.round(finalGrade),
        status,
        finalizedBy: professorUid,
        comment: cleanComment,
        professorIds: childProfessorIds,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `finalGrades/${gradeId}`);
    }
  }
}

// ============================================================================
// Exam Terms & Student Exam Registrations ("Prijava ispita")
// ============================================================================

export async function createExamTerm(params: {
  course: Course;
  professorUid: string;
  title: string;
  examDate: string;
  examTime: string;
  classroom: string;
  registrationOpenDate: string;
  registrationCloseDate: string;
  notes: string;
}): Promise<string> {
  const {
    course,
    professorUid,
    title,
    examDate,
    examTime,
    classroom,
    registrationOpenDate,
    registrationCloseDate,
    notes,
  } = params;

  const existingIds = course.examTermIds ?? [];
  if (existingIds.length >= VALIDATION_CONSTRAINTS.MAX_EXAM_TERMS_PER_COURSE) {
    throw new Error('Dostignut je maksimalan broj ispitnih rokova za ovaj predmet (40).');
  }

  const cleanTitle = sanitizeText(title, VALIDATION_CONSTRAINTS.EXAM_TITLE_MAX_LENGTH);
  if (!cleanTitle) {
    throw new Error('Unesite naziv ispitnog roka (npr. I parcijalni ispit ili Završni ispit).');
  }

  const dateValidation = validateExamTermDates({
    registrationOpenDate,
    registrationCloseDate,
    examDate,
  });
  if (!dateValidation.valid) {
    throw new Error(dateValidation.error);
  }

  const termId = makeEntityId('ext');
  const childProfessorIds = buildCourseChildProfessorIds(course, professorUid);

  try {
    await setDoc(doc(db, 'examTerms', termId), {
      courseId: course.id,
      courseCode: course.code,
      courseName: course.name,
      title: cleanTitle,
      examDate,
      examTime: sanitizeText(examTime, VALIDATION_CONSTRAINTS.SESSION_TIME_MAX_LENGTH),
      classroom: sanitizeText(classroom, VALIDATION_CONSTRAINTS.CLASSROOM_MAX_LENGTH),
      registrationOpenDate,
      registrationCloseDate,
      notes: sanitizeText(notes, VALIDATION_CONSTRAINTS.EXAM_NOTES_MAX_LENGTH),
      isOpen: true,
      createdBy: professorUid,
      professorIds: childProfessorIds,
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `examTerms/${termId}`);
  }

  try {
    await updateDoc(doc(db, 'courses', course.id), {
      examTermIds: Array.from(new Set([...existingIds, termId])),
      updatedAt: serverTimestamp(),
    });
    return termId;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }
}

export async function updateExamTerm(
  term: ExamTerm,
  course: Course,
  updates: {
    title: string;
    examDate: string;
    examTime: string;
    classroom: string;
    registrationOpenDate: string;
    registrationCloseDate: string;
    notes: string;
    isOpen: boolean;
  }
): Promise<void> {
  const cleanTitle = sanitizeText(updates.title, VALIDATION_CONSTRAINTS.EXAM_TITLE_MAX_LENGTH);
  if (!cleanTitle) {
    throw new Error('Naziv ispitnog roka je obavezan.');
  }

  const dateValidation = validateExamTermDates({
    registrationOpenDate: updates.registrationOpenDate,
    registrationCloseDate: updates.registrationCloseDate,
    examDate: updates.examDate,
  });
  if (!dateValidation.valid) {
    throw new Error(dateValidation.error);
  }

  try {
    await updateDoc(doc(db, 'examTerms', term.id), {
      courseCode: course.code,
      courseName: course.name,
      title: cleanTitle,
      examDate: updates.examDate,
      examTime: sanitizeText(updates.examTime, VALIDATION_CONSTRAINTS.SESSION_TIME_MAX_LENGTH),
      classroom: sanitizeText(updates.classroom, VALIDATION_CONSTRAINTS.CLASSROOM_MAX_LENGTH),
      registrationOpenDate: updates.registrationOpenDate,
      registrationCloseDate: updates.registrationCloseDate,
      notes: sanitizeText(updates.notes, VALIDATION_CONSTRAINTS.EXAM_NOTES_MAX_LENGTH),
      isOpen: updates.isOpen,
      professorIds: buildCourseChildProfessorIds(course),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `examTerms/${term.id}`);
  }
}

export async function toggleExamTermOpen(termId: string, isOpen: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'examTerms', termId), {
      isOpen,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `examTerms/${termId}`);
  }
}

export async function deleteExamTerm(params: {
  course: Course;
  termId: string;
  termRegistrations: ExamRegistration[];
}): Promise<void> {
  const { course, termId, termRegistrations } = params;

  await runParallelChunks(termRegistrations, 15, async (reg) => {
    try {
      await deleteDoc(doc(db, 'examRegistrations', reg.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `examRegistrations/${reg.id}`);
    }
  });

  try {
    await updateDoc(doc(db, 'courses', course.id), {
      examTermIds: (course.examTermIds ?? []).filter((id) => id !== termId),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  try {
    await deleteDoc(doc(db, 'examTerms', termId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `examTerms/${termId}`);
  }
}

export async function setStudentExamRegistration(params: {
  term: ExamTerm;
  studentProfile: UserProfile;
  status: ExamRegistrationStatus;
  existingRegistration?: ExamRegistration;
}): Promise<void> {
  const { term, studentProfile, status, existingRegistration } = params;

  const windowEval = getExamWindowState(term);
  if (!windowEval.canRegisterOrCancel) {
    throw new Error(
      `Promjena prijave nije dostupna (${windowEval.label.toLowerCase()}).`
    );
  }

  const registrationId = `${term.id}_${studentProfile.uid}`;
  const cleanName =
    sanitizeText(studentProfile.fullName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH) ||
    'Student';
  const cleanIndex = sanitizeText(
    studentProfile.studentIndex,
    VALIDATION_CONSTRAINTS.STUDENT_INDEX_MAX_LENGTH
  );
  const cleanDept =
    sanitizeText(studentProfile.department, VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH) ||
    'Računarstvo i informatika';

  if (existingRegistration) {
    try {
      await updateDoc(doc(db, 'examRegistrations', registrationId), {
        status,
        studentName: cleanName,
        studentIndex: cleanIndex,
        studentDepartment: cleanDept,
        updatedAt: serverTimestamp(),
      });
      recordStudentSelfExamAction(studentProfile.uid, registrationId, status);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `examRegistrations/${registrationId}`);
    }
  } else {
    try {
      await setDoc(doc(db, 'examRegistrations', registrationId), {
        termId: term.id,
        courseId: term.courseId,
        courseCode: term.courseCode,
        courseName: term.courseName,
        termTitle: term.title,
        examDate: term.examDate,
        studentId: studentProfile.uid,
        studentName: cleanName,
        studentIndex: cleanIndex,
        studentDepartment: cleanDept,
        status,
        professorIds: term.professorIds,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      recordStudentSelfExamAction(studentProfile.uid, registrationId, status);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `examRegistrations/${registrationId}`);
    }
  }
}

export async function setExamRegistrationByProfessor(params: {
  term: ExamTerm;
  course: Course;
  enrollment: Enrollment;
  status: ExamRegistrationStatus;
  existingRegistration?: ExamRegistration;
}): Promise<void> {
  const { term, course, enrollment, status, existingRegistration } = params;
  const registrationId = `${term.id}_${enrollment.studentId}`;

  if (existingRegistration) {
    try {
      await updateDoc(doc(db, 'examRegistrations', registrationId), {
        courseCode: course.code,
        courseName: course.name,
        termTitle: term.title,
        examDate: term.examDate,
        studentName: enrollment.studentName,
        studentIndex: enrollment.studentIndex,
        studentDepartment: enrollment.studentDepartment,
        status,
        professorIds: course.professorIds,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `examRegistrations/${registrationId}`);
    }
  } else {
    try {
      await setDoc(doc(db, 'examRegistrations', registrationId), {
        termId: term.id,
        courseId: course.id,
        courseCode: course.code,
        courseName: course.name,
        termTitle: term.title,
        examDate: term.examDate,
        studentId: enrollment.studentId,
        studentName: enrollment.studentName,
        studentIndex: enrollment.studentIndex,
        studentDepartment: enrollment.studentDepartment,
        status,
        professorIds: course.professorIds,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `examRegistrations/${registrationId}`);
    }
  }
}

// ============================================================================
// Development Seed Data (isSeed: true — separated from production records)
// ============================================================================

async function seedDemoExamDataIfMissing(params: {
  adminUid: string;
}): Promise<void> {
  const { adminUid } = params;

  const [arSnap, osSnap, existingTermSnap] = await Promise.all([
    getDoc(doc(db, 'courses', 'seed_crs_ar')),
    getDoc(doc(db, 'courses', 'seed_crs_os')),
    getDoc(doc(db, 'examTerms', 'seed_ext_ar_p2')),
  ]);

  if (!arSnap.exists() || !osSnap.exists() || existingTermSnap.exists()) {
    return;
  }

  const today = getTodayIsoLocal();
  const arCourse = arSnap.data() as Course;
  const osCourse = osSnap.data() as Course;

  const demoTerms = [
    {
      id: 'seed_ext_ar_p2',
      courseId: 'seed_crs_ar',
      courseCode: 'OR-AR',
      courseName: 'Arhitektura računara',
      title: 'II parcijalni ispit',
      registrationOpenDate: addDaysIso(today, -3),
      registrationCloseDate: addDaysIso(today, 6),
      examDate: addDaysIso(today, 10),
      examTime: '10:00',
      classroom: 'Amfiteatar A1',
      notes: 'Obavezno ponijeti indeks. Dozvoljen obični naučni kalkulator.',
      isOpen: true,
    },
    {
      id: 'seed_ext_ar_zav',
      courseId: 'seed_crs_ar',
      courseCode: 'OR-AR',
      courseName: 'Arhitektura računara',
      title: 'Završni ispit — I ispitni rok',
      registrationOpenDate: addDaysIso(today, 12),
      registrationCloseDate: addDaysIso(today, 20),
      examDate: addDaysIso(today, 24),
      examTime: '09:00',
      classroom: 'Sala S1',
      notes: 'Integralni i usmeni dio završnog ispita.',
      isOpen: true,
    },
    {
      id: 'seed_ext_os_zav',
      courseId: 'seed_crs_os',
      courseCode: 'RI-OS',
      courseName: 'Operativni sistemi',
      title: 'Završni integralni ispit',
      registrationOpenDate: addDaysIso(today, -2),
      registrationCloseDate: addDaysIso(today, 5),
      examDate: addDaysIso(today, 8),
      examTime: '11:00',
      classroom: 'Laboratorija 1-02',
      notes: 'Praktični zadatak u Linux okruženju i teorijski test.',
      isOpen: true,
    },
  ];

  await Promise.all(
    demoTerms.map(async (t) => {
      const snap = await getDoc(doc(db, 'examTerms', t.id));
      if (snap.exists()) return;
      try {
        await setDoc(doc(db, 'examTerms', t.id), {
          courseId: t.courseId,
          courseCode: t.courseCode,
          courseName: t.courseName,
          title: t.title,
          examDate: t.examDate,
          examTime: t.examTime,
          classroom: t.classroom,
          registrationOpenDate: t.registrationOpenDate,
          registrationCloseDate: t.registrationCloseDate,
          notes: t.notes,
          isOpen: t.isOpen,
          createdBy: adminUid,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `examTerms/${t.id}`);
      }
    })
  );

  // Attach examTermIds onto demo courses so students discover them immediately
  const curArTermIds = arCourse.examTermIds ?? [];
  const curOsTermIds = osCourse.examTermIds ?? [];
  const nextArTermIds = Array.from(
    new Set([...curArTermIds, 'seed_ext_ar_p2', 'seed_ext_ar_zav'])
  ).slice(0, VALIDATION_CONSTRAINTS.MAX_EXAM_TERMS_PER_COURSE);
  const nextOsTermIds = Array.from(
    new Set([...curOsTermIds, 'seed_ext_os_zav'])
  ).slice(0, VALIDATION_CONSTRAINTS.MAX_EXAM_TERMS_PER_COURSE);

  const termAttachTasks: Promise<void>[] = [];
  if (nextArTermIds.length !== curArTermIds.length) {
    termAttachTasks.push(
      updateDoc(doc(db, 'courses', 'seed_crs_ar'), {
        examTermIds: nextArTermIds,
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, 'courses/seed_crs_ar'))
    );
  }
  if (nextOsTermIds.length !== curOsTermIds.length) {
    termAttachTasks.push(
      updateDoc(doc(db, 'courses', 'seed_crs_os'), {
        examTermIds: nextOsTermIds,
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, 'courses/seed_crs_os'))
    );
  }
  if (termAttachTasks.length > 0) {
    await Promise.all(termAttachTasks);
  }

  // Seed realistic demo student exam registrations so professor turnout view is populated
  const demoRegSeeds = [
    {
      termId: 'seed_ext_ar_p2',
      courseId: 'seed_crs_ar',
      courseCode: 'OR-AR',
      courseName: 'Arhitektura računara',
      termTitle: 'II parcijalni ispit',
      examDate: addDaysIso(today, 10),
      stu: { uid: 'seed_stu_haris', fullName: 'Haris Begović', index: '18942', dept: 'Računarstvo i informatika' },
      status: ExamRegistrationStatus.REGISTERED,
    },
    {
      termId: 'seed_ext_ar_p2',
      courseId: 'seed_crs_ar',
      courseCode: 'OR-AR',
      courseName: 'Arhitektura računara',
      termTitle: 'II parcijalni ispit',
      examDate: addDaysIso(today, 10),
      stu: { uid: 'seed_stu_amila', fullName: 'Amila Kovačević', index: '19014', dept: 'Računarstvo i informatika' },
      status: ExamRegistrationStatus.REGISTERED,
    },
    {
      termId: 'seed_ext_ar_p2',
      courseId: 'seed_crs_ar',
      courseCode: 'OR-AR',
      courseName: 'Arhitektura računara',
      termTitle: 'II parcijalni ispit',
      examDate: addDaysIso(today, 10),
      stu: { uid: 'seed_stu_lejla', fullName: 'Lejla Mujić', index: '19103', dept: 'Računarstvo i informatika' },
      status: ExamRegistrationStatus.REGISTERED,
    },
    {
      termId: 'seed_ext_ar_p2',
      courseId: 'seed_crs_ar',
      courseCode: 'OR-AR',
      courseName: 'Arhitektura računara',
      termTitle: 'II parcijalni ispit',
      examDate: addDaysIso(today, 10),
      stu: { uid: 'seed_stu_tarik', fullName: 'Tarik Hadžić', index: '18877', dept: 'Automatika i elektronika' },
      status: ExamRegistrationStatus.CANCELLED,
    },
    {
      termId: 'seed_ext_os_zav',
      courseId: 'seed_crs_os',
      courseCode: 'RI-OS',
      courseName: 'Operativni sistemi',
      termTitle: 'Završni integralni ispit',
      examDate: addDaysIso(today, 8),
      stu: { uid: 'seed_stu_amila', fullName: 'Amila Kovačević', index: '19014', dept: 'Računarstvo i informatika' },
      status: ExamRegistrationStatus.REGISTERED,
    },
    {
      termId: 'seed_ext_os_zav',
      courseId: 'seed_crs_os',
      courseCode: 'RI-OS',
      courseName: 'Operativni sistemi',
      termTitle: 'Završni integralni ispit',
      examDate: addDaysIso(today, 8),
      stu: { uid: 'seed_stu_haris', fullName: 'Haris Begović', index: '18942', dept: 'Računarstvo i informatika' },
      status: ExamRegistrationStatus.REGISTERED,
    },
  ];

  await runParallelChunks(demoRegSeeds, 10, async (r) => {
    const regId = `${r.termId}_${r.stu.uid}`;
    const regRef = doc(db, 'examRegistrations', regId);
    const snap = await getDoc(regRef);
    if (snap.exists()) return;
    try {
      await setDoc(regRef, {
        termId: r.termId,
        courseId: r.courseId,
        courseCode: r.courseCode,
        courseName: r.courseName,
        termTitle: r.termTitle,
        examDate: r.examDate,
        studentId: r.stu.uid,
        studentName: r.stu.fullName,
        studentIndex: r.stu.index,
        studentDepartment: r.stu.dept,
        status: r.status,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `examRegistrations/${regId}`);
    }
  });
}

async function seedDemoTeachingStaffIfMissing(params: {
  cleanLeadProfName: string;
}): Promise<void> {
  const { cleanLeadProfName } = params;
  const seedStaffMap: Array<{
    courseId: string;
    professorNames: string[];
    assistantNames: string[];
  }> = [
    {
      courseId: 'seed_crs_ar',
      professorNames: sanitizeStaffList(
        [cleanLeadProfName, 'vanr. prof. dr. Novica Nosović'],
        VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
      ),
      assistantNames: [
        'mr. Emir Buza, v. as.',
        'as. Harun Šiljak, dipl. ing. el.',
      ],
    },
    {
      courseId: 'seed_crs_tp',
      professorNames: [cleanLeadProfName],
      assistantNames: [
        'mr. Vedran Ljubović, v. as.',
        'as. Mirza Mesihović, mr. el.',
        'as. Emina Begić, bacc. ing.',
      ],
    },
    {
      courseId: 'seed_crs_os',
      professorNames: sanitizeStaffList(
        [cleanLeadProfName, 'doc. dr. Samir Ribić'],
        VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
      ),
      assistantNames: ['mr. Damir Hasić, v. as.'],
    },
  ];

  await Promise.all(
    seedStaffMap.map(async (entry) => {
      try {
        const snap = await getDoc(doc(db, 'courses', entry.courseId));
        if (!snap.exists()) return;
        const data = snap.data() as Course;
        if (data.professorNames && data.assistantNames) return;
        await updateDoc(doc(db, 'courses', entry.courseId), {
          leadProfessorName: entry.professorNames[0] || data.leadProfessorName,
          professorNames: entry.professorNames,
          assistantNames: entry.assistantNames,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking seed upgrade
      }
    })
  );
}

async function seedDemoStudyProgramsIfMissing(params: {
  adminUid: string;
  cleanAdminName: string;
  cleanLeadProfName: string;
  effectiveIndex: string;
}): Promise<void> {
  const { adminUid, cleanAdminName, cleanLeadProfName, effectiveIndex } = params;

  // 1. Backfill studyProgram on original Bachelor demo courses if missing
  await Promise.all(
    ['seed_crs_ar', 'seed_crs_tp', 'seed_crs_os'].map(async (cid) => {
      try {
        const snap = await getDoc(doc(db, 'courses', cid));
        if (!snap.exists()) return;
        const data = snap.data() as Course;
        if (data.studyProgram) return;
        await updateDoc(doc(db, 'courses', cid), {
          studyProgram: 'Bachelor · Računarstvo i informatika',
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking backfill
      }
    })
  );

  // 2. Normalize any legacy Master sub-track names on existing seed course/students
  const [rsSnap, assSnap] = await Promise.all([
    getDoc(doc(db, 'courses', 'seed_crs_rs_web')),
    getDoc(doc(db, 'courses', 'seed_crs_ri_ass')),
  ]);

  if (assSnap.exists()) {
    const assData = assSnap.data() as Course;
    if (assData.studyProgram !== MASTER_RI_PROGRAM) {
      try {
        await updateDoc(doc(db, 'courses', 'seed_crs_ri_ass'), {
          studyProgram: MASTER_RI_PROGRAM,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking normalization
      }
    }
  }

  for (const legacyStu of [
    { uid: 'seed_stu_kenan', idx: 'M-1408' },
    { uid: 'seed_stu_emina', idx: 'M-1422' },
  ]) {
    try {
      const sSnap = await getDoc(doc(db, 'userProfiles', legacyStu.uid));
      if (sSnap.exists() && (sSnap.data() as UserProfile).studyTrack !== MASTER_RI_PROGRAM) {
        await updateDoc(doc(db, 'userProfiles', legacyStu.uid), {
          studyTrack: MASTER_RI_PROGRAM,
          updatedAt: serverTimestamp(),
        });
        const dSnap = await getDoc(doc(db, 'studentDirectory', legacyStu.idx));
        if (dSnap.exists()) {
          await updateDoc(doc(db, 'studentDirectory', legacyStu.idx), {
            department: MASTER_RI_PROGRAM,
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch {
      // Non-blocking normalization
    }
  }

  if (rsSnap.exists() && assSnap.exists()) {
    return;
  }

  const today = getTodayIsoLocal();

  const programStudents = [
    {
      uid: 'seed_stu_adnan',
      fullName: 'Adnan Karić',
      index: 'RS-214',
      dept: 'Stručni studij — Razvoj softvera',
      rosterDept: 'Stručni studij · Razvoj softvera (2 god.)',
      studyTrack: STRUCNI_RS_PROGRAM,
      studyYear: 'II godina · Stručni studij Razvoj softvera (2 god.)',
    },
    {
      uid: 'seed_stu_sara',
      fullName: 'Sara Imamović',
      index: 'RS-219',
      dept: 'Stručni studij — Razvoj softvera',
      rosterDept: 'Stručni studij · Razvoj softvera (2 god.)',
      studyTrack: STRUCNI_RS_PROGRAM,
      studyYear: 'II godina · Stručni studij Razvoj softvera (2 god.)',
    },
    {
      uid: 'seed_stu_kenan',
      fullName: 'Kenan Hodžić',
      index: 'M-1408',
      dept: 'Računarstvo i informatika',
      rosterDept: MASTER_RI_PROGRAM,
      studyTrack: MASTER_RI_PROGRAM,
      studyYear: 'I godina · II ciklus (Master studij)',
    },
    {
      uid: 'seed_stu_emina',
      fullName: 'Emina Čengić',
      index: 'M-1422',
      dept: 'Računarstvo i informatika',
      rosterDept: MASTER_RI_PROGRAM,
      studyTrack: MASTER_RI_PROGRAM,
      studyYear: 'I godina · II ciklus (Master studij)',
    },
  ];

  // Stage A: Student profiles & studentDirectory
  await Promise.all(
    programStudents.map(async (stu) => {
      const pRef = doc(db, 'userProfiles', stu.uid);
      const dRef = doc(db, 'studentDirectory', stu.index);
      const [pSnap, dSnap] = await Promise.all([getDoc(pRef), getDoc(dRef)]);
      if (!pSnap.exists()) {
        await setDoc(pRef, {
          uid: stu.uid,
          fullName: stu.fullName,
          studentIndex: stu.index,
          department: stu.dept,
          role: UserRole.STUDENT,
          academicYear: '2026/2027',
          redeemedInviteId: '',
          studyYear: stu.studyYear,
          studyTrack: stu.studyTrack,
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `userProfiles/${stu.uid}`));
      }
      if (!dSnap.exists()) {
        await setDoc(dRef, {
          studentIndex: stu.index,
          uid: stu.uid,
          fullName: stu.fullName,
          department: stu.rosterDept,
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch((err) =>
          handleFirestoreError(err, OperationType.CREATE, `studentDirectory/${stu.index}`)
        );
      }
    })
  );

  // Stage B: Create Stručni studij RS (2 god.) & Master smjer courses
  const rsCatIds = ['seed_cat_rs_zad', 'seed_cat_rs_proj', 'seed_cat_rs_isp'];
  const rsItemIds = ['seed_itm_rs_1', 'seed_itm_rs_2', 'seed_itm_rs_3'];
  const rsSessionIds = ['seed_ses_rs_1', 'seed_ses_rs_2', 'seed_ses_rs_3'];
  const rsTermId = 'seed_ext_rs_zav';

  const assCatIds = ['seed_cat_ass_cas', 'seed_cat_ass_proj', 'seed_cat_ass_isp'];
  const assItemIds = ['seed_itm_ass_1', 'seed_itm_ass_2', 'seed_itm_ass_3'];
  const assSessionIds = ['seed_ses_ass_1', 'seed_ses_ass_2', 'seed_ses_ass_3'];
  const assTermId = 'seed_ext_ass_zav';

  if (!rsSnap.exists()) {
    await setDoc(doc(db, 'courses', 'seed_crs_rs_web'), {
      code: 'RS-RMW',
      name: 'Razvoj modernih web aplikacija',
      semester: 'Zimski semestar · II godina (3. semestar)',
      academicYear: '2026/2027',
      ects: 6,
      leadProfessorId: adminUid,
      leadProfessorName: cleanLeadProfName,
      professorIds: [adminUid],
      professorNames: sanitizeStaffList(
        [cleanLeadProfName, 'doc. dr. Vensada Okanović'],
        VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
      ),
      assistantNames: ['mr. Irfan Prazina, v. as.', 'as. Amar Švrakić, bacc. ing.'],
      studyProgram: STRUCNI_RS_PROGRAM,
      categoryIds: rsCatIds,
      itemIds: rsItemIds,
      sessionIds: rsSessionIds,
      examTermIds: [rsTermId],
      attendanceEnabled: true,
      attendanceMaxPoints: 10,
      allowBonusPoints: false,
      activityMarksEnabled: false,
      grade6Threshold: 55,
      grade7Threshold: 65,
      grade8Threshold: 75,
      grade9Threshold: 85,
      grade10Threshold: 95,
      isSeed: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, 'courses/seed_crs_rs_web'));
  }

  if (!assSnap.exists()) {
    await setDoc(doc(db, 'courses', 'seed_crs_ri_ass'), {
      code: 'RI-ASS',
      name: 'Arhitektura softverskih sistema i mikroservisi',
      semester: 'Zimski semestar · I godina Mastera',
      academicYear: '2026/2027',
      ects: 6,
      leadProfessorId: adminUid,
      leadProfessorName: cleanLeadProfName,
      professorIds: [adminUid],
      professorNames: sanitizeStaffList(
        [cleanLeadProfName, 'red. prof. dr. Dušanka Bošković'],
        VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
      ),
      assistantNames: ['dr. Vedad Letić, v. as.'],
      studyProgram: MASTER_RI_PROGRAM,
      categoryIds: assCatIds,
      itemIds: assItemIds,
      sessionIds: assSessionIds,
      examTermIds: [assTermId],
      attendanceEnabled: true,
      attendanceMaxPoints: 10,
      allowBonusPoints: false,
      activityMarksEnabled: false,
      grade6Threshold: 55,
      grade7Threshold: 65,
      grade8Threshold: 75,
      grade9Threshold: 85,
      grade10Threshold: 95,
      isSeed: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, 'courses/seed_crs_ri_ass'));
  }

  // Stage C: Categories, Sessions, Exam Terms & Enrollments
  const catsToCreate = [
    { id: 'seed_cat_rs_zad', courseId: 'seed_crs_rs_web', name: 'Praktični zadaci', max: 25, order: 1 },
    { id: 'seed_cat_rs_proj', courseId: 'seed_crs_rs_web', name: 'Full-stack projekat', max: 35, order: 2 },
    { id: 'seed_cat_rs_isp', courseId: 'seed_crs_rs_web', name: 'Završni praktični ispit', max: 30, order: 3 },
    { id: 'seed_cat_ass_cas', courseId: 'seed_crs_ri_ass', name: 'Arhitektonske studije slučaja', max: 20, order: 1 },
    { id: 'seed_cat_ass_proj', courseId: 'seed_crs_ri_ass', name: 'Istraživački projekat — Mikroservisi', max: 40, order: 2 },
    { id: 'seed_cat_ass_isp', courseId: 'seed_crs_ri_ass', name: 'Završni usmeni ispit', max: 30, order: 3 },
  ];

  const sessionsToCreate = [
    { id: 'seed_ses_rs_1', courseId: 'seed_crs_rs_web', date: '2026-10-01', time: '14:00 - 16:00', topic: 'Komponentna arhitektura u React i TypeScript okruženju' },
    { id: 'seed_ses_rs_2', courseId: 'seed_crs_rs_web', date: '2026-10-08', time: '14:00 - 16:00', topic: 'REST API dizajn, validacija i autentifikacija' },
    { id: 'seed_ses_rs_3', courseId: 'seed_crs_rs_web', date: '2026-10-15', time: '14:00 - 16:00', topic: 'Kontejnerizacija i produkcijski deployment' },
    { id: 'seed_ses_ass_1', courseId: 'seed_crs_ri_ass', date: '2026-10-02', time: '16:00 - 18:00', topic: 'Domain-Driven Design i granice mikroservisa' },
    { id: 'seed_ses_ass_2', courseId: 'seed_crs_ri_ass', date: '2026-10-09', time: '16:00 - 18:00', topic: 'Event-driven arhitektura i Saga obrazac' },
    { id: 'seed_ses_ass_3', courseId: 'seed_crs_ri_ass', date: '2026-10-16', time: '16:00 - 18:00', topic: 'Otpornost sistema, telemetrija i distribuirani tracing' },
  ];

  const rsRoster = [
    { uid: adminUid, fullName: cleanAdminName, index: effectiveIndex, dept: 'Stručni studij · Razvoj softvera (2 god.)' },
    { uid: programStudents[0].uid, fullName: programStudents[0].fullName, index: programStudents[0].index, dept: programStudents[0].rosterDept },
    { uid: programStudents[1].uid, fullName: programStudents[1].fullName, index: programStudents[1].index, dept: programStudents[1].rosterDept },
  ];

  const assRoster = [
    { uid: adminUid, fullName: cleanAdminName, index: effectiveIndex, dept: MASTER_RI_PROGRAM },
    { uid: programStudents[2].uid, fullName: programStudents[2].fullName, index: programStudents[2].index, dept: programStudents[2].rosterDept },
    { uid: programStudents[3].uid, fullName: programStudents[3].fullName, index: programStudents[3].index, dept: programStudents[3].rosterDept },
  ];

  await Promise.all([
    ...catsToCreate.map(async (c) => {
      const ref = doc(db, 'gradingCategories', c.id);
      if ((await getDoc(ref)).exists()) return;
      await setDoc(ref, {
        courseId: c.courseId,
        name: c.name,
        maxPoints: c.max,
        order: c.order,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `gradingCategories/${c.id}`));
    }),
    ...sessionsToCreate.map(async (s) => {
      const ref = doc(db, 'attendanceSessions', s.id);
      if ((await getDoc(ref)).exists()) return;
      await setDoc(ref, {
        courseId: s.courseId,
        date: s.date,
        time: s.time,
        topic: s.topic,
        isCancelled: false,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `attendanceSessions/${s.id}`));
    }),
    ...rsRoster.map(async (stu) => {
      const id = `seed_crs_rs_web_${stu.uid}`;
      const ref = doc(db, 'enrollments', id);
      if ((await getDoc(ref)).exists()) return;
      await setDoc(ref, {
        courseId: 'seed_crs_rs_web',
        courseCode: 'RS-RMW',
        courseName: 'Razvoj modernih web aplikacija',
        leadProfessorName: cleanLeadProfName,
        academicYear: '2026/2027',
        studentId: stu.uid,
        studentName: stu.fullName,
        studentIndex: stu.index,
        studentDepartment: stu.dept,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `enrollments/${id}`));
    }),
    ...assRoster.map(async (stu) => {
      const id = `seed_crs_ri_ass_${stu.uid}`;
      const ref = doc(db, 'enrollments', id);
      if ((await getDoc(ref)).exists()) return;
      await setDoc(ref, {
        courseId: 'seed_crs_ri_ass',
        courseCode: 'RI-ASS',
        courseName: 'Arhitektura softverskih sistema i mikroservisi',
        leadProfessorName: cleanLeadProfName,
        academicYear: '2026/2027',
        studentId: stu.uid,
        studentName: stu.fullName,
        studentIndex: stu.index,
        studentDepartment: stu.dept,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `enrollments/${id}`));
    }),
    (async () => {
      const ref = doc(db, 'examTerms', rsTermId);
      if ((await getDoc(ref)).exists()) return;
      await setDoc(ref, {
        courseId: 'seed_crs_rs_web',
        courseCode: 'RS-RMW',
        courseName: 'Razvoj modernih web aplikacija',
        title: 'Završni praktični ispit — Stručni studij RS',
        examDate: addDaysIso(today, 9),
        examTime: '13:00',
        classroom: 'Laboratorija 2-05',
        registrationOpenDate: addDaysIso(today, -2),
        registrationCloseDate: addDaysIso(today, 6),
        notes: 'Praktična odbrana web aplikacije u laboratoriji.',
        isOpen: true,
        createdBy: adminUid,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `examTerms/${rsTermId}`));
    })(),
    (async () => {
      const ref = doc(db, 'examTerms', assTermId);
      if ((await getDoc(ref)).exists()) return;
      await setDoc(ref, {
        courseId: 'seed_crs_ri_ass',
        courseCode: 'RI-ASS',
        courseName: 'Arhitektura softverskih sistema i mikroservisi',
        title: 'Odbrana projekta i završni ispit — Master RI',
        examDate: addDaysIso(today, 12),
        examTime: '17:00',
        classroom: 'Sala S3 (Kampus UNSA)',
        registrationOpenDate: addDaysIso(today, -1),
        registrationCloseDate: addDaysIso(today, 8),
        notes: 'Prezentacija arhitekture mikroservisa i usmena odbrana.',
        isOpen: true,
        createdBy: adminUid,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `examTerms/${assTermId}`));
    })(),
  ]);

  // Stage D: Grading Items
  const itemsToCreate = [
    { id: 'seed_itm_rs_1', courseId: 'seed_crs_rs_web', catId: 'seed_cat_rs_zad', name: 'REST API i JWT autentifikacija', max: 25, date: '2026-10-10', order: 1, desc: 'Implementacija serverskih ruta i validacije' },
    { id: 'seed_itm_rs_2', courseId: 'seed_crs_rs_web', catId: 'seed_cat_rs_proj', name: 'Milestone 1 — Frontend i baza podataka', max: 35, date: '2026-10-20', order: 2, desc: 'Kompletna klijentska aplikacija sa perzistencijom' },
    { id: 'seed_itm_rs_3', courseId: 'seed_crs_rs_web', catId: 'seed_cat_rs_isp', name: 'Završni praktični ispit', max: 30, date: addDaysIso(today, 9), order: 3, desc: 'Završna izrada funkcionalnosti uživo' },
    { id: 'seed_itm_ass_1', courseId: 'seed_crs_ri_ass', catId: 'seed_cat_ass_cas', name: 'ADR dokumentacija i dekompozicija domena', max: 20, date: '2026-10-12', order: 1, desc: 'Architecture Decision Records za distribuirani sistem' },
    { id: 'seed_itm_ass_2', courseId: 'seed_crs_ri_ass', catId: 'seed_cat_ass_proj', name: 'Implementacija Saga orkestracije i API Gateway-a', max: 40, date: '2026-10-21', order: 2, desc: ' Komunikacija servisa i otpornost na otkaze' },
    { id: 'seed_itm_ass_3', courseId: 'seed_crs_ri_ass', catId: 'seed_cat_ass_isp', name: 'Završni usmeni ispit', max: 30, date: addDaysIso(today, 12), order: 3, desc: 'Usmena provjera znanja iz softverske arhitekture' },
  ];

  await Promise.all(
    itemsToCreate.map(async (it) => {
      const ref = doc(db, 'gradingItems', it.id);
      if ((await getDoc(ref)).exists()) return;
      await setDoc(ref, {
        courseId: it.courseId,
        categoryId: it.catId,
        name: it.name,
        maxPoints: it.max,
        date: it.date,
        description: it.desc.trim(),
        order: it.order,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `gradingItems/${it.id}`));
    })
  );

  // Stage E: Attendance Records, Scores & Exam Registrations
  const stageEPromises: Array<Promise<void>> = [];

  rsRoster.forEach((stu, idx) => {
    rsSessionIds.forEach((sesId, sIdx) => {
      const present = !(idx === 2 && sIdx === 1);
      const recId = `${sesId}_${stu.uid}`;
      stageEPromises.push(
        (async () => {
          const ref = doc(db, 'attendanceRecords', recId);
          if ((await getDoc(ref)).exists()) return;
          await setDoc(ref, {
            courseId: 'seed_crs_rs_web',
            sessionId: sesId,
            studentId: stu.uid,
            present,
            note: '',
            markedBy: adminUid,
            professorIds: [adminUid],
            isSeed: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        })()
      );
    });

    const pts1 = [23, 24.5, 20][idx] ?? 22;
    const pts2 = [32, 34, 28][idx] ?? 30;
    stageEPromises.push(
      (async () => {
        const ref = doc(db, 'scores', `seed_itm_rs_1_${stu.uid}`);
        if ((await getDoc(ref)).exists()) return;
        await setDoc(ref, {
          courseId: 'seed_crs_rs_web',
          categoryId: 'seed_cat_rs_zad',
          itemId: 'seed_itm_rs_1',
          studentId: stu.uid,
          points: pts1,
          feedback: idx === 0 ? 'Uredna validacija ulaznih podataka i struktura ruta.' : '',
          gradedBy: adminUid,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      })(),
      (async () => {
        const ref = doc(db, 'scores', `seed_itm_rs_2_${stu.uid}`);
        if ((await getDoc(ref)).exists()) return;
        await setDoc(ref, {
          courseId: 'seed_crs_rs_web',
          categoryId: 'seed_cat_rs_proj',
          itemId: 'seed_itm_rs_2',
          studentId: stu.uid,
          points: pts2,
          feedback: idx === 0 ? 'Čist UI i responzivan prikaz na mobilnim uređajima.' : '',
          gradedBy: adminUid,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      })()
    );
  });

  assRoster.forEach((stu, idx) => {
    assSessionIds.forEach((sesId) => {
      const recId = `${sesId}_${stu.uid}`;
      stageEPromises.push(
        (async () => {
          const ref = doc(db, 'attendanceRecords', recId);
          if ((await getDoc(ref)).exists()) return;
          await setDoc(ref, {
            courseId: 'seed_crs_ri_ass',
            sessionId: sesId,
            studentId: stu.uid,
            present: true,
            note: '',
            markedBy: adminUid,
            professorIds: [adminUid],
            isSeed: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        })()
      );
    });

    const pts1 = [18.5, 19.5, 17][idx] ?? 18;
    const pts2 = [37, 39, 35][idx] ?? 36;
    stageEPromises.push(
      (async () => {
        const ref = doc(db, 'scores', `seed_itm_ass_1_${stu.uid}`);
        if ((await getDoc(ref)).exists()) return;
        await setDoc(ref, {
          courseId: 'seed_crs_ri_ass',
          categoryId: 'seed_cat_ass_cas',
          itemId: 'seed_itm_ass_1',
          studentId: stu.uid,
          points: pts1,
          feedback: idx === 0 ? 'Jasno obrazloženi kompromisi u ADR dokumentima.' : '',
          gradedBy: adminUid,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      })(),
      (async () => {
        const ref = doc(db, 'scores', `seed_itm_ass_2_${stu.uid}`);
        if ((await getDoc(ref)).exists()) return;
        await setDoc(ref, {
          courseId: 'seed_crs_ri_ass',
          categoryId: 'seed_cat_ass_proj',
          itemId: 'seed_itm_ass_2',
          studentId: stu.uid,
          points: pts2,
          feedback: '',
          gradedBy: adminUid,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      })()
    );
  });

  // Demo exam registrations on the new Stručni studij RS & Master terms
  stageEPromises.push(
    (async () => {
      const regId = `${rsTermId}_${programStudents[0].uid}`;
      const ref = doc(db, 'examRegistrations', regId);
      if ((await getDoc(ref)).exists()) return;
      await setDoc(ref, {
        termId: rsTermId,
        courseId: 'seed_crs_rs_web',
        courseCode: 'RS-RMW',
        courseName: 'Razvoj modernih web aplikacija',
        termTitle: 'Završni praktični ispit — Stručni studij RS',
        examDate: addDaysIso(today, 9),
        studentId: programStudents[0].uid,
        studentName: programStudents[0].fullName,
        studentIndex: programStudents[0].index,
        studentDepartment: programStudents[0].rosterDept,
        status: ExamRegistrationStatus.REGISTERED,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    })(),
    (async () => {
      const regId = `${assTermId}_${programStudents[2].uid}`;
      const ref = doc(db, 'examRegistrations', regId);
      if ((await getDoc(ref)).exists()) return;
      await setDoc(ref, {
        termId: assTermId,
        courseId: 'seed_crs_ri_ass',
        courseCode: 'RI-ASS',
        courseName: 'Arhitektura softverskih sistema i mikroservisi',
        termTitle: 'Odbrana projekta i završni ispit — Master SI',
        examDate: addDaysIso(today, 12),
        studentId: programStudents[2].uid,
        studentName: programStudents[2].fullName,
        studentIndex: programStudents[2].index,
        studentDepartment: programStudents[2].rosterDept,
        status: ExamRegistrationStatus.REGISTERED,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    })()
  );

  await Promise.all(stageEPromises);
}

export async function seedEtfDemoData(params: {
  adminUid: string;
  adminName: string;
  adminIndex: string;
}): Promise<void> {
  const { adminUid, adminName, adminIndex } = params;
  const cleanAdminName =
    sanitizeText(adminName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH) || 'Profesor';
  const cleanLeadProfName = sanitizeText(
    `dr. ${cleanAdminName}`,
    VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH
  );
  const effectiveIndex =
    sanitizeText(adminIndex, VALIDATION_CONSTRAINTS.STUDENT_INDEX_MAX_LENGTH) || '19001';

  // Completion marker written at the very end of Stage 5 (or existing core seed courses)
  const completionMarkerId = `seed_crs_tp_${adminUid}`;
  const [markerSnap, partialSnap, osSnapCheck, tpSnapCheck] = await Promise.all([
    getDoc(doc(db, 'finalGrades', completionMarkerId)),
    getDoc(doc(db, 'courses', 'seed_crs_ar')),
    getDoc(doc(db, 'courses', 'seed_crs_os')),
    getDoc(doc(db, 'courses', 'seed_crs_tp')),
  ]);

  if (markerSnap.exists() || (partialSnap.exists() && osSnapCheck.exists() && tpSnapCheck.exists())) {
    await Promise.all([
      seedDemoExamDataIfMissing({ adminUid }),
      seedDemoTeachingStaffIfMissing({ cleanLeadProfName }),
      seedDemoStudyProgramsIfMissing({
        adminUid,
        cleanAdminName,
        cleanLeadProfName,
        effectiveIndex,
      }),
    ]);
    await seedDemoPortalExtensionsIfMissing({
      adminUid,
      cleanAdminName,
      cleanLeadProfName,
      effectiveIndex,
    });
    await ensurePresentationLogins({ adminUid });
    return;
  }

  // Detect whether a previous partial run already wrote some seed documents
  const checkBeforeCreate = partialSnap.exists();

  interface SeedDocTask {
    col: string;
    id: string;
    data: Record<string, unknown>;
    alwaysCheckExisting?: boolean;
  }

  const writeSeedStage = async (tasks: SeedDocTask[]): Promise<void> => {
    await runParallelChunks(tasks, 20, async (task) => {
      const ref = doc(db, task.col, task.id);
      if (checkBeforeCreate || task.alwaysCheckExisting) {
        const existingSnap = await getDoc(ref);
        if (existingSnap.exists()) {
          return;
        }
      }
      try {
        await setDoc(ref, task.data);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `${task.col}/${task.id}`);
      }
    });
  };

  const demoStudents = [
    { uid: 'seed_stu_haris', fullName: 'Haris Begović', index: '18942', dept: 'Računarstvo i informatika' },
    { uid: 'seed_stu_amila', fullName: 'Amila Kovačević', index: '19014', dept: 'Računarstvo i informatika' },
    { uid: 'seed_stu_tarik', fullName: 'Tarik Hadžić', index: '18877', dept: 'Automatika i elektronika' },
    { uid: 'seed_stu_lejla', fullName: 'Lejla Mujić', index: '19103', dept: 'Računarstvo i informatika' },
    { uid: 'seed_stu_mirza', fullName: 'Mirza Delić', index: '18765', dept: 'Telekomunikacije' },
  ];

  const allEnrolled = [
    { uid: adminUid, fullName: cleanAdminName, index: effectiveIndex, dept: 'Računarstvo i informatika' },
    ...demoStudents,
  ];

  // Course 1: Arhitektura računara (Zamger classic layout)
  const arCatIds = [
    'seed_cat_ar_zad',
    'seed_cat_ar_vje',
    'seed_cat_ar_p1',
    'seed_cat_ar_p2',
    'seed_cat_ar_zav',
    'seed_cat_ar_ost',
  ];
  const arItems = [
    { id: 'seed_itm_ar_1', catId: 'seed_cat_ar_zad', name: 'Logičke funkcije i kola', max: 2, date: '2026-09-25', order: 1, desc: 'Minimizacija Booleovih funkcija i kombinaciona kola' },
    { id: 'seed_itm_ar_2', catId: 'seed_cat_ar_zad', name: 'Blokovi procesora', max: 2, date: '2026-10-02', order: 2, desc: 'ALU, registri i upravljačka jedinica' },
    { id: 'seed_itm_ar_3', catId: 'seed_cat_ar_zad', name: 'Intel 386 MMU', max: 2, date: '2026-10-09', order: 3, desc: 'Segmentacija i straničenje virtuelne memorije' },
    { id: 'seed_itm_ar_4', catId: 'seed_cat_ar_zad', name: 'I/O portovi', max: 2, date: '2026-10-15', order: 4, desc: 'Programirani U/I i memorijski mapirani registri' },
    { id: 'seed_itm_ar_5', catId: 'seed_cat_ar_zad', name: 'Mrežni uređaji', max: 2, date: '2026-10-20', order: 5, desc: 'Kontroleri mrežnog interfejsa i DMA prenos' },
    { id: 'seed_itm_ar_6', catId: 'seed_cat_ar_vje', name: 'Laboratorijska vježba 1 — x86 Asembler', max: 5, date: '2026-10-06', order: 6, desc: 'Adresni modovi i rad sa stogom' },
    { id: 'seed_itm_ar_7', catId: 'seed_cat_ar_vje', name: 'Laboratorijska vježba 2 — Prekidi', max: 5, date: '2026-10-18', order: 7, desc: 'Obrada hardverskih prekida' },
    { id: 'seed_itm_ar_8', catId: 'seed_cat_ar_p1', name: 'I parcijalni ispit', max: 20, date: '2026-10-21', order: 8, desc: 'Prvi parcijalni pisani ispit' },
    { id: 'seed_itm_ar_9', catId: 'seed_cat_ar_p2', name: 'II parcijalni ispit', max: 20, date: '2026-11-28', order: 9, desc: 'Drugi parcijalni pisani ispit' },
    { id: 'seed_itm_ar_10', catId: 'seed_cat_ar_zav', name: 'Usmeni dio završnog ispita', max: 20, date: '2026-12-18', order: 10, desc: 'Završni usmeni ispit' },
    { id: 'seed_itm_ar_11', catId: 'seed_cat_ar_ost', name: 'Dodatni projekat — RISC-V simulator', max: 10, date: '2026-10-22', order: 11, desc: 'Implementacija 5-stepenog pipeline-a' },
  ];
  const arSessions = [
    { id: 'seed_ses_ar_1', date: '2026-09-21', time: '09:00 - 11:00', topic: 'Uvod u arhitekturu računara i digitalnu logiku', cancelled: false },
    { id: 'seed_ses_ar_2', date: '2026-09-28', time: '09:00 - 11:00', topic: 'Arhitektura skupa instrukcija (ISA)', cancelled: false },
    { id: 'seed_ses_ar_3', date: '2026-10-05', time: '09:00 - 11:00', topic: 'Cjevovodna obrada (Pipelining) i hazardi', cancelled: false },
    { id: 'seed_ses_ar_4', date: '2026-10-12', time: '09:00 - 11:00', topic: 'Keš memorija i koherencija', cancelled: false },
    { id: 'seed_ses_ar_5', date: '2026-10-16', time: '12:00 - 14:00', topic: 'Vanredne konsultacije (otkazano zbog konferencije)', cancelled: true },
    { id: 'seed_ses_ar_6', date: '2026-10-19', time: '09:00 - 11:00', topic: 'Virtuelna memorija i Intel 386 MMU', cancelled: false },
    { id: 'seed_ses_ar_7', date: '2026-11-02', time: '09:00 - 11:00', topic: 'Sabirnice i ulazno-izlazni podsistem', cancelled: false },
  ];

  // Course 2: Tehnike programiranja (Completed / Finalized grade showcase)
  const tpCatIds = ['seed_cat_tp_zad', 'seed_cat_tp_vje', 'seed_cat_tp_p1', 'seed_cat_tp_p2', 'seed_cat_tp_zav'];
  const tpItems = [
    { id: 'seed_itm_tp_1', catId: 'seed_cat_tp_zad', name: 'Zadaća 1 — Kontejneri i izuzeci', max: 10, date: '2026-09-26', order: 1, desc: 'Moderni C++20 kontejneri' },
    { id: 'seed_itm_tp_2', catId: 'seed_cat_tp_zad', name: 'Zadaća 2 — Pametni pokazivači i polimorfizam', max: 10, date: '2026-10-10', order: 2, desc: 'Dinamička alokacija i RAII' },
    { id: 'seed_itm_tp_3', catId: 'seed_cat_tp_vje', name: 'Tutorijali 1–5', max: 10, date: '2026-10-14', order: 3, desc: 'Sedmični laboratorijski zadaci' },
    { id: 'seed_itm_tp_4', catId: 'seed_cat_tp_p1', name: 'I parcijalni ispit', max: 20, date: '2026-10-17', order: 4, desc: 'Prvi parcijalni ispit' },
    { id: 'seed_itm_tp_5', catId: 'seed_cat_tp_p2', name: 'II parcijalni ispit', max: 20, date: '2026-10-21', order: 5, desc: 'Drugi parcijalni ispit' },
    { id: 'seed_itm_tp_6', catId: 'seed_cat_tp_zav', name: 'Završni ispit', max: 20, date: '2026-10-22', order: 6, desc: 'Završni integralni ispit' },
  ];
  const tpSessions = [
    { id: 'seed_ses_tp_1', date: '2026-09-22', time: '11:00 - 13:00', topic: 'Tipovi podataka, reference i funkcije u C++', cancelled: false },
    { id: 'seed_ses_tp_2', date: '2026-09-29', time: '11:00 - 13:00', topic: 'Generičke funkcije i lambda izrazi', cancelled: false },
    { id: 'seed_ses_tp_3', date: '2026-10-06', time: '11:00 - 13:00', topic: 'Klase, konstruktori i preklapanje operatora', cancelled: false },
    { id: 'seed_ses_tp_4', date: '2026-10-13', time: '11:00 - 13:00', topic: 'Nasljeđivanje i polimorfizam', cancelled: false },
    { id: 'seed_ses_tp_5', date: '2026-10-20', time: '11:00 - 13:00', topic: 'Standardna biblioteka šablona (STL)', cancelled: false },
  ];

  // Course 3: Operativni sistemi (Attendance disabled showcase)
  const osCatIds = ['seed_cat_os_lab', 'seed_cat_os_proj', 'seed_cat_os_isp'];
  const osItems = [
    { id: 'seed_itm_os_1', catId: 'seed_cat_os_lab', name: 'POSIX niti i sinhronizacija semaforima', max: 25, date: '2026-10-08', order: 1, desc: 'Rješavanje problema proizvođač-potrošač' },
    { id: 'seed_itm_os_2', catId: 'seed_cat_os_proj', name: 'Linux kernel modul za upravljanje uređajima', max: 25, date: '2026-10-19', order: 2, desc: 'Implementacija znakovnog uređaja' },
    { id: 'seed_itm_os_3', catId: 'seed_cat_os_isp', name: 'Završni ispit', max: 50, date: '2026-11-25', order: 3, desc: 'Teorijski i praktični ispit' },
  ];

  // Stage 1: Demo student profiles and studentDirectory entries
  const stage1Tasks: SeedDocTask[] = [];
  for (const stu of demoStudents) {
    stage1Tasks.push({
      col: 'userProfiles',
      id: stu.uid,
      alwaysCheckExisting: true,
      data: {
        uid: stu.uid,
        fullName: stu.fullName,
        studentIndex: stu.index,
        department: stu.dept,
        role: UserRole.STUDENT,
        academicYear: '2026/2027',
        redeemedInviteId: '',
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
    stage1Tasks.push({
      col: 'studentDirectory',
      id: stu.index,
      alwaysCheckExisting: true,
      data: {
        studentIndex: stu.index,
        uid: stu.uid,
        fullName: stu.fullName,
        department: stu.dept,
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }
  await writeSeedStage(stage1Tasks);

  // Stage 2: Courses (must exist before categories, sessions, and enrollments)
  const stage2Tasks: SeedDocTask[] = [
    {
      col: 'courses',
      id: 'seed_crs_ar',
      data: {
        code: 'OR-AR',
        name: 'Arhitektura računara',
        semester: 'Zimski semestar · II godina',
        academicYear: '2026/2027',
        ects: 6,
        leadProfessorId: adminUid,
        leadProfessorName: cleanLeadProfName,
        professorIds: [adminUid],
        professorNames: sanitizeStaffList(
          [cleanLeadProfName, 'vanr. prof. dr. Novica Nosović'],
          VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
        ),
        assistantNames: ['mr. Emir Buza, v. as.', 'as. Harun Šiljak, dipl. ing. el.'],
        studyProgram: 'Bachelor · Računarstvo i informatika',
        categoryIds: arCatIds,
        itemIds: arItems.map((i) => i.id),
        sessionIds: arSessions.map((s) => s.id),
        attendanceEnabled: true,
        attendanceMaxPoints: 10,
        allowBonusPoints: false,
        activityMarksEnabled: false,
        grade6Threshold: 55,
        grade7Threshold: 65,
        grade8Threshold: 75,
        grade9Threshold: 85,
        grade10Threshold: 95,
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    },
    {
      col: 'courses',
      id: 'seed_crs_tp',
      data: {
        code: 'RI-TP',
        name: 'Tehnike programiranja',
        semester: 'Zimski semestar · I godina',
        academicYear: '2026/2027',
        ects: 7,
        leadProfessorId: adminUid,
        leadProfessorName: cleanLeadProfName,
        professorIds: [adminUid],
        professorNames: [cleanLeadProfName],
        assistantNames: [
          'mr. Vedran Ljubović, v. as.',
          'as. Mirza Mesihović, mr. el.',
          'as. Emina Begić, bacc. ing.',
        ],
        studyProgram: 'Bachelor · Računarstvo i informatika',
        categoryIds: tpCatIds,
        itemIds: tpItems.map((i) => i.id),
        sessionIds: tpSessions.map((s) => s.id),
        attendanceEnabled: true,
        attendanceMaxPoints: 10,
        allowBonusPoints: false,
        activityMarksEnabled: false,
        grade6Threshold: 55,
        grade7Threshold: 65,
        grade8Threshold: 75,
        grade9Threshold: 85,
        grade10Threshold: 95,
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    },
    {
      col: 'courses',
      id: 'seed_crs_os',
      data: {
        code: 'RI-OS',
        name: 'Operativni sistemi',
        semester: 'Ljetni semestar · II godina',
        academicYear: '2026/2027',
        ects: 5,
        leadProfessorId: adminUid,
        leadProfessorName: cleanLeadProfName,
        professorIds: [adminUid],
        professorNames: sanitizeStaffList(
          [cleanLeadProfName, 'doc. dr. Samir Ribić'],
          VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
        ),
        assistantNames: ['mr. Damir Hasić, v. as.'],
        studyProgram: 'Bachelor · Računarstvo i informatika',
        categoryIds: osCatIds,
        itemIds: osItems.map((i) => i.id),
        sessionIds: [],
        attendanceEnabled: false,
        attendanceMaxPoints: 0,
        allowBonusPoints: false,
        activityMarksEnabled: true,
        grade6Threshold: 50,
        grade7Threshold: 62,
        grade8Threshold: 74,
        grade9Threshold: 85,
        grade10Threshold: 94,
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    },
  ];
  await writeSeedStage(stage2Tasks);

  // Stage 3: Categories, Attendance Sessions, and Enrollments (depend on Courses)
  const stage3Tasks: SeedDocTask[] = [];
  const allCategoriesMeta = [
    { courseId: 'seed_crs_ar', id: 'seed_cat_ar_zad', name: 'Zadaci', max: 10, order: 1 },
    { courseId: 'seed_crs_ar', id: 'seed_cat_ar_vje', name: 'Vježbe', max: 10, order: 2 },
    { courseId: 'seed_crs_ar', id: 'seed_cat_ar_p1', name: 'I parcijalni ispit', max: 20, order: 3 },
    { courseId: 'seed_crs_ar', id: 'seed_cat_ar_p2', name: 'II parcijalni ispit', max: 20, order: 4 },
    { courseId: 'seed_crs_ar', id: 'seed_cat_ar_zav', name: 'Završni ispit', max: 20, order: 5 },
    { courseId: 'seed_crs_ar', id: 'seed_cat_ar_ost', name: 'Ostalo / dodatna aktivnost', max: 10, order: 6 },
    { courseId: 'seed_crs_tp', id: 'seed_cat_tp_zad', name: 'Zadaće', max: 20, order: 1 },
    { courseId: 'seed_crs_tp', id: 'seed_cat_tp_vje', name: 'Vježbe', max: 10, order: 2 },
    { courseId: 'seed_crs_tp', id: 'seed_cat_tp_p1', name: 'I parcijalni ispit', max: 20, order: 3 },
    { courseId: 'seed_crs_tp', id: 'seed_cat_tp_p2', name: 'II parcijalni ispit', max: 20, order: 4 },
    { courseId: 'seed_crs_tp', id: 'seed_cat_tp_zav', name: 'Završni ispit', max: 20, order: 5 },
    { courseId: 'seed_crs_os', id: 'seed_cat_os_lab', name: 'Laboratorijske vježbe', max: 25, order: 1 },
    { courseId: 'seed_crs_os', id: 'seed_cat_os_proj', name: 'Projektni zadatak', max: 25, order: 2 },
    { courseId: 'seed_crs_os', id: 'seed_cat_os_isp', name: 'Završni ispit', max: 50, order: 3 },
  ];

  for (const c of allCategoriesMeta) {
    stage3Tasks.push({
      col: 'gradingCategories',
      id: c.id,
      data: {
        courseId: c.courseId,
        name: c.name,
        maxPoints: c.max,
        order: c.order,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }

  for (const ses of arSessions) {
    stage3Tasks.push({
      col: 'attendanceSessions',
      id: ses.id,
      data: {
        courseId: 'seed_crs_ar',
        date: ses.date,
        time: ses.time,
        topic: ses.topic,
        isCancelled: ses.cancelled,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }

  for (const ses of tpSessions) {
    stage3Tasks.push({
      col: 'attendanceSessions',
      id: ses.id,
      data: {
        courseId: 'seed_crs_tp',
        date: ses.date,
        time: ses.time,
        topic: ses.topic,
        isCancelled: ses.cancelled,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }

  const courseMetaList = [
    { id: 'seed_crs_ar', code: 'OR-AR', name: 'Arhitektura računara' },
    { id: 'seed_crs_tp', code: 'RI-TP', name: 'Tehnike programiranja' },
    { id: 'seed_crs_os', code: 'RI-OS', name: 'Operativni sistemi' },
  ];
  for (const crs of courseMetaList) {
    for (const stu of allEnrolled) {
      stage3Tasks.push({
        col: 'enrollments',
        id: `${crs.id}_${stu.uid}`,
        data: {
          courseId: crs.id,
          courseCode: crs.code,
          courseName: crs.name,
          leadProfessorName: cleanLeadProfName,
          academicYear: '2026/2027',
          studentId: stu.uid,
          studentName: stu.fullName,
          studentIndex: stu.index,
          studentDepartment: stu.dept,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    }
  }
  await writeSeedStage(stage3Tasks);

  // Stage 4: Grading Items (depend on Courses and Grading Categories)
  const stage4Tasks: SeedDocTask[] = [];
  const allItemsWithCourse = [
    ...arItems.map((it) => ({ ...it, courseId: 'seed_crs_ar' })),
    ...tpItems.map((it) => ({ ...it, courseId: 'seed_crs_tp' })),
    ...osItems.map((it) => ({ ...it, courseId: 'seed_crs_os' })),
  ];
  for (const it of allItemsWithCourse) {
    stage4Tasks.push({
      col: 'gradingItems',
      id: it.id,
      data: {
        courseId: it.courseId,
        categoryId: it.catId,
        name: it.name,
        maxPoints: it.max,
        date: it.date,
        description: it.desc,
        order: it.order,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }
  await writeSeedStage(stage4Tasks);

  // Stage 5: Attendance Records, Scores, and Final Grades (depend on Sessions, Items, and Enrollments)
  const stage5Tasks: SeedDocTask[] = [];

  const heldArIds = ['seed_ses_ar_1', 'seed_ses_ar_2', 'seed_ses_ar_3', 'seed_ses_ar_4', 'seed_ses_ar_6'];
  allEnrolled.forEach((stu, stuIdx) => {
    heldArIds.forEach((sesId, sesIdx) => {
      const present =
        stuIdx === 1
          ? true
          : stuIdx === 5
            ? sesIdx < 3
            : !(sesIdx === 3 && stuIdx % 2 === 0);
      stage5Tasks.push({
        col: 'attendanceRecords',
        id: `${sesId}_${stu.uid}`,
        data: {
          courseId: 'seed_crs_ar',
          sessionId: sesId,
          studentId: stu.uid,
          present,
          note: present ? '' : 'Izostanak evidentiran na predavanju',
          markedBy: adminUid,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    });

    tpSessions.forEach((ses, sesIdx) => {
      const present = !(stuIdx === 3 && sesIdx === 2);
      stage5Tasks.push({
        col: 'attendanceRecords',
        id: `${ses.id}_${stu.uid}`,
        data: {
          courseId: 'seed_crs_tp',
          sessionId: ses.id,
          studentId: stu.uid,
          present,
          note: '',
          markedBy: adminUid,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    });
  });

  const arScoredTemplates = [
    { itemId: 'seed_itm_ar_1', catId: 'seed_cat_ar_zad', pts: [2, 2, 1.8, 1.5, 2, 1.2], fb: 'Tačna minimizacija Karnaughovom mapom.' },
    { itemId: 'seed_itm_ar_2', catId: 'seed_cat_ar_zad', pts: [2, 2, 1.9, 1.6, 1.8, 1.4], fb: '' },
    { itemId: 'seed_itm_ar_3', catId: 'seed_cat_ar_zad', pts: [1.8, 2, 1.5, 1.7, 2, 1.0], fb: 'Dobar prikaz translacije logičke u fizičku adresu.' },
    { itemId: 'seed_itm_ar_4', catId: 'seed_cat_ar_zad', pts: [2, 1.9, 1.6, 1.5, 1.9, 1.3], fb: '' },
    { itemId: 'seed_itm_ar_5', catId: 'seed_cat_ar_zad', pts: [1.7, 2, 1.5, 1.4, 1.8, 1.0], fb: '' },
    { itemId: 'seed_itm_ar_6', catId: 'seed_cat_ar_vje', pts: [4.5, 5, 4, 3.8, 4.8, 3.0], fb: 'Uspješna odbrana laboratorijske vježbe.' },
    { itemId: 'seed_itm_ar_7', catId: 'seed_cat_ar_vje', pts: [4.8, 5, 4.2, 4.0, 4.5, 3.2], fb: '' },
    { itemId: 'seed_itm_ar_8', catId: 'seed_cat_ar_p1', pts: [17.5, 19, 15.5, 14, 18, 11.5], fb: 'Odlično urađen zadatak sa keš memorijom.' },
    { itemId: 'seed_itm_ar_11', catId: 'seed_cat_ar_ost', pts: [9, 10, 8, 7.5, 9.5, 6], fb: 'Kompletna dokumentacija i testovi pipeline-a.' },
  ];

  allEnrolled.forEach((stu, idx) => {
    for (const tmpl of arScoredTemplates) {
      stage5Tasks.push({
        col: 'scores',
        id: `${tmpl.itemId}_${stu.uid}`,
        data: {
          courseId: 'seed_crs_ar',
          categoryId: tmpl.catId,
          itemId: tmpl.itemId,
          studentId: stu.uid,
          points: tmpl.pts[idx] ?? 1.5,
          feedback: idx === 0 ? tmpl.fb : '',
          gradedBy: adminUid,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    }
  });

  const tpScoredTemplates = [
    { itemId: 'seed_itm_tp_1', catId: 'seed_cat_tp_zad', pts: [9.5, 10, 8.5, 7.5, 9, 6.5] },
    { itemId: 'seed_itm_tp_2', catId: 'seed_cat_tp_zad', pts: [9.0, 9.5, 8.0, 7.0, 8.5, 6.0] },
    { itemId: 'seed_itm_tp_3', catId: 'seed_cat_tp_vje', pts: [10, 10, 9, 8.5, 9.5, 7.5] },
    { itemId: 'seed_itm_tp_4', catId: 'seed_cat_tp_p1', pts: [18, 19.5, 16, 14.5, 17.5, 12] },
    { itemId: 'seed_itm_tp_5', catId: 'seed_cat_tp_p2', pts: [17.5, 19, 15.5, 14, 17, 11.5] },
    { itemId: 'seed_itm_tp_6', catId: 'seed_cat_tp_zav', pts: [18, 19, 15, 13.5, 17, 12] },
  ];

  allEnrolled.forEach((stu, idx) => {
    for (const tmpl of tpScoredTemplates) {
      stage5Tasks.push({
        col: 'scores',
        id: `${tmpl.itemId}_${stu.uid}`,
        data: {
          courseId: 'seed_crs_tp',
          categoryId: tmpl.catId,
          itemId: tmpl.itemId,
          studentId: stu.uid,
          points: tmpl.pts[idx] ?? 8,
          feedback:
            idx === 0 && tmpl.itemId === 'seed_itm_tp_6'
              ? 'Čist i moderan C++ kod bez curenja memorije.'
              : '',
          gradedBy: adminUid,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    }
  });

  // Scores for OS
  allEnrolled.forEach((stu, idx) => {
    const pts1 = [23, 25, 20, 19, 22, 16][idx] ?? 20;
    const pts2 = [24, 24, 21, 18, 23, 17][idx] ?? 20;
    stage5Tasks.push({
      col: 'scores',
      id: `seed_itm_os_1_${stu.uid}`,
      data: {
        courseId: 'seed_crs_os',
        categoryId: 'seed_cat_os_lab',
        itemId: 'seed_itm_os_1',
        studentId: stu.uid,
        points: pts1,
        feedback: '',
        gradedBy: adminUid,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
    stage5Tasks.push({
      col: 'scores',
      id: `seed_itm_os_2_${stu.uid}`,
      data: {
        courseId: 'seed_crs_os',
        categoryId: 'seed_cat_os_proj',
        itemId: 'seed_itm_os_2',
        studentId: stu.uid,
        points: pts2,
        feedback: idx === 0 ? 'Uredna sinhronizacija pristupa uređaju u jezgru.' : '',
        gradedBy: adminUid,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  });

  await writeSeedStage(stage5Tasks);

  // Finalize TP grades last so completionMarkerId marks 100% completion
  const tpFinalMeta = [
    { total: 92, grade: 9, status: FinalGradeStatus.FINALIZED },
    { total: 97, grade: 10, status: FinalGradeStatus.FINALIZED },
    { total: 82, grade: 8, status: FinalGradeStatus.FINALIZED },
    { total: 73, grade: 7, status: FinalGradeStatus.FINALIZED },
    { total: 88.5, grade: 9, status: FinalGradeStatus.FINALIZED },
    { total: 65.5, grade: 7, status: FinalGradeStatus.DRAFT },
  ];

  const finalGradeTasks: SeedDocTask[] = [];
  let markerTask: SeedDocTask | null = null;

  allEnrolled.forEach((stu, idx) => {
    const fg = tpFinalMeta[idx];
    if (!fg) return;
    const task: SeedDocTask = {
      col: 'finalGrades',
      id: `seed_crs_tp_${stu.uid}`,
      data: {
        courseId: 'seed_crs_tp',
        studentId: stu.uid,
        totalPoints: fg.total,
        finalGrade: fg.grade,
        status: fg.status,
        finalizedBy: adminUid,
        comment:
          fg.status === FinalGradeStatus.FINALIZED
            ? 'Uspješno položen predmet u septembarskom/oktobarskom roku.'
            : 'Nacrt ocjene prije upisa.',
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    };
    if (stu.uid === adminUid) {
      markerTask = task;
    } else {
      finalGradeTasks.push(task);
    }
  });

  await writeSeedStage(finalGradeTasks);
  if (markerTask) {
    await writeSeedStage([markerTask]);
  }
  await Promise.all([
    seedDemoExamDataIfMissing({ adminUid }),
    seedDemoStudyProgramsIfMissing({
      adminUid,
      cleanAdminName,
      cleanLeadProfName,
      effectiveIndex,
    }),
  ]);
  await seedDemoPortalExtensionsIfMissing({
    adminUid,
    cleanAdminName,
    cleanLeadProfName,
    effectiveIndex,
  });
  await ensurePresentationLogins({ adminUid });
}

async function seedDemoPortalExtensionsIfMissing(params: {
  adminUid: string;
  cleanAdminName: string;
  cleanLeadProfName: string;
  effectiveIndex: string;
}): Promise<void> {
  const { adminUid, cleanAdminName, cleanLeadProfName, effectiveIndex } = params;
  const today = getTodayIsoLocal();
  const jsDay = new Date().getDay();
  const todayDow = jsDay === 0 ? 7 : jsDay; // 1=Pon .. 7=Ned
  const tomorrowDow = todayDow === 7 ? 1 : todayDow + 1;

  // 1. Academic State ("academicState/current")
  try {
    const stateRef = doc(db, 'academicState', 'current');
    if (!(await getDoc(stateRef)).exists()) {
      await setDoc(stateRef, {
        activeAcademicYear: '2026/2027',
        activeSemesterType: 'Zimski',
        semesterLabel: 'Zimski semestar 2026/2027',
        updatedBy: adminUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-blocking seed
  }

  // 2. Official Admin Announcements ("announcements")
  const seedAnnouncements = [
    {
      id: 'seed_ann_1',
      title: 'Raspored ispitnih rokova i pravila prijave u zimskom semestru 2026/2027',
      body: 'Obavještavaju se studenti I i II ciklusa studija te Stručnog studija Razvoj softvera da se prijava parcijalnih i završnih ispita vrši isključivo putem VOLTRA portala najkasnije do datuma zatvaranja prijave navedenog na predmetu.',
      category: 'ispiti' as AnnouncementCategory,
      audience: 'all' as AnnouncementAudience,
      pinned: true,
    },
    {
      id: 'seed_ann_2',
      title: 'Raspored laboratorijskih vježbi u Kampusu Univerziteta u Sarajevu',
      body: 'Redovne laboratorijske vježbe na odsjecima Računarstvo i informatika, Automatika i elektronika, Elektroenergetika i Telekomunikacije održavaju se prema objavljenom rasporedu po grupama. Prisustvo se evidentira elektronski na svakom terminu.',
      category: 'nastava' as AnnouncementCategory,
      audience: 'students' as AnnouncementAudience,
      pinned: false,
    },
    {
      id: 'seed_ann_3',
      title: 'Uputstvo nastavnom osoblju za zaključivanje ocjena i arhiviranje semestra',
      body: 'Predmetni nastavnici unose bodove po kategorijama i zaključuju konačne ocjene u sekciji Studenti i ocjene. Nakon završetka ispitnog roka studentska služba i administrator vrše arhiviranje semestra.',
      category: 'semestar' as AnnouncementCategory,
      audience: 'professors' as AnnouncementAudience,
      pinned: false,
    },
  ];

  await Promise.all(
    seedAnnouncements.map(async (ann) => {
      try {
        const ref = doc(db, 'announcements', ann.id);
        if ((await getDoc(ref)).exists()) return;
        await setDoc(ref, {
          title: ann.title,
          body: ann.body,
          category: ann.category,
          audience: ann.audience,
          pinned: ann.pinned,
          isPublished: true,
          authorUid: adminUid,
          authorName: `Studentska služba · ${cleanAdminName}`,
          academicYear: '2026/2027',
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking seed
      }
    })
  );

  // 3. Schedule Events ("scheduleEvents") — ensures "Danas" & "Ove sedmice" are populated
  const existingSchedSnap = await getDoc(doc(db, 'scheduleEvents', 'seed_sch_ar_lec'));
  if (!existingSchedSnap.exists()) {
    const scheduleSeeds: Array<{
      id: string;
      courseId: string;
      courseCode: string;
      courseName: string;
      eventType: ScheduleEventType;
      title: string;
      isRecurringWeekly: boolean;
      dayOfWeek: number;
      date: string;
      startTime: string;
      endTime: string;
      location: string;
      description: string;
    }> = [
      {
        id: 'seed_sch_ar_lec',
        courseId: 'seed_crs_ar',
        courseCode: 'OR-AR',
        courseName: 'Arhitektura računara',
        eventType: ScheduleEventType.LECTURE,
        title: 'Predavanje — Cjevovodna obrada i keš memorija',
        isRecurringWeekly: true,
        dayOfWeek: todayDow,
        date: today,
        startTime: '09:00',
        endTime: '11:00',
        location: 'Amfiteatar A1 · Kampus UNSA',
        description: 'Redovno sedmično predavanje za studente II godine.',
      },
      {
        id: 'seed_sch_ar_lab',
        courseId: 'seed_crs_ar',
        courseCode: 'OR-AR',
        courseName: 'Arhitektura računara',
        eventType: ScheduleEventType.LAB,
        title: 'Laboratorijske vježbe — x86 Asembler i prekidi',
        isRecurringWeekly: true,
        dayOfWeek: todayDow,
        date: today,
        startTime: '13:00',
        endTime: '14:30',
        location: 'Laboratorija 1-04',
        description: 'Praktične laboratorijske vježbe uz prisustvo asistenta.',
      },
      {
        id: 'seed_sch_ar_proj',
        courseId: 'seed_crs_ar',
        courseCode: 'OR-AR',
        courseName: 'Arhitektura računara',
        eventType: ScheduleEventType.PROJECT_DEADLINE,
        title: 'Rok za predaju — RISC-V 5-stepeni simulator',
        isRecurringWeekly: false,
        dayOfWeek: tomorrowDow,
        date: addDaysIso(today, 2),
        startTime: '23:59',
        endTime: '23:59',
        location: 'VOLTRA repozitorij predmeta',
        description: 'Predaja izvornog koda i kratkog tehničkog izvještaja.',
      },
      {
        id: 'seed_sch_os_lec',
        courseId: 'seed_crs_os',
        courseCode: 'RI-OS',
        courseName: 'Operativni sistemi',
        eventType: ScheduleEventType.LECTURE,
        title: 'Predavanje — Sinhronizacija procesa i raspoređivač jezgra',
        isRecurringWeekly: true,
        dayOfWeek: tomorrowDow,
        date: addDaysIso(today, 1),
        startTime: '11:00',
        endTime: '13:00',
        location: 'Sala S1 · Kampus UNSA',
        description: 'Redovno sedmično predavanje.',
      },
      {
        id: 'seed_sch_rs_lab',
        courseId: 'seed_crs_rs_web',
        courseCode: 'RS-RMW',
        courseName: 'Razvoj modernih web aplikacija',
        eventType: ScheduleEventType.LAB,
        title: 'Laboratorijske vježbe — Full-stack autentifikacija i API',
        isRecurringWeekly: true,
        dayOfWeek: todayDow,
        date: today,
        startTime: '15:00',
        endTime: '17:00',
        location: 'Laboratorija 2-05',
        description: 'Stručni studij Razvoj softvera (2 godine).',
      },
      {
        id: 'seed_sch_ass_proj',
        courseId: 'seed_crs_ri_ass',
        courseCode: 'RI-ASS',
        courseName: 'Arhitektura softverskih sistema i mikroservisi',
        eventType: ScheduleEventType.PROJECT_DEADLINE,
        title: 'Rok za projekat — Saga orkestracija i distribuirani tracing',
        isRecurringWeekly: false,
        dayOfWeek: tomorrowDow,
        date: addDaysIso(today, 4),
        startTime: '20:00',
        endTime: '20:00',
        location: 'Sala S3 / Online predaja',
        description: 'Master studij · Računarstvo i informatika.',
      },
    ];

    const byCourse = new Map<string, string[]>();
    for (const ev of scheduleSeeds) {
      try {
        const courseSnap = await getDoc(doc(db, 'courses', ev.courseId));
        if (!courseSnap.exists()) continue;
        const cData = courseSnap.data() as Course;
        const existingIds = byCourse.get(ev.courseId) ?? (cData.scheduleEventIds ?? []);
        const nextIds = Array.from(new Set([...existingIds, ev.id]));
        byCourse.set(ev.courseId, nextIds);

        const batch = writeBatch(db);
        batch.set(doc(db, 'scheduleEvents', ev.id), {
          courseId: ev.courseId,
          courseCode: ev.courseCode,
          courseName: ev.courseName,
          eventType: ev.eventType,
          title: ev.title,
          isRecurringWeekly: ev.isRecurringWeekly,
          dayOfWeek: ev.dayOfWeek,
          date: ev.date,
          startTime: ev.startTime,
          endTime: ev.endTime,
          location: ev.location,
          description: ev.description,
          createdBy: adminUid,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'courses', ev.courseId), {
          scheduleEventIds: nextIds,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } catch {
        // Non-blocking seed
      }
    }
  }

  // 4. Archived Previous Academic Year Courses (2025/2026) so students see old semesters & passed courses
  const archIm1Snap = await getDoc(doc(db, 'courses', 'seed_crs_im1'));
  if (!archIm1Snap.exists()) {
    const archivedCourses = [
      {
        id: 'seed_crs_im1',
        code: 'RI-IM1',
        name: 'Inženjerska matematika 1',
        semester: 'Zimski semestar · I godina',
        academicYear: '2025/2026',
        ects: 7,
        studyProgram: 'Bachelor · Računarstvo i informatika',
        catId: 'seed_cat_im1_isp',
        itemId: 'seed_itm_im1_zav',
        itemName: 'Integralni završni ispit i parcijalni bodovi',
        points: 88,
        grade: 9,
      },
      {
        id: 'seed_crs_uup',
        code: 'OR-UUP',
        name: 'Uvod u programiranje',
        semester: 'Zimski semestar · I godina',
        academicYear: '2025/2026',
        ects: 6,
        studyProgram: 'Bachelor · Računarstvo i informatika',
        catId: 'seed_cat_uup_isp',
        itemId: 'seed_itm_uup_zav',
        itemName: 'Zadaće, laboratorijske vježbe i završni ispit u C-u',
        points: 96,
        grade: 10,
      },
    ];

    const archStudents = [
      { uid: adminUid, fullName: cleanAdminName, index: effectiveIndex, dept: 'Računarstvo i informatika' },
      { uid: 'seed_stu_haris', fullName: 'Haris Begović', index: '18942', dept: 'Računarstvo i informatika' },
      { uid: 'seed_stu_amila', fullName: 'Amila Kovačević', index: '19014', dept: 'Računarstvo i informatika' },
    ];

    for (const ac of archivedCourses) {
      try {
        await setDoc(doc(db, 'courses', ac.id), {
          code: ac.code,
          name: ac.name,
          semester: ac.semester,
          academicYear: ac.academicYear,
          ects: ac.ects,
          leadProfessorId: adminUid,
          leadProfessorName: cleanLeadProfName,
          professorIds: [adminUid],
          professorNames: [cleanLeadProfName],
          assistantNames: ['mr. Vedran Ljubović, v. as.'],
          studyProgram: ac.studyProgram,
          categoryIds: [ac.catId],
          itemIds: [ac.itemId],
          sessionIds: [],
          examTermIds: [],
          scheduleEventIds: [],
          isArchived: true,
          attendanceEnabled: false,
          attendanceMaxPoints: 0,
          allowBonusPoints: false,
          activityMarksEnabled: false,
          grade6Threshold: 55,
          grade7Threshold: 65,
          grade8Threshold: 75,
          grade9Threshold: 85,
          grade10Threshold: 95,
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await setDoc(doc(db, 'gradingCategories', ac.catId), {
          courseId: ac.id,
          name: 'Ukupne ispitne obaveze',
          maxPoints: 100,
          order: 1,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await setDoc(doc(db, 'gradingItems', ac.itemId), {
          courseId: ac.id,
          categoryId: ac.catId,
          name: ac.itemName,
          maxPoints: 100,
          date: '2026-01-28',
          description: 'Arhivirani rezultat iz akademske 2025/2026. godine.',
          order: 1,
          professorIds: [adminUid],
          isSeed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        for (const stu of archStudents) {
          const enrId = `${ac.id}_${stu.uid}`;
          await setDoc(doc(db, 'enrollments', enrId), {
            courseId: ac.id,
            courseCode: ac.code,
            courseName: ac.name,
            leadProfessorName: cleanLeadProfName,
            academicYear: ac.academicYear,
            semester: ac.semester,
            isArchived: true,
            studentId: stu.uid,
            studentName: stu.fullName,
            studentIndex: stu.index,
            studentDepartment: stu.dept,
            professorIds: [adminUid],
            isSeed: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          await setDoc(doc(db, 'scores', `${ac.itemId}_${stu.uid}`), {
            courseId: ac.id,
            categoryId: ac.catId,
            itemId: ac.itemId,
            studentId: stu.uid,
            points: ac.points,
            feedback: 'Položeno u januarsko-februarskom ispitnom roku 2025/2026.',
            gradedBy: adminUid,
            professorIds: [adminUid],
            isSeed: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          await setDoc(doc(db, 'finalGrades', `${ac.id}_${stu.uid}`), {
            courseId: ac.id,
            studentId: stu.uid,
            totalPoints: ac.points,
            finalGrade: ac.grade,
            status: FinalGradeStatus.FINALIZED,
            finalizedBy: adminUid,
            comment: `Zaključena ocjena iz akademske ${ac.academicYear}. godine.`,
            professorIds: [adminUid],
            isSeed: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Non-blocking archived seed
      }
    }
  }

  // 5. Backfill activityMarksEnabled on existing seed courses & seed (+) marks on Operativni sistemi (doc. dr. Samir Ribić)
  try {
    const courseFlagSeeds: Array<{ id: string; enabled: boolean }> = [
      { id: 'seed_crs_os', enabled: true },
      { id: 'seed_crs_ar', enabled: false },
      { id: 'seed_crs_tp', enabled: false },
      { id: 'seed_crs_rs_web', enabled: false },
      { id: 'seed_crs_ri_ass', enabled: false },
    ];

    await Promise.all(
      courseFlagSeeds.map(async ({ id, enabled }) => {
        const cRef = doc(db, 'courses', id);
        const cSnap = await getDoc(cRef);
        if (cSnap.exists() && cSnap.data().activityMarksEnabled === undefined) {
          await updateDoc(cRef, {
            activityMarksEnabled: enabled,
            updatedAt: serverTimestamp(),
          });
        }
      })
    );

    const firstOsPlusSnap = await getDoc(doc(db, 'activityAwards', 'seed_act_os_1'));
    const osCourseSnap = await getDoc(doc(db, 'courses', 'seed_crs_os'));
    if (!firstOsPlusSnap.exists() && osCourseSnap.exists()) {
      const osProfIds = (osCourseSnap.data().professorIds as string[]) || [adminUid];
      const osPlusSeeds = [
        {
          id: 'seed_act_os_1',
          studentId: adminUid,
          date: addDaysIso(today, -9),
          description: 'Urađena vježba 1 — Sistemski pozivi i procesi (+)',
        },
        {
          id: 'seed_act_os_2',
          studentId: adminUid,
          date: addDaysIso(today, -3),
          description: 'Urađena vježba 2 — POSIX niti i semafori (+)',
        },
        {
          id: 'seed_act_os_3',
          studentId: 'seed_stu_haris',
          date: addDaysIso(today, -9),
          description: 'Urađena vježba 1 — Sistemski pozivi i procesi (+)',
        },
        {
          id: 'seed_act_os_4',
          studentId: 'seed_stu_amila',
          date: addDaysIso(today, -3),
          description: 'Urađena vježba 2 — POSIX niti i semafori (+)',
        },
      ];

      await Promise.all(
        osPlusSeeds.map(async (pl) => {
          const enrSnap = await getDoc(doc(db, 'enrollments', `seed_crs_os_${pl.studentId}`));
          if (!enrSnap.exists()) return;
          await setDoc(doc(db, 'activityAwards', pl.id), {
            courseId: 'seed_crs_os',
            studentId: pl.studentId,
            points: 0,
            maxPoints: 0,
            date: pl.date,
            description: pl.description,
            awardedBy: adminUid,
            professorIds: osProfIds,
            isSeed: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        })
      );
    }
  } catch {
    // Non-blocking activity (+) seed
  }
}

export async function clearEtfDemoData(professorUid: string): Promise<number> {
  const collectionsToClean = [
    'scheduleEvents',
    'examRegistrations',
    'examTerms',
    'activityAwards',
    'scores',
    'attendanceRecords',
    'finalGrades',
    'gradingItems',
    'gradingCategories',
    'attendanceSessions',
    'enrollments',
    'courses',
  ] as const;

  let deletedCount = 0;

  for (const colName of collectionsToClean) {
    const q = query(
      collection(db, colName),
      where('professorIds', 'array-contains', professorUid)
    );
    const snap = await getDocs(q);
    const seedDocs = snap.docs.filter((d) => d.data().isSeed === true);

    await runParallelChunks(seedDocs, 20, async (docSnap) => {
      await deleteDoc(docSnap.ref);
      deletedCount += 1;
    });
  }

  // Clean demo student profiles, directory entries & announcements (bootstrap admin allowed)
  try {
    const profSnap = await getDocs(query(collection(db, 'userProfiles'), where('isSeed', '==', true)));
    const dirSnap = await getDocs(query(collection(db, 'studentDirectory'), where('isSeed', '==', true)));
    const annSnap = await getDocs(query(collection(db, 'announcements'), where('isSeed', '==', true)));
    const allSeedIdentityDocs = [...profSnap.docs, ...dirSnap.docs, ...annSnap.docs];
    await runParallelChunks(allSeedIdentityDocs, 20, async (docSnap) => {
      await deleteDoc(docSnap.ref);
      deletedCount += 1;
    });
  } catch {
    // Non-bootstrap professor skips global profile cleanup
  }

  return deletedCount;
}

// ============================================================================
// Official Announcements ("Obavještenja" — Admin Write, All Users Read)
// ============================================================================

export function subscribePublishedAnnouncements(
  onData: (items: Announcement[]) => void
): Unsubscribe {
  const q = query(collection(db, 'announcements'), where('isPublished', '==', true));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        ...(d.data() as Omit<Announcement, 'id'>),
        id: d.id,
      }));
      list.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const aSec = (a.createdAt as { seconds?: number })?.seconds ?? 0;
        const bSec = (b.createdAt as { seconds?: number })?.seconds ?? 0;
        return bSec - aSec;
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'announcements')
  );
}

export function subscribeAllAnnouncementsForAdmin(
  onData: (items: Announcement[]) => void
): Unsubscribe {
  const sortAnnouncements = (list: Announcement[]) => {
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aSec = (a.createdAt as { seconds?: number })?.seconds ?? 0;
      const bSec = (b.createdAt as { seconds?: number })?.seconds ?? 0;
      return bSec - aSec;
    });
    return list;
  };

  if (isCurrentSessionBootstrapAdmin()) {
    return onSnapshot(
      collection(db, 'announcements'),
      (snap) => {
        adminIndexDraft.announcementIds = snap.docs.map((d) => d.id);
        adminIndexLoadedSections.add('announcementIds');
        scheduleBootstrapAdminIndexFlush();

        const list = snap.docs.map((d) => ({
          ...(d.data() as Omit<Announcement, 'id'>),
          id: d.id,
        }));
        onData(sortAnnouncements(list));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'announcements')
    );
  }

  let active = true;
  const unsub = onSnapshot(
    doc(db, 'adminIndex', 'global'),
    async (idxSnap) => {
      if (!idxSnap.exists()) {
        onData([]);
        return;
      }
      const ids = (idxSnap.data() as AdminIndex).announcementIds ?? [];
      const results: Announcement[] = [];
      await runParallelChunks(ids, 20, async (id) => {
        try {
          const d = await getDoc(doc(db, 'announcements', id));
          if (d.exists()) {
            results.push({ ...(d.data() as Omit<Announcement, 'id'>), id: d.id });
          }
        } catch {
          // Skip missing or inaccessible doc
        }
      });
      if (active) {
        onData(sortAnnouncements(results));
      }
    },
    (err) => handleFirestoreError(err, OperationType.GET, 'adminIndex/global')
  );
  return () => {
    active = false;
    unsub();
  };
}

export async function createAnnouncement(params: {
  adminUid: string;
  authorName: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  audience: AnnouncementAudience;
  pinned: boolean;
  academicYear: string;
}): Promise<string> {
  const cleanTitle = sanitizeText(
    params.title,
    VALIDATION_CONSTRAINTS.ANNOUNCEMENT_TITLE_MAX_LENGTH
  );
  const cleanBody = sanitizeText(params.body, VALIDATION_CONSTRAINTS.ANNOUNCEMENT_BODY_MAX_LENGTH);
  if (!cleanTitle || !cleanBody) {
    throw new Error('Naslov i tekst obavještenja su obavezni.');
  }

  const id = makeEntityId('ann');
  try {
    await setDoc(doc(db, 'announcements', id), {
      title: cleanTitle,
      body: cleanBody,
      category: params.category,
      audience: params.audience,
      pinned: Boolean(params.pinned),
      isPublished: true,
      authorUid: params.adminUid,
      authorName:
        sanitizeText(params.authorName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH) ||
        'Administrator',
      academicYear:
        sanitizeText(params.academicYear, VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH) ||
        '2026/2027',
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    void mutateAdminIndex({ addAnnouncementIds: [id] });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `announcements/${id}`);
  }
}

export async function updateAnnouncement(
  id: string,
  updates: {
    title: string;
    body: string;
    category: AnnouncementCategory;
    audience: AnnouncementAudience;
    pinned: boolean;
    isPublished: boolean;
    authorName: string;
    academicYear: string;
  }
): Promise<void> {
  const cleanTitle = sanitizeText(
    updates.title,
    VALIDATION_CONSTRAINTS.ANNOUNCEMENT_TITLE_MAX_LENGTH
  );
  const cleanBody = sanitizeText(
    updates.body,
    VALIDATION_CONSTRAINTS.ANNOUNCEMENT_BODY_MAX_LENGTH
  );
  if (!cleanTitle || !cleanBody) {
    throw new Error('Naslov i sadržaj obavještenja su obavezni.');
  }

  try {
    await updateDoc(doc(db, 'announcements', id), {
      title: cleanTitle,
      body: cleanBody,
      category: updates.category,
      audience: updates.audience,
      pinned: Boolean(updates.pinned),
      isPublished: Boolean(updates.isPublished),
      authorName:
        sanitizeText(updates.authorName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH) ||
        'Administrator',
      academicYear:
        sanitizeText(updates.academicYear, VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH) ||
        '2026/2027',
      updatedAt: serverTimestamp(),
    });
    void mutateAdminIndex({});
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `announcements/${id}`);
  }
}

export async function deleteAnnouncement(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'announcements', id));
    void mutateAdminIndex({ removeAnnouncementIds: [id] });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `announcements/${id}`);
  }
}

// ============================================================================
// Schedule & Deadlines ("Raspored" — Lectures, Labs, Exams, Project Deadlines)
// ============================================================================

export function subscribeProfessorScheduleEvents(
  professorUid: string,
  onData: (events: ScheduleEvent[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'scheduleEvents'),
    where('professorIds', 'array-contains', professorUid)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<ScheduleEvent, 'id'>), id: d.id })));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'scheduleEvents')
  );
}

export function subscribeAllScheduleEventsForAdmin(
  onData: (events: ScheduleEvent[]) => void
): Unsubscribe {
  if (isCurrentSessionBootstrapAdmin()) {
    return onSnapshot(
      collection(db, 'scheduleEvents'),
      (snap) => {
        adminIndexDraft.scheduleEventIds = snap.docs.map((d) => d.id);
        adminIndexLoadedSections.add('scheduleEventIds');
        scheduleBootstrapAdminIndexFlush();
        onData(snap.docs.map((d) => ({ ...(d.data() as Omit<ScheduleEvent, 'id'>), id: d.id })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'scheduleEvents')
    );
  }

  return onSnapshot(
    doc(db, 'adminIndex', 'global'),
    async (idxSnap) => {
      if (!idxSnap.exists()) {
        onData([]);
        return;
      }
      const ids = (idxSnap.data() as AdminIndex).scheduleEventIds ?? [];
      const results: ScheduleEvent[] = [];
      await runParallelChunks(ids, 20, async (id) => {
        try {
          const d = await getDoc(doc(db, 'scheduleEvents', id));
          if (d.exists()) {
            results.push({ ...(d.data() as Omit<ScheduleEvent, 'id'>), id: d.id });
          }
        } catch {
          // Skip missing doc
        }
      });
      onData(results);
    },
    (err) => handleFirestoreError(err, OperationType.GET, 'adminIndex/global')
  );
}

export async function createScheduleEvent(params: {
  course: Course;
  actorUid: string;
  eventType: ScheduleEventType;
  title: string;
  isRecurringWeekly: boolean;
  dayOfWeek: number;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
}): Promise<string> {
  const { course, actorUid } = params;
  const existingIds = course.scheduleEventIds ?? [];
  if (existingIds.length >= VALIDATION_CONSTRAINTS.MAX_SCHEDULE_EVENTS_PER_COURSE) {
    throw new Error('Dostignut je maksimalan broj stavki rasporeda za ovaj predmet (80).');
  }

  const cleanTitle = sanitizeText(params.title, VALIDATION_CONSTRAINTS.SCHEDULE_TITLE_MAX_LENGTH);
  if (!cleanTitle) {
    throw new Error('Unesite naziv termina ili roka.');
  }
  const cleanDate = params.date || getTodayIsoLocal();
  if (!isValidIsoDate(cleanDate)) {
    throw new Error('Datum mora biti u formatu YYYY-MM-DD.');
  }
  const cleanStart =
    sanitizeText(params.startTime, VALIDATION_CONSTRAINTS.SCHEDULE_TIME_MAX_LENGTH) || '09:00';
  const cleanEnd = sanitizeText(params.endTime, VALIDATION_CONSTRAINTS.SCHEDULE_TIME_MAX_LENGTH);
  const dow = Math.max(1, Math.min(7, Math.round(params.dayOfWeek || 1)));

  const eventId = makeEntityId('sch');
  const effectiveActorUid = auth.currentUser?.uid || actorUid;
  const childProfessorIds = buildCourseChildProfessorIds(course, effectiveActorUid);
  if (!childProfessorIds.includes(effectiveActorUid)) {
    childProfessorIds.push(effectiveActorUid);
  }

  try {
    await setDoc(doc(db, 'scheduleEvents', eventId), {
      courseId: course.id,
      courseCode: course.code,
      courseName: course.name,
      eventType: params.eventType,
      title: cleanTitle,
      isRecurringWeekly: Boolean(params.isRecurringWeekly),
      dayOfWeek: dow,
      date: cleanDate,
      startTime: cleanStart,
      endTime: cleanEnd,
      location: sanitizeText(params.location, VALIDATION_CONSTRAINTS.SCHEDULE_LOCATION_MAX_LENGTH),
      description: sanitizeText(
        params.description,
        VALIDATION_CONSTRAINTS.SCHEDULE_DESCRIPTION_MAX_LENGTH
      ),
      createdBy: effectiveActorUid,
      professorIds: childProfessorIds.slice(0, VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE),
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `scheduleEvents/${eventId}`);
  }

  try {
    await updateDoc(doc(db, 'courses', course.id), {
      scheduleEventIds: Array.from(new Set([...existingIds, eventId])),
      updatedAt: serverTimestamp(),
    });
    if (isCurrentSessionBootstrapAdmin()) {
      void mutateAdminIndex({ addScheduleEventIds: [eventId] });
    }
    return eventId;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }
}

export async function updateScheduleEvent(
  event: ScheduleEvent,
  course: Course,
  updates: {
    eventType: ScheduleEventType;
    title: string;
    isRecurringWeekly: boolean;
    dayOfWeek: number;
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    description: string;
  }
): Promise<void> {
  const cleanTitle = sanitizeText(updates.title, VALIDATION_CONSTRAINTS.SCHEDULE_TITLE_MAX_LENGTH);
  if (!cleanTitle) {
    throw new Error('Naziv stavke rasporeda je obavezan.');
  }
  const cleanDate = updates.date || event.date || getTodayIsoLocal();
  if (!isValidIsoDate(cleanDate)) {
    throw new Error('Datum nije ispravan.');
  }

  try {
    await updateDoc(doc(db, 'scheduleEvents', event.id), {
      courseCode: course.code,
      courseName: course.name,
      eventType: updates.eventType,
      title: cleanTitle,
      isRecurringWeekly: Boolean(updates.isRecurringWeekly),
      dayOfWeek: Math.max(1, Math.min(7, Math.round(updates.dayOfWeek || 1))),
      date: cleanDate,
      startTime:
        sanitizeText(updates.startTime, VALIDATION_CONSTRAINTS.SCHEDULE_TIME_MAX_LENGTH) || '09:00',
      endTime: sanitizeText(updates.endTime, VALIDATION_CONSTRAINTS.SCHEDULE_TIME_MAX_LENGTH),
      location: sanitizeText(updates.location, VALIDATION_CONSTRAINTS.SCHEDULE_LOCATION_MAX_LENGTH),
      description: sanitizeText(
        updates.description,
        VALIDATION_CONSTRAINTS.SCHEDULE_DESCRIPTION_MAX_LENGTH
      ),
      professorIds: buildCourseChildProfessorIds(course, auth.currentUser?.uid),
      updatedAt: serverTimestamp(),
    });
    if (isCurrentSessionBootstrapAdmin()) {
      void mutateAdminIndex({});
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `scheduleEvents/${event.id}`);
  }
}

export async function deleteScheduleEvent(params: {
  course: Course;
  eventId: string;
}): Promise<void> {
  const { course, eventId } = params;
  try {
    await updateDoc(doc(db, 'courses', course.id), {
      scheduleEventIds: (course.scheduleEventIds ?? []).filter((id) => id !== eventId),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  try {
    await deleteDoc(doc(db, 'scheduleEvents', eventId));
    if (isCurrentSessionBootstrapAdmin()) {
      void mutateAdminIndex({ removeScheduleEventIds: [eventId] });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `scheduleEvents/${eventId}`);
  }
}

// ============================================================================
// Semesters, Academic State & Archiving ("Semestri i akademske godine")
// ============================================================================

export function subscribeAcademicState(
  onData: (state: AcademicState | null) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'academicState', 'current'),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData({ ...(snap.data() as Omit<AcademicState, 'id'>), id: snap.id });
    },
    (err) => handleFirestoreError(err, OperationType.GET, 'academicState/current')
  );
}

export async function setCourseArchiveStatus(params: {
  course: Course;
  isArchived: boolean;
  courseEnrollments: Enrollment[];
}): Promise<void> {
  const { course, isArchived, courseEnrollments } = params;
  try {
    await updateDoc(doc(db, 'courses', course.id), {
      isArchived,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${course.id}`);
  }

  await runParallelChunks(courseEnrollments, 15, async (enr) => {
    try {
      await updateDoc(doc(db, 'enrollments', enr.id), {
        isArchived,
        semester: course.semester,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Best-effort enrollment archive flag sync
    }
  });
  void mutateAdminIndex({});
}

export async function archiveSemesterAndOpenNew(params: {
  adminUid: string;
  coursesToArchive: Course[];
  allEnrollments: Enrollment[];
  nextAcademicYear: string;
  nextSemesterType: 'Zimski' | 'Ljetni';
  nextSemesterLabel: string;
  cloneFreshCourses?: boolean;
}): Promise<{ archivedCount: number; clonedCount: number }> {
  const {
    adminUid,
    coursesToArchive,
    allEnrollments,
    nextAcademicYear,
    nextSemesterType,
    nextSemesterLabel,
    cloneFreshCourses = false,
  } = params;

  const cleanYear =
    sanitizeText(nextAcademicYear, VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH) || '2027/2028';
  const cleanLabel =
    sanitizeText(nextSemesterLabel, VALIDATION_CONSTRAINTS.SEMESTER_MAX_LENGTH) ||
    `${nextSemesterType} semestar ${cleanYear}`;

  let archivedCount = 0;
  for (const crs of coursesToArchive) {
    const crsEnrollments = allEnrollments.filter((e) => e.courseId === crs.id);
    await setCourseArchiveStatus({
      course: crs,
      isArchived: true,
      courseEnrollments: crsEnrollments,
    });
    archivedCount += 1;
  }

  let clonedCount = 0;
  if (cloneFreshCourses) {
    for (const crs of coursesToArchive) {
      const newCourseId = makeEntityId('crs');
      const defaultCats = [
        { id: makeEntityId('cat'), name: 'Zadaci', maxPoints: 10, order: 1 },
        { id: makeEntityId('cat'), name: 'Vježbe', maxPoints: 10, order: 2 },
        { id: makeEntityId('cat'), name: 'I parcijalni ispit', maxPoints: 20, order: 3 },
        { id: makeEntityId('cat'), name: 'II parcijalni ispit', maxPoints: 20, order: 4 },
        { id: makeEntityId('cat'), name: 'Završni ispit', maxPoints: 30, order: 5 },
      ];

      await setDoc(doc(db, 'courses', newCourseId), {
        code: crs.code,
        name: crs.name,
        semester: crs.semester,
        academicYear: cleanYear,
        ects: crs.ects,
        leadProfessorId: crs.leadProfessorId,
        leadProfessorName: crs.leadProfessorName,
        professorIds: crs.professorIds,
        professorNames: crs.professorNames ?? [crs.leadProfessorName],
        assistantNames: crs.assistantNames ?? [],
        studyProgram: crs.studyProgram || 'Bachelor · Računarstvo i informatika',
        categoryIds: defaultCats.map((c) => c.id),
        itemIds: [],
        sessionIds: [],
        examTermIds: [],
        scheduleEventIds: [],
        isArchived: false,
        attendanceEnabled: crs.attendanceEnabled,
        attendanceMaxPoints: crs.attendanceMaxPoints,
        allowBonusPoints: crs.allowBonusPoints,
        activityMarksEnabled: Boolean(crs.activityMarksEnabled),
        grade6Threshold: crs.grade6Threshold,
        grade7Threshold: crs.grade7Threshold,
        grade8Threshold: crs.grade8Threshold,
        grade9Threshold: crs.grade9Threshold,
        grade10Threshold: crs.grade10Threshold,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await Promise.all(
        defaultCats.map((cat) =>
          setDoc(doc(db, 'gradingCategories', cat.id), {
            courseId: newCourseId,
            name: cat.name,
            maxPoints: cat.maxPoints,
            order: cat.order,
            professorIds: crs.professorIds,
            isSeed: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        )
      );
      clonedCount += 1;
      void mutateAdminIndex({ addCourseIds: [newCourseId] });
    }
  }

  const stateRef = doc(db, 'academicState', 'current');
  const stateSnap = await getDoc(stateRef);
  try {
    if (stateSnap.exists()) {
      await updateDoc(stateRef, {
        activeAcademicYear: cleanYear,
        activeSemesterType: nextSemesterType,
        semesterLabel: cleanLabel,
        updatedBy: adminUid,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(stateRef, {
        activeAcademicYear: cleanYear,
        activeSemesterType: nextSemesterType,
        semesterLabel: cleanLabel,
        updatedBy: adminUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'academicState/current');
  }

  return { archivedCount, clonedCount };
}

// ============================================================================
// Administrator Console Subscriptions & Account Provisioning
// ============================================================================

export function subscribeAllUsersForAdmin(callbacks: {
  onProfiles: (rows: UserProfile[]) => void;
  onPrivates: (rows: UserPrivate[]) => void;
  onProvisioned: (rows: ProvisionedAccount[]) => void;
}): Unsubscribe {
  if (isCurrentSessionBootstrapAdmin()) {
    const u1 = onSnapshot(
      collection(db, 'userProfiles'),
      (snap) => {
        adminIndexDraft.userIds = snap.docs.map((d) => d.id);
        adminIndexLoadedSections.add('userIds');
        scheduleBootstrapAdminIndexFlush();

        callbacks.onProfiles(
          snap.docs.map((d) => {
            const data = d.data() as UserProfile;
            return {
              ...data,
              uid: d.id,
              studyTrack: data.studyTrack ? normalizeStudyTrack(data.studyTrack) : data.studyTrack,
            };
          })
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'userProfiles')
    );

    const u2 = onSnapshot(
      collection(db, 'userPrivate'),
      (snap) => {
        callbacks.onPrivates(
          snap.docs.map((d) => ({ ...(d.data() as Omit<UserPrivate, 'uid'>), uid: d.id }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'userPrivate')
    );

    const u3 = onSnapshot(
      collection(db, 'provisionedAccounts'),
      (snap) => {
        adminIndexDraft.provisionedIds = snap.docs.map((d) => d.id);
        adminIndexLoadedSections.add('provisionedIds');
        scheduleBootstrapAdminIndexFlush();

        callbacks.onProvisioned(
          snap.docs.map((d) => ({ ...(d.data() as Omit<ProvisionedAccount, 'id'>), id: d.id }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'provisionedAccounts')
    );

    return () => {
      u1();
      u2();
      u3();
    };
  }

  return onSnapshot(
    doc(db, 'adminIndex', 'global'),
    async (idxSnap) => {
      if (!idxSnap.exists()) {
        callbacks.onProfiles([]);
        callbacks.onPrivates([]);
        callbacks.onProvisioned([]);
        return;
      }
      const idx = idxSnap.data() as AdminIndex;
      const userIds = idx.userIds ?? [];
      const provisionedIds = idx.provisionedIds ?? [];

      const profiles: UserProfile[] = [];
      const privates: UserPrivate[] = [];
      const provRows: ProvisionedAccount[] = [];

      await runParallelChunks(userIds, 20, async (uid) => {
        try {
          const [pSnap, privSnap] = await Promise.all([
            getDoc(doc(db, 'userProfiles', uid)),
            getDoc(doc(db, 'userPrivate', uid)),
          ]);
          if (pSnap.exists()) {
            const data = pSnap.data() as UserProfile;
            profiles.push({
              ...data,
              uid: pSnap.id,
              studyTrack: data.studyTrack ? normalizeStudyTrack(data.studyTrack) : data.studyTrack,
            });
          }
          if (privSnap.exists()) {
            privates.push({ ...(privSnap.data() as Omit<UserPrivate, 'uid'>), uid: privSnap.id });
          }
        } catch {
          // Skip inaccessible doc
        }
      });

      await runParallelChunks(provisionedIds, 20, async (pid) => {
        try {
          const pSnap = await getDoc(doc(db, 'provisionedAccounts', pid));
          if (pSnap.exists()) {
            provRows.push({
              ...(pSnap.data() as Omit<ProvisionedAccount, 'id'>),
              id: pSnap.id,
            });
          }
        } catch {
          // Skip inaccessible doc
        }
      });

      callbacks.onProfiles(profiles);
      callbacks.onPrivates(privates);
      callbacks.onProvisioned(provRows);
    },
    (err) => handleFirestoreError(err, OperationType.GET, 'adminIndex/global')
  );
}

export function subscribeAllCoursesForAdmin(
  onData: (courses: Course[]) => void
): Unsubscribe {
  if (isCurrentSessionBootstrapAdmin()) {
    return onSnapshot(
      collection(db, 'courses'),
      (snap) => {
        adminIndexDraft.courseIds = snap.docs.map((d) => d.id);
        adminIndexLoadedSections.add('courseIds');
        scheduleBootstrapAdminIndexFlush();

        onData(
          snap.docs.map((d) => {
            const raw = d.data() as Omit<Course, 'id'>;
            return {
              ...raw,
              id: d.id,
              studyProgram: raw.studyProgram ? normalizeStudyTrack(raw.studyProgram) : undefined,
            };
          })
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'courses')
    );
  }

  return onSnapshot(
    doc(db, 'adminIndex', 'global'),
    async (idxSnap) => {
      if (!idxSnap.exists()) {
        onData([]);
        return;
      }
      const ids = (idxSnap.data() as AdminIndex).courseIds ?? [];
      const results: Course[] = [];
      await runParallelChunks(ids, 20, async (id) => {
        try {
          const d = await getDoc(doc(db, 'courses', id));
          if (d.exists()) {
            const raw = d.data() as Omit<Course, 'id'>;
            results.push({
              ...raw,
              id: d.id,
              studyProgram: raw.studyProgram ? normalizeStudyTrack(raw.studyProgram) : undefined,
            });
          }
        } catch {
          // Skip missing doc
        }
      });
      onData(results);
    },
    (err) => handleFirestoreError(err, OperationType.GET, 'adminIndex/global')
  );
}

export function subscribeAllEnrollmentsForAdmin(
  onData: (rows: Enrollment[]) => void
): Unsubscribe {
  if (isCurrentSessionBootstrapAdmin()) {
    return onSnapshot(
      collection(db, 'enrollments'),
      (snap) => {
        adminIndexDraft.enrollmentIds = snap.docs.map((d) => d.id);
        adminIndexLoadedSections.add('enrollmentIds');
        scheduleBootstrapAdminIndexFlush();

        onData(snap.docs.map((d) => ({ ...(d.data() as Omit<Enrollment, 'id'>), id: d.id })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'enrollments')
    );
  }

  return onSnapshot(
    doc(db, 'adminIndex', 'global'),
    async (idxSnap) => {
      if (!idxSnap.exists()) {
        onData([]);
        return;
      }
      const ids = (idxSnap.data() as AdminIndex).enrollmentIds ?? [];
      const results: Enrollment[] = [];
      await runParallelChunks(ids, 20, async (id) => {
        try {
          const d = await getDoc(doc(db, 'enrollments', id));
          if (d.exists()) {
            results.push({ ...(d.data() as Omit<Enrollment, 'id'>), id: d.id });
          }
        } catch {
          // Skip missing doc
        }
      });
      onData(results);
    },
    (err) => handleFirestoreError(err, OperationType.GET, 'adminIndex/global')
  );
}

export interface AdminCreatedAccountResult {
  uid: string;
  email: string;
  password: string;
  role: 'student' | 'professor' | 'admin';
  fullName: string;
  studentIndex: string;
  studyTrack: string;
  studyYear: string;
  department: string;
  emailPasswordAuthActive: boolean;
}

export async function adminCreateUserAccount(params: {
  adminUid: string;
  email: string;
  password: string;
  fullName: string;
  role: 'student' | 'professor' | 'admin';
  studentIndex?: string;
  department: string;
  studyTrack?: string;
  studyYear?: string;
  academicYear: string;
  academicTitle?: string;
  officeLocation?: string;
  consultationHours?: string;
  phone?: string;
  coursesToEnroll?: Course[];
  coursesToAssign?: Course[];
  allEnrollments?: Enrollment[];
  allScheduleEvents?: ScheduleEvent[];
}): Promise<AdminCreatedAccountResult> {
  const cleanEmail = sanitizeText(
    params.email.toLowerCase(),
    VALIDATION_CONSTRAINTS.EMAIL_MAX_LENGTH
  );
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Unesite ispravnu e-mail adresu za prijavu.');
  }
  const password = params.password.trim();
  if (password.length < 6 || password.length > 64) {
    throw new Error('Početna lozinka mora imati najmanje 6 znakova.');
  }
  const cleanName = sanitizeText(params.fullName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH);
  if (!cleanName) {
    throw new Error('Ime i prezime korisnika je obavezno.');
  }

  const cleanIndex =
    params.role === 'student'
      ? sanitizeText(params.studentIndex || '', VALIDATION_CONSTRAINTS.STUDENT_INDEX_MAX_LENGTH)
      : '';

  if (params.role === 'student') {
    if (!cleanIndex || !VALIDATION_CONSTRAINTS.STUDENT_INDEX_REQUIRED_PATTERN.test(cleanIndex)) {
      throw new Error('Za studenta je obavezan ispravan broj indeksa (npr. 19240 ili RS-230).');
    }
    const existingIdxSnap = await getDoc(doc(db, 'studentDirectory', cleanIndex));
    if (existingIdxSnap.exists()) {
      throw new Error(`Broj indeksa ${cleanIndex} je već dodijeljen drugom studentu.`);
    }
  }

  const isStaffRole = params.role === 'professor' || params.role === 'admin';
  const cleanDept =
    sanitizeText(params.department, VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH) ||
    'Računarstvo i informatika';
  const cleanTrack =
    params.role === 'student'
      ? sanitizeText(
          normalizeStudyTrack(params.studyTrack),
          VALIDATION_CONSTRAINTS.STUDY_TRACK_MAX_LENGTH
        )
      : '';
  const cleanStudyYear =
    params.role === 'student'
      ? sanitizeText(params.studyYear || '', VALIDATION_CONSTRAINTS.STUDY_YEAR_MAX_LENGTH)
      : '';
  const cleanAcadYear =
    sanitizeText(params.academicYear, VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH) ||
    '2026/2027';
  const cleanTitle = isStaffRole
    ? sanitizeText(
        params.academicTitle || 'doc. dr.',
        VALIDATION_CONSTRAINTS.ACADEMIC_TITLE_MAX_LENGTH
      )
    : '';
  const cleanOffice = isStaffRole
    ? sanitizeText(params.officeLocation || '', VALIDATION_CONSTRAINTS.OFFICE_LOCATION_MAX_LENGTH)
    : '';
  const cleanConsult = isStaffRole
    ? sanitizeText(
        params.consultationHours || '',
        VALIDATION_CONSTRAINTS.CONSULTATION_HOURS_MAX_LENGTH
      )
    : '';
  const cleanPhone = sanitizeText(params.phone || '', VALIDATION_CONSTRAINTS.PHONE_MAX_LENGTH);

  let createdAuthUid = '';
  let emailPasswordAuthActive = true;

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, password);
    createdAuthUid = cred.user.uid;
    await firebaseSignOut(secondaryAuth);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/email-already-in-use') {
      throw new Error(
        `E-mail adresa ${cleanEmail} već ima kreiran login nalog u Firebase autentifikaciji.`
      );
    }
    if (code === 'auth/operation-not-allowed') {
      emailPasswordAuthActive = false;
    } else {
      throw new Error(
        err instanceof Error ? err.message : 'Greška pri kreiranju login naloga.'
      );
    }
  }

  const provId = emailToProvisionId(cleanEmail);

  try {
    await setDoc(doc(db, 'provisionedAccounts', provId), {
      targetEmail: cleanEmail,
      fullName: cleanName,
      role: params.role,
      studentIndex: cleanIndex,
      department: cleanDept,
      studyTrack: cleanTrack,
      studyYear: cleanStudyYear,
      academicYear: cleanAcadYear,
      academicTitle: cleanTitle,
      officeLocation: cleanOffice,
      consultationHours: cleanConsult,
      authUid: createdAuthUid,
      status: createdAuthUid ? 'active' : 'pending',
      createdBy: params.adminUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `provisionedAccounts/${provId}`);
  }

  const createdEnrollmentIds: string[] = [];

  if (createdAuthUid) {
    const roleEnum =
      params.role === 'admin'
        ? UserRole.ADMIN
        : params.role === 'professor'
          ? UserRole.PROFESSOR
          : UserRole.STUDENT;
    try {
      await setDoc(doc(db, 'userProfiles', createdAuthUid), {
        uid: createdAuthUid,
        fullName: cleanName,
        studentIndex: cleanIndex,
        department: cleanDept,
        role: roleEnum,
        academicYear: cleanAcadYear,
        redeemedInviteId: provId,
        academicTitle: cleanTitle,
        officeLocation: cleanOffice,
        consultationHours: cleanConsult,
        studyYear: cleanStudyYear,
        studyTrack: cleanTrack,
        personalNote: '',
        provisionedByAdmin: true,
        notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'userPrivate', createdAuthUid), {
        uid: createdAuthUid,
        email: cleanEmail,
        phone: cleanPhone,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (params.role === 'admin') {
        await setDoc(doc(db, 'admins', createdAuthUid), {
          uid: createdAuthUid,
          grantedBy: params.adminUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `userProfiles/${createdAuthUid}`);
    }

    if (params.role === 'student' && cleanIndex) {
      const rosterDept =
        sanitizeText(
          formatStudentRosterProgramLabel(cleanDept, cleanTrack),
          VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH
        ) || cleanDept;

      try {
        await setDoc(doc(db, 'studentDirectory', cleanIndex), {
          studentIndex: cleanIndex,
          uid: createdAuthUid,
          fullName: cleanName,
          department: rosterDept,
          isSeed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `studentDirectory/${cleanIndex}`);
      }

      if (params.coursesToEnroll && params.coursesToEnroll.length > 0) {
        await runParallelChunks(params.coursesToEnroll, 10, async (crs) => {
          const enrId = `${crs.id}_${createdAuthUid}`;
          createdEnrollmentIds.push(enrId);
          await setDoc(doc(db, 'enrollments', enrId), {
            courseId: crs.id,
            courseCode: crs.code,
            courseName: crs.name,
            leadProfessorName: crs.leadProfessorName,
            academicYear: crs.academicYear,
            semester: crs.semester,
            isArchived: Boolean(crs.isArchived),
            studentId: createdAuthUid,
            studentName: cleanName,
            studentIndex: cleanIndex,
            studentDepartment: rosterDept,
            professorIds: crs.professorIds,
            isSeed: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      }
    } else if (isStaffRole && params.coursesToAssign && params.coursesToAssign.length > 0) {
      const staffProfileStub: UserProfile = {
        uid: createdAuthUid,
        fullName: cleanName,
        studentIndex: '',
        department: cleanDept,
        role: roleEnum,
        academicYear: cleanAcadYear,
        redeemedInviteId: provId,
        academicTitle: cleanTitle,
        officeLocation: cleanOffice,
        consultationHours: cleanConsult,
        isSeed: false,
      };
      for (const crs of params.coursesToAssign) {
        try {
          const crsEnrs = (params.allEnrollments ?? []).filter((e) => e.courseId === crs.id);
          const crsSched = (params.allScheduleEvents ?? []).filter((ev) => ev.courseId === crs.id);
          await adminAssignProfessorToCourse({
            course: crs,
            professor: staffProfileStub,
            makeLead: false,
            courseEnrollments: crsEnrs,
            courseScheduleEvents: crsSched,
          });
        } catch {
          // Non-blocking initial course assignment
        }
      }
    }
  }

  void mutateAdminIndex({
    addUserIds: createdAuthUid ? [createdAuthUid] : [],
    addProvisionedIds: [provId],
    addEnrollmentIds: createdEnrollmentIds,
  });

  return {
    uid: createdAuthUid,
    email: cleanEmail,
    password,
    role: params.role,
    fullName: cleanName,
    studentIndex: cleanIndex,
    studyTrack: cleanTrack,
    studyYear: cleanStudyYear,
    department: cleanDept,
    emailPasswordAuthActive,
  };
}

export async function adminUpdateUserAccount(params: {
  targetProfile: UserProfile;
  fullName: string;
  role: UserRole;
  studentIndex: string;
  department: string;
  studyTrack: string;
  studyYear: string;
  academicYear: string;
  academicTitle: string;
  officeLocation: string;
  consultationHours: string;
  phone?: string;
  userEnrollments?: Enrollment[];
}): Promise<void> {
  const { targetProfile, userEnrollments = [] } = params;
  const uid = targetProfile.uid;
  const prevIndex = targetProfile.studentIndex || '';

  const cleanName = sanitizeText(params.fullName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH);
  if (!cleanName) throw new Error('Ime i prezime je obavezno.');

  const cleanIndex = sanitizeText(
    params.studentIndex,
    VALIDATION_CONSTRAINTS.STUDENT_INDEX_MAX_LENGTH
  );
  if (cleanIndex && !VALIDATION_CONSTRAINTS.STUDENT_INDEX_PATTERN.test(cleanIndex)) {
    throw new Error('Broj indeksa smije sadržavati samo slova, brojeve i crtice.');
  }

  if (cleanIndex && cleanIndex !== prevIndex) {
    const existingSnap = await getDoc(doc(db, 'studentDirectory', cleanIndex));
    if (existingSnap.exists() && existingSnap.data().uid !== uid) {
      throw new Error(`Broj indeksa ${cleanIndex} je već zauzet.`);
    }
  }

  const cleanDept =
    sanitizeText(params.department, VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH) ||
    'Računarstvo i informatika';
  const cleanTrack = params.studyTrack
    ? sanitizeText(
        normalizeStudyTrack(params.studyTrack),
        VALIDATION_CONSTRAINTS.STUDY_TRACK_MAX_LENGTH
      )
    : '';
  const cleanStudyYear = sanitizeText(
    params.studyYear,
    VALIDATION_CONSTRAINTS.STUDY_YEAR_MAX_LENGTH
  );
  const cleanAcadYear =
    sanitizeText(params.academicYear, VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH) ||
    '2026/2027';

  try {
    await updateDoc(doc(db, 'userProfiles', uid), {
      fullName: cleanName,
      role: params.role,
      studentIndex: cleanIndex,
      department: cleanDept,
      studyTrack: cleanTrack,
      studyYear: cleanStudyYear,
      academicYear: cleanAcadYear,
      academicTitle: sanitizeText(
        params.academicTitle,
        VALIDATION_CONSTRAINTS.ACADEMIC_TITLE_MAX_LENGTH
      ),
      officeLocation: sanitizeText(
        params.officeLocation,
        VALIDATION_CONSTRAINTS.OFFICE_LOCATION_MAX_LENGTH
      ),
      consultationHours: sanitizeText(
        params.consultationHours,
        VALIDATION_CONSTRAINTS.CONSULTATION_HOURS_MAX_LENGTH
      ),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `userProfiles/${uid}`);
  }

  if (params.phone !== undefined) {
    const cleanPhone = sanitizeText(params.phone, VALIDATION_CONSTRAINTS.PHONE_MAX_LENGTH);
    try {
      const privRef = doc(db, 'userPrivate', uid);
      if ((await getDoc(privRef)).exists()) {
        await updateDoc(privRef, {
          phone: cleanPhone,
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Optional private update
    }
  }

  if (prevIndex && prevIndex !== cleanIndex) {
    try {
      const oldRef = doc(db, 'studentDirectory', prevIndex);
      const oldSnap = await getDoc(oldRef);
      if (oldSnap.exists() && oldSnap.data().uid === uid) {
        await deleteDoc(oldRef);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  const rosterDept =
    sanitizeText(
      formatStudentRosterProgramLabel(cleanDept, cleanTrack),
      VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH
    ) || cleanDept;

  if (cleanIndex) {
    const dirRef = doc(db, 'studentDirectory', cleanIndex);
    const snap = await getDoc(dirRef);
    if (!snap.exists()) {
      await setDoc(dirRef, {
        studentIndex: cleanIndex,
        uid,
        fullName: cleanName,
        department: rosterDept,
        isSeed: Boolean(targetProfile.isSeed),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (snap.data().uid === uid) {
      await updateDoc(dirRef, {
        fullName: cleanName,
        department: rosterDept,
        updatedAt: serverTimestamp(),
      });
    }
  }

  if (userEnrollments.length > 0 && cleanIndex) {
    await runParallelChunks(userEnrollments, 15, async (enr) => {
      try {
        await updateDoc(doc(db, 'enrollments', enr.id), {
          studentName: cleanName,
          studentIndex: cleanIndex,
          studentDepartment: rosterDept,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking sync
      }
    });
  }

  if (params.role === UserRole.ADMIN) {
    try {
      const admRef = doc(db, 'admins', uid);
      if (!(await getDoc(admRef)).exists()) {
        await setDoc(admRef, {
          uid,
          grantedBy: auth.currentUser?.uid || uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Non-blocking admin grant sync
    }
  }

  void mutateAdminIndex({ addUserIds: [uid] });
}

export async function adminEnrollStudentInCourse(params: {
  student: UserProfile;
  course: Course;
}): Promise<void> {
  const { student, course } = params;
  const cleanIdx = student.studentIndex || '00000';
  const rosterDept =
    sanitizeText(
      formatStudentRosterProgramLabel(student.department, student.studyTrack),
      VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH
    ) || student.department;
  const enrId = `${course.id}_${student.uid}`;

  try {
    await setDoc(doc(db, 'enrollments', enrId), {
      courseId: course.id,
      courseCode: course.code,
      courseName: course.name,
      leadProfessorName: course.leadProfessorName,
      academicYear: course.academicYear,
      semester: course.semester,
      isArchived: Boolean(course.isArchived),
      studentId: student.uid,
      studentName: student.fullName,
      studentIndex: cleanIdx,
      studentDepartment: rosterDept,
      professorIds: course.professorIds,
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    void mutateAdminIndex({ addEnrollmentIds: [enrId] });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `enrollments/${enrId}`);
  }
}

export interface PresentationAccountSpec {
  key: 'samir_admin' | 'samir_prof' | 'student_demo';
  label: string;
  email: string;
  password: string;
  fullName: string;
  role: 'admin' | 'professor' | 'student';
  academicTitle: string;
  department: string;
  officeLocation: string;
  consultationHours: string;
  studentIndex: string;
  studyTrack: string;
  studyYear: string;
  summary: string;
}

export const PRESENTATION_ACCOUNTS: readonly PresentationAccountSpec[] = [
  {
    key: 'samir_admin',
    label: 'Administrator (prof. Samir Ribić)',
    email: 'samir.admin@etf.unsa.ba',
    password: 'RibicAdmin2026!',
    fullName: 'Samir Ribić',
    role: 'admin',
    academicTitle: 'doc. dr.',
    department: 'Računarstvo i informatika',
    officeLocation: 'Kabinet 3-11, Kampus UNSA',
    consultationHours: 'Utorak i četvrtak 11:00–13:00',
    studentIndex: '',
    studyTrack: '',
    studyYear: '',
    summary: 'Puni pristup Administratorskoj konzoli (korisnici, predmeti, raspored, semestri, obavještenja)',
  },
  {
    key: 'samir_prof',
    label: 'Profesor (doc. dr. Samir Ribić)',
    email: 'sribic@etf.unsa.ba',
    password: 'RibicProf2026!',
    fullName: 'Samir Ribić',
    role: 'professor',
    academicTitle: 'doc. dr.',
    department: 'Računarstvo i informatika',
    officeLocation: 'Kabinet 3-11, Kampus UNSA',
    consultationHours: 'Utorak i četvrtak 11:00–13:00',
    studentIndex: '',
    studyTrack: '',
    studyYear: '',
    summary: 'Poseban profesorski nalog povezan sa predmetima Operativni sistemi (+ tačke) i Arhitektura računara',
  },
  {
    key: 'student_demo',
    label: 'Student (Vedad Selimović · 19384)',
    email: 'vselimovic1@etf.unsa.ba',
    password: 'Student2026!',
    fullName: 'Vedad Selimović',
    role: 'student',
    academicTitle: '',
    department: 'Računarstvo i informatika',
    officeLocation: '',
    consultationHours: '',
    studentIndex: '19384',
    studyTrack: 'Bachelor · Računarstvo i informatika',
    studyYear: 'II godina · I ciklus (Bachelor)',
    summary: 'Upisan na Operativne sisteme (2+ tačke), Arhitekturu računara, Tehnike programiranja i stare semestre',
  },
] as const;

export async function ensurePresentationLogins(params: {
  adminUid: string;
}): Promise<{
  emailPasswordAuthActive: boolean;
  resolvedUids: Record<string, string>;
}> {
  const { adminUid } = params;
  if (!adminUid) {
    return { emailPasswordAuthActive: false, resolvedUids: {} };
  }

  let emailPasswordAuthActive = true;
  const resolvedUids: Record<string, string> = {};
  const addedUserIds: string[] = [];
  const addedProvisionedIds: string[] = [];
  const addedEnrollmentIds: string[] = [];

  for (const spec of PRESENTATION_ACCOUNTS) {
    const provId = emailToProvisionId(spec.email);
    addedProvisionedIds.push(provId);

    let uid = '';
    try {
      const existingProvSnap = await getDoc(doc(db, 'provisionedAccounts', provId));
      if (existingProvSnap.exists()) {
        const pData = existingProvSnap.data() as ProvisionedAccount;
        if (pData.authUid && isValidResourceId(pData.authUid, 128)) {
          uid = pData.authUid;
        }
      }
    } catch {
      // Proceed to Auth resolution
    }

    if (!uid && emailPasswordAuthActive) {
      try {
        const cred = await createUserWithEmailAndPassword(
          secondaryAuth,
          spec.email,
          spec.password
        );
        uid = cred.user.uid;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === 'auth/email-already-in-use') {
          try {
            const signInCred = await signInWithEmailAndPassword(
              secondaryAuth,
              spec.email,
              spec.password
            );
            uid = signInCred.user.uid;
          } catch {
            // Existing account has custom changed password; keep existing profile if any
          }
        } else if (code === 'auth/operation-not-allowed') {
          emailPasswordAuthActive = false;
        }
      } finally {
        try {
          await firebaseSignOut(secondaryAuth);
        } catch {
          // Ignore secondary signout errors
        }
      }
    }

    try {
      const provRef = doc(db, 'provisionedAccounts', provId);
      const provSnap = await getDoc(provRef);
      if (!provSnap.exists()) {
        await setDoc(provRef, {
          targetEmail: spec.email,
          fullName: spec.fullName,
          role: spec.role,
          studentIndex: spec.studentIndex,
          department: spec.department,
          studyTrack: spec.studyTrack,
          studyYear: spec.studyYear,
          academicYear: '2026/2027',
          academicTitle: spec.academicTitle,
          officeLocation: spec.officeLocation,
          consultationHours: spec.consultationHours,
          authUid: uid,
          status: uid ? 'active' : 'pending',
          createdBy: adminUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (uid && (provSnap.data().authUid !== uid || provSnap.data().status !== 'active')) {
        await updateDoc(provRef, {
          fullName: spec.fullName,
          role: spec.role,
          studentIndex: spec.studentIndex,
          department: spec.department,
          studyTrack: spec.studyTrack,
          studyYear: spec.studyYear,
          academicYear: '2026/2027',
          academicTitle: spec.academicTitle,
          officeLocation: spec.officeLocation,
          consultationHours: spec.consultationHours,
          authUid: uid,
          status: 'active',
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Non-blocking provisioned record sync
    }

    if (!uid) continue;

    resolvedUids[spec.key] = uid;
    addedUserIds.push(uid);

    const roleEnum =
      spec.role === 'admin'
        ? UserRole.ADMIN
        : spec.role === 'professor'
          ? UserRole.PROFESSOR
          : UserRole.STUDENT;

    try {
      const profRef = doc(db, 'userProfiles', uid);
      const profSnap = await getDoc(profRef);
      if (!profSnap.exists()) {
        await setDoc(profRef, {
          uid,
          fullName: spec.fullName,
          studentIndex: spec.studentIndex,
          department: spec.department,
          role: roleEnum,
          academicYear: '2026/2027',
          redeemedInviteId: provId,
          academicTitle: spec.academicTitle,
          officeLocation: spec.officeLocation,
          consultationHours: spec.consultationHours,
          studyYear: spec.studyYear,
          studyTrack: spec.studyTrack,
          personalNote: '',
          provisionedByAdmin: true,
          notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
          isSeed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const curProf = profSnap.data() as UserProfile;
        if (!curProf.provisionedByAdmin || curProf.role !== roleEnum) {
          await updateDoc(profRef, {
            role: roleEnum,
            provisionedByAdmin: true,
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch {
      // Non-blocking profile sync
    }

    try {
      const privRef = doc(db, 'userPrivate', uid);
      const privSnap = await getDoc(privRef);
      if (!privSnap.exists()) {
        await setDoc(privRef, {
          uid,
          email: spec.email,
          phone: spec.role === 'student' ? '+387 61 482 910' : '+387 33 250 700',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Non-blocking private record sync
    }

    if (spec.role === 'admin') {
      try {
        const admRef = doc(db, 'admins', uid);
        if (!(await getDoc(admRef)).exists()) {
          await setDoc(admRef, {
            uid,
            grantedBy: adminUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Non-blocking admin grant sync
      }
    }

    if (spec.role === 'student' && spec.studentIndex) {
      try {
        const dirRef = doc(db, 'studentDirectory', spec.studentIndex);
        const dirSnap = await getDoc(dirRef);
        const rosterDept =
          sanitizeText(
            formatStudentRosterProgramLabel(spec.department, spec.studyTrack),
            VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH
          ) || spec.department;
        if (!dirSnap.exists()) {
          await setDoc(dirRef, {
            studentIndex: spec.studentIndex,
            uid,
            fullName: spec.fullName,
            department: rosterDept,
            isSeed: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Non-blocking directory sync
      }
    }
  }

  // Link Samir Ribić's Professor UID (and Admin UID on RI-OS) to ETF courses & child docs
  const samirProfUid = resolvedUids.samir_prof;
  const samirAdminUid = resolvedUids.samir_admin;
  if (samirProfUid || samirAdminUid) {
    const courseLinks: Array<{
      courseId: string;
      addProfUids: string[];
      makeSamirLeadDisplay: boolean;
      forceActivityMarks?: boolean;
    }> = [
      {
        courseId: 'seed_crs_os',
        addProfUids: [samirProfUid, samirAdminUid].filter(Boolean),
        makeSamirLeadDisplay: true,
        forceActivityMarks: true,
      },
      {
        courseId: 'seed_crs_ar',
        addProfUids: [samirProfUid].filter(Boolean),
        makeSamirLeadDisplay: false,
      },
    ];

    for (const link of courseLinks) {
      if (link.addProfUids.length === 0) continue;
      try {
        const cRef = doc(db, 'courses', link.courseId);
        const cSnap = await getDoc(cRef);
        if (!cSnap.exists()) continue;
        const cData = cSnap.data() as Course;
        const nextProfIds = Array.from(
          new Set([...(cData.professorIds ?? []), ...link.addProfUids])
        ).slice(0, VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE);

        const baseProfNames =
          cData.professorNames && cData.professorNames.length > 0
            ? cData.professorNames
            : [cData.leadProfessorName];
        const nextProfNames = sanitizeStaffList(
          link.makeSamirLeadDisplay
            ? ['doc. dr. Samir Ribić', ...baseProfNames]
            : [...baseProfNames, 'doc. dr. Samir Ribić'],
          VALIDATION_CONSTRAINTS.MAX_PROFESSORS_PER_COURSE
        );
        const nextLeadName = link.makeSamirLeadDisplay
          ? 'doc. dr. Samir Ribić'
          : cData.leadProfessorName;

        const idsChanged =
          nextProfIds.length !== cData.professorIds.length ||
          nextProfIds.some((id, idx) => cData.professorIds[idx] !== id);

        if (
          idsChanged ||
          cData.leadProfessorName !== nextLeadName ||
          (link.forceActivityMarks && !cData.activityMarksEnabled)
        ) {
          const patch: Record<string, unknown> = {
            leadProfessorName: nextLeadName,
            professorIds: nextProfIds,
            professorNames: nextProfNames,
            updatedAt: serverTimestamp(),
          };
          if (link.forceActivityMarks) {
            patch.activityMarksEnabled = true;
          }
          await updateDoc(cRef, patch);
        }

        const queryProfUid = cData.professorIds.includes(adminUid)
          ? adminUid
          : cData.leadProfessorId;
        if (queryProfUid) {
          await syncCourseProfessorIdsAcrossChildren({
            courseId: link.courseId,
            actorUid: queryProfUid,
            nextProfessorIds: nextProfIds,
            isAdminUser: true,
          });
        }
      } catch {
        // Non-blocking course linkage
      }
    }
  }

  // Enroll student Vedad Selimović (19384) and seed realistic scores, attendance & (+) marks
  const studentUid = resolvedUids.student_demo;
  if (studentUid) {
    const today = getTodayIsoLocal();
    const rosterDept = 'Bachelor · Računarstvo i informatika';
    const targetCourseIds = [
      'seed_crs_os',
      'seed_crs_ar',
      'seed_crs_tp',
      'seed_crs_im1',
      'seed_crs_uup',
    ];

    const loadedCourses: Record<string, Course> = {};
    await Promise.all(
      targetCourseIds.map(async (cid) => {
        try {
          const s = await getDoc(doc(db, 'courses', cid));
          if (s.exists()) {
            loadedCourses[cid] = { ...(s.data() as Omit<Course, 'id'>), id: s.id };
          }
        } catch {
          // Ignore missing seed course
        }
      })
    );

    // 1. Enrollments first (required by attendanceRecords, activityAwards, examRegistrations, finalGrades)
    for (const cid of targetCourseIds) {
      const crs = loadedCourses[cid];
      if (!crs) continue;
      const enrId = `${cid}_${studentUid}`;
      addedEnrollmentIds.push(enrId);
      try {
        const enrRef = doc(db, 'enrollments', enrId);
        if (!(await getDoc(enrRef)).exists()) {
          await setDoc(enrRef, {
            courseId: cid,
            courseCode: crs.code,
            courseName: crs.name,
            leadProfessorName: crs.leadProfessorName,
            academicYear: crs.academicYear,
            semester: crs.semester,
            isArchived: Boolean(crs.isArchived),
            studentId: studentUid,
            studentName: 'Vedad Selimović',
            studentIndex: '19384',
            studentDepartment: rosterDept,
            professorIds: crs.professorIds,
            isSeed: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Non-blocking enrollment seed
      }
    }

    // 2. Scores, (+) Activity Marks on Operativni sistemi, Attendance & Final Grades
    try {
      const osCrs = loadedCourses.seed_crs_os;
      if (osCrs) {
        const osScores = [
          {
            itemId: 'seed_itm_os_1',
            catId: 'seed_cat_os_lab',
            pts: 22,
            fb: 'Odlična sinhronizacija POSIX niti i rad sa semaforima.',
          },
          {
            itemId: 'seed_itm_os_2',
            catId: 'seed_cat_os_proj',
            pts: 21,
            fb: 'Uredan Linux kernel modul za znakovni uređaj.',
          },
        ];
        for (const sc of osScores) {
          const sRef = doc(db, 'scores', `${sc.itemId}_${studentUid}`);
          if (
            !(await getDoc(sRef)).exists() &&
            (await getDoc(doc(db, 'gradingItems', sc.itemId))).exists()
          ) {
            await setDoc(sRef, {
              courseId: 'seed_crs_os',
              categoryId: sc.catId,
              itemId: sc.itemId,
              studentId: studentUid,
              points: sc.pts,
              feedback: sc.fb,
              gradedBy: adminUid,
              professorIds: osCrs.professorIds,
              isSeed: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }

        const osPlusMarks = [
          {
            id: `pres_act_os_1_${studentUid}`,
            date: addDaysIso(today, -8),
            desc: 'Urađena vježba 1 — Sistemski pozivi i procesi (+)',
          },
          {
            id: `pres_act_os_2_${studentUid}`,
            date: addDaysIso(today, -2),
            desc: 'Urađena vježba 2 — POSIX niti i semafori (+)',
          },
        ];
        for (const pm of osPlusMarks) {
          const aRef = doc(db, 'activityAwards', pm.id);
          if (!(await getDoc(aRef)).exists()) {
            await setDoc(aRef, {
              courseId: 'seed_crs_os',
              studentId: studentUid,
              points: 0,
              maxPoints: 0,
              date: pm.date,
              description: pm.desc,
              awardedBy: adminUid,
              professorIds: osCrs.professorIds,
              isSeed: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }
      }

      const arCrs = loadedCourses.seed_crs_ar;
      if (arCrs) {
        const arScores = [
          { itemId: 'seed_itm_ar_1', catId: 'seed_cat_ar_zad', pts: 2 },
          { itemId: 'seed_itm_ar_2', catId: 'seed_cat_ar_zad', pts: 2 },
          { itemId: 'seed_itm_ar_3', catId: 'seed_cat_ar_zad', pts: 1.5 },
          { itemId: 'seed_itm_ar_6', catId: 'seed_cat_ar_vje', pts: 4.5 },
          { itemId: 'seed_itm_ar_7', catId: 'seed_cat_ar_vje', pts: 5 },
          { itemId: 'seed_itm_ar_8', catId: 'seed_cat_ar_p1', pts: 17.5 },
        ];
        for (const sc of arScores) {
          const sRef = doc(db, 'scores', `${sc.itemId}_${studentUid}`);
          if (
            !(await getDoc(sRef)).exists() &&
            (await getDoc(doc(db, 'gradingItems', sc.itemId))).exists()
          ) {
            await setDoc(sRef, {
              courseId: 'seed_crs_ar',
              categoryId: sc.catId,
              itemId: sc.itemId,
              studentId: studentUid,
              points: sc.pts,
              feedback: '',
              gradedBy: adminUid,
              professorIds: arCrs.professorIds,
              isSeed: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }

        const arSessionIds = [
          'seed_ses_ar_1',
          'seed_ses_ar_2',
          'seed_ses_ar_3',
          'seed_ses_ar_4',
          'seed_ses_ar_6',
          'seed_ses_ar_7',
        ];
        for (let i = 0; i < arSessionIds.length; i++) {
          const sesId = arSessionIds[i];
          const rRef = doc(db, 'attendanceRecords', `${sesId}_${studentUid}`);
          if (
            !(await getDoc(rRef)).exists() &&
            (await getDoc(doc(db, 'attendanceSessions', sesId))).exists()
          ) {
            await setDoc(rRef, {
              courseId: 'seed_crs_ar',
              sessionId: sesId,
              studentId: studentUid,
              present: i !== 3,
              note: '',
              markedBy: adminUid,
              professorIds: arCrs.professorIds,
              isSeed: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }

        const arTermSnap = await getDoc(doc(db, 'examTerms', 'seed_ext_ar_p2'));
        const arRegRef = doc(db, 'examRegistrations', `seed_ext_ar_p2_${studentUid}`);
        if (arTermSnap.exists() && !(await getDoc(arRegRef)).exists()) {
          const tData = arTermSnap.data() as ExamTerm;
          await setDoc(arRegRef, {
            termId: 'seed_ext_ar_p2',
            courseId: 'seed_crs_ar',
            courseCode: arCrs.code,
            courseName: arCrs.name,
            termTitle: tData.title,
            examDate: tData.examDate,
            studentId: studentUid,
            studentName: 'Vedad Selimović',
            studentIndex: '19384',
            studentDepartment: rosterDept,
            status: ExamRegistrationStatus.REGISTERED,
            professorIds: arCrs.professorIds,
            isSeed: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      const tpCrs = loadedCourses.seed_crs_tp;
      if (tpCrs) {
        const tpScores = [
          { itemId: 'seed_itm_tp_1', catId: 'seed_cat_tp_zad', pts: 9.5 },
          { itemId: 'seed_itm_tp_2', catId: 'seed_cat_tp_zad', pts: 9 },
          { itemId: 'seed_itm_tp_3', catId: 'seed_cat_tp_vje', pts: 9.5 },
          { itemId: 'seed_itm_tp_4', catId: 'seed_cat_tp_p1', pts: 18 },
          { itemId: 'seed_itm_tp_5', catId: 'seed_cat_tp_p2', pts: 16 },
          { itemId: 'seed_itm_tp_6', catId: 'seed_cat_tp_zav', pts: 16 },
        ];
        for (const sc of tpScores) {
          const sRef = doc(db, 'scores', `${sc.itemId}_${studentUid}`);
          if (
            !(await getDoc(sRef)).exists() &&
            (await getDoc(doc(db, 'gradingItems', sc.itemId))).exists()
          ) {
            await setDoc(sRef, {
              courseId: 'seed_crs_tp',
              categoryId: sc.catId,
              itemId: sc.itemId,
              studentId: studentUid,
              points: sc.pts,
              feedback: '',
              gradedBy: adminUid,
              professorIds: tpCrs.professorIds,
              isSeed: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }

        for (const sesId of [
          'seed_ses_tp_1',
          'seed_ses_tp_2',
          'seed_ses_tp_3',
          'seed_ses_tp_4',
          'seed_ses_tp_5',
        ]) {
          const rRef = doc(db, 'attendanceRecords', `${sesId}_${studentUid}`);
          if (
            !(await getDoc(rRef)).exists() &&
            (await getDoc(doc(db, 'attendanceSessions', sesId))).exists()
          ) {
            await setDoc(rRef, {
              courseId: 'seed_crs_tp',
              sessionId: sesId,
              studentId: studentUid,
              present: true,
              note: '',
              markedBy: adminUid,
              professorIds: tpCrs.professorIds,
              isSeed: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }

        const tpFgRef = doc(db, 'finalGrades', `seed_crs_tp_${studentUid}`);
        if (!(await getDoc(tpFgRef)).exists()) {
          await setDoc(tpFgRef, {
            courseId: 'seed_crs_tp',
            studentId: studentUid,
            totalPoints: 88,
            finalGrade: 9,
            status: FinalGradeStatus.FINALIZED,
            finalizedBy: adminUid,
            comment: 'Uspješno položene sve predispitne obaveze i završni ispit.',
            professorIds: tpCrs.professorIds,
            isSeed: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      // Archived 2025/2026 courses
      const archSpecs = [
        {
          cid: 'seed_crs_im1',
          catId: 'seed_cat_im1_isp',
          itemId: 'seed_itm_im1_zav',
          pts: 88,
          grade: 9,
        },
        {
          cid: 'seed_crs_uup',
          catId: 'seed_cat_uup_isp',
          itemId: 'seed_itm_uup_zav',
          pts: 96,
          grade: 10,
        },
      ];
      for (const ac of archSpecs) {
        const crs = loadedCourses[ac.cid];
        if (!crs) continue;
        const sRef = doc(db, 'scores', `${ac.itemId}_${studentUid}`);
        if (
          !(await getDoc(sRef)).exists() &&
          (await getDoc(doc(db, 'gradingItems', ac.itemId))).exists()
        ) {
          await setDoc(sRef, {
            courseId: ac.cid,
            categoryId: ac.catId,
            itemId: ac.itemId,
            studentId: studentUid,
            points: ac.pts,
            feedback: 'Položeno u akademskoj 2025/2026. godini.',
            gradedBy: adminUid,
            professorIds: crs.professorIds,
            isSeed: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        const fgRef = doc(db, 'finalGrades', `${ac.cid}_${studentUid}`);
        if (!(await getDoc(fgRef)).exists()) {
          await setDoc(fgRef, {
            courseId: ac.cid,
            studentId: studentUid,
            totalPoints: ac.pts,
            finalGrade: ac.grade,
            status: FinalGradeStatus.FINALIZED,
            finalizedBy: adminUid,
            comment: 'Zaključena ocjena iz akademske 2025/2026. godine.',
            professorIds: crs.professorIds,
            isSeed: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch {
      // Non-blocking student seed data
    }
  }

  // Ensure adminIndex/global includes all known IDs (and full collection IDs if Bootstrap Admin)
  if (isCurrentSessionBootstrapAdmin()) {
    try {
      const [uSnap, pSnap, cSnap, eSnap, sSnap, aSnap] = await Promise.all([
        getDocs(collection(db, 'userProfiles')),
        getDocs(collection(db, 'provisionedAccounts')),
        getDocs(collection(db, 'courses')),
        getDocs(collection(db, 'enrollments')),
        getDocs(collection(db, 'scheduleEvents')),
        getDocs(collection(db, 'announcements')),
      ]);
      adminIndexDraft.userIds = uSnap.docs.map((d) => d.id);
      adminIndexDraft.provisionedIds = pSnap.docs.map((d) => d.id);
      adminIndexDraft.courseIds = cSnap.docs.map((d) => d.id);
      adminIndexDraft.enrollmentIds = eSnap.docs.map((d) => d.id);
      adminIndexDraft.scheduleEventIds = sSnap.docs.map((d) => d.id);
      adminIndexDraft.announcementIds = aSnap.docs.map((d) => d.id);
      adminIndexLoadedSections.add('userIds');
      adminIndexLoadedSections.add('provisionedIds');
      adminIndexLoadedSections.add('courseIds');
      adminIndexLoadedSections.add('enrollmentIds');
      adminIndexLoadedSections.add('scheduleEventIds');
      adminIndexLoadedSections.add('announcementIds');
      scheduleBootstrapAdminIndexFlush();
    } catch {
      // Fallback to delta mutation
      await mutateAdminIndex({
        addUserIds: addedUserIds,
        addProvisionedIds: addedProvisionedIds,
        addEnrollmentIds: addedEnrollmentIds,
      });
    }
  } else {
    await mutateAdminIndex({
      addUserIds: addedUserIds,
      addProvisionedIds: addedProvisionedIds,
      addEnrollmentIds: addedEnrollmentIds,
    });
  }

  return { emailPasswordAuthActive, resolvedUids };
}

// ============================================================================
// Activity Awards (Bodovi za aktivnost) Mutations
// ============================================================================

export async function createActivityAward(params: {
  course: Course;
  studentId: string;
  points: number;
  maxPoints?: number;
  date: string;
  description: string;
  professorUid: string;
}): Promise<string> {
  const { course, studentId, points, maxPoints = 0, date, description, professorUid } = params;

  if (!isValidResourceId(studentId, VALIDATION_CONSTRAINTS.STUDENT_ID_MAX_LENGTH)) {
    throw new Error('Odaberite ispravnog studenta sa predmeta.');
  }

  const cleanDesc =
    sanitizeText(description, VALIDATION_CONSTRAINTS.ACTIVITY_DESC_MAX_LENGTH) ||
    'Urađena vježba (+)';
  const roundedPts = Math.round((points + Number.EPSILON) * 100) / 100;
  const roundedMax = Math.round((Math.max(0, maxPoints) + Number.EPSILON) * 100) / 100;

  const check = validateActivityAwardInput({
    points: roundedPts,
    maxPoints: roundedMax,
    date,
    description: cleanDesc,
    allowBonusPoints: course.allowBonusPoints,
  });
  if (!check.valid) {
    throw new Error(check.error || 'Neispravni podaci za evidenciju aktivnosti.');
  }

  const awardRef = doc(collection(db, 'activityAwards'));
  const awardId = awardRef.id;

  try {
    await setDoc(awardRef, {
      courseId: course.id,
      studentId,
      points: roundedPts,
      maxPoints: roundedMax,
      date,
      description: cleanDesc,
      awardedBy: professorUid,
      professorIds: buildCourseChildProfessorIds(course, professorUid),
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return awardId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `activityAwards/${awardId}`);
  }
}

export async function updateActivityAward(params: {
  awardId: string;
  course: Course;
  points: number;
  maxPoints?: number;
  date: string;
  description: string;
  professorUid: string;
}): Promise<void> {
  const { awardId, course, points, maxPoints = 0, date, description, professorUid } = params;

  const cleanDesc =
    sanitizeText(description, VALIDATION_CONSTRAINTS.ACTIVITY_DESC_MAX_LENGTH) ||
    'Urađena vježba (+)';
  const roundedPts = Math.round((points + Number.EPSILON) * 100) / 100;
  const roundedMax = Math.round((Math.max(0, maxPoints) + Number.EPSILON) * 100) / 100;

  const check = validateActivityAwardInput({
    points: roundedPts,
    maxPoints: roundedMax,
    date,
    description: cleanDesc,
    allowBonusPoints: course.allowBonusPoints,
  });
  if (!check.valid) {
    throw new Error(check.error || 'Neispravni podaci za evidenciju aktivnosti.');
  }

  try {
    await updateDoc(doc(db, 'activityAwards', awardId), {
      points: roundedPts,
      maxPoints: roundedMax,
      date,
      description: cleanDesc,
      awardedBy: professorUid,
      professorIds: buildCourseChildProfessorIds(course, professorUid),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `activityAwards/${awardId}`);
  }
}

export async function deleteActivityAward(awardId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'activityAwards', awardId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `activityAwards/${awardId}`);
  }
}


