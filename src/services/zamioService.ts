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
import { BOOTSTRAP_ADMIN_EMAIL, db, handleFirestoreError } from '../lib/firebase';
import {
  isValidIsoDate,
  isValidResourceId,
  sanitizeText,
  validateGradeThresholds,
  validateScoreInput,
  VALIDATION_CONSTRAINTS,
} from '../lib/validation';
import {
  AttendanceRecord,
  AttendanceSession,
  Course,
  Enrollment,
  FinalGrade,
  FinalGradeStatus,
  GradingCategory,
  GradingItem,
  Invitation,
  InvitationStatus,
  OperationType,
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

export async function ensureUserAccount(params: {
  uid: string;
  email: string;
  displayName: string;
}): Promise<{ profile: UserProfile; privateData: UserPrivate; isAdminUser: boolean }> {
  const { uid, email, displayName } = params;
  const profilePath = `userProfiles/${uid}`;
  const privatePath = `userPrivate/${uid}`;
  const adminPath = `admins/${uid}`;

  let isBootstrap = email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
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
    const defaultIndex = isAdminUser ? '19001' : '';
    const initialRole = isAdminUser ? UserRole.ADMIN : UserRole.STUDENT;

    const payload = {
      uid,
      fullName: cleanName,
      studentIndex: defaultIndex,
      department: 'Računarstvo i informatika',
      role: initialRole,
      academicYear: '2026/2027',
      redeemedInviteId: '',
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

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
      isSeed: false,
    };
  } else {
    const data = profileSnap.data() as UserProfile;
    profile = { ...data, uid };
  }

  let privateSnap;
  try {
    privateSnap = await getDoc(doc(db, 'userPrivate', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, privatePath);
  }

  const safeEmail = sanitizeText(email, VALIDATION_CONSTRAINTS.EMAIL_MAX_LENGTH);
  if (!privateSnap.exists()) {
    try {
      await setDoc(doc(db, 'userPrivate', uid), {
        uid,
        email: safeEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, privatePath);
    }
  }

  return {
    profile,
    privateData: { uid, email: safeEmail },
    isAdminUser: isAdminUser || profile.role === UserRole.ADMIN,
  };
}

export async function updateOwnProfile(
  uid: string,
  prevIndex: string,
  updates: {
    fullName: string;
    studentIndex: string;
    department: string;
    academicYear: string;
  }
): Promise<void> {
  const fullName = sanitizeText(updates.fullName, VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH);
  const studentIndex = sanitizeText(
    updates.studentIndex,
    VALIDATION_CONSTRAINTS.STUDENT_INDEX_MAX_LENGTH
  );
  const department = sanitizeText(
    updates.department,
    VALIDATION_CONSTRAINTS.DEPARTMENT_MAX_LENGTH
  );
  const academicYear = sanitizeText(
    updates.academicYear,
    VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH
  );

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

  try {
    await updateDoc(doc(db, 'userProfiles', uid), {
      fullName,
      studentIndex,
      department,
      academicYear,
      updatedAt: serverTimestamp(),
    });
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
    const dirRef = doc(db, 'studentDirectory', studentIndex);
    try {
      const snap = await getDoc(dirRef);
      if (!snap.exists()) {
        await setDoc(dirRef, {
          studentIndex,
          uid,
          fullName,
          department,
          isSeed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (snap.data().uid === uid) {
        await updateDoc(dirRef, {
          fullName,
          department,
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

export async function fetchCourseBundleByIds(courseId: string): Promise<{
  course: Course | null;
  categories: GradingCategory[];
  items: GradingItem[];
  sessions: AttendanceSession[];
}> {
  let courseSnap;
  try {
    courseSnap = await getDoc(doc(db, 'courses', courseId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `courses/${courseId}`);
  }

  if (!courseSnap.exists()) {
    return { course: null, categories: [], items: [], sessions: [] };
  }

  const course: Course = {
    ...(courseSnap.data() as Omit<Course, 'id'>),
    id: courseSnap.id,
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

  const categories: GradingCategory[] = catSnaps
    .filter((s) => s.exists())
    .map((s) => ({ ...(s.data() as Omit<GradingCategory, 'id'>), id: s.id }));

  const items: GradingItem[] = itemSnaps
    .filter((s) => s.exists())
    .map((s) => ({ ...(s.data() as Omit<GradingItem, 'id'>), id: s.id }));

  const sessions: AttendanceSession[] = sessionSnaps
    .filter((s) => s.exists())
    .map((s) => ({ ...(s.data() as Omit<AttendanceSession, 'id'>), id: s.id }));

  return { course, categories, items, sessions };
}

// ============================================================================
// Professor Subscriptions & Mutations
// ============================================================================

export function subscribeProfessorCourses(
  professorUid: string,
  onData: (courses: Course[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'courses'),
    where('professorIds', 'array-contains', professorUid)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<Course, 'id'>), id: d.id })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'courses')
  );
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

  return () => {
    for (const u of unsubs) u();
  };
}

export async function createCourse(params: {
  professorUid: string;
  professorName: string;
  code: string;
  name: string;
  semester: string;
  academicYear: string;
  ects: number;
  attendanceEnabled: boolean;
  attendanceMaxPoints: number;
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

  const courseId = makeEntityId('crs');

  // Create default ETF grading categories alongside the course
  const defaultCats = [
    { id: makeEntityId('cat'), name: 'Zadaci', maxPoints: 10, order: 1 },
    { id: makeEntityId('cat'), name: 'Vježbe', maxPoints: 10, order: 2 },
    { id: makeEntityId('cat'), name: 'I parcijalni ispit', maxPoints: 20, order: 3 },
    { id: makeEntityId('cat'), name: 'II parcijalni ispit', maxPoints: 20, order: 4 },
    { id: makeEntityId('cat'), name: 'Završni ispit', maxPoints: 30, order: 5 },
  ];

  const batch = writeBatch(db);
  batch.set(doc(db, 'courses', courseId), {
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
    leadProfessorName: sanitizeText(
      params.professorName,
      VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH
    ),
    professorIds: [params.professorUid],
    categoryIds: defaultCats.map((c) => c.id),
    itemIds: [],
    sessionIds: [],
    attendanceEnabled: params.attendanceEnabled,
    attendanceMaxPoints: params.attendanceEnabled
      ? Math.max(0, Math.min(100, Number(params.attendanceMaxPoints ?? 10)))
      : 0,
    allowBonusPoints: false,
    grade6Threshold: 55,
    grade7Threshold: 65,
    grade8Threshold: 75,
    grade9Threshold: 85,
    grade10Threshold: 95,
    isSeed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  for (const cat of defaultCats) {
    batch.set(doc(db, 'gradingCategories', cat.id), {
      courseId,
      name: cat.name,
      maxPoints: cat.maxPoints,
      order: cat.order,
      professorIds: [params.professorUid],
      isSeed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    return courseId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `courses/${courseId}`);
  }
}

export async function updateCourseSettings(
  courseId: string,
  updates: {
    name: string;
    semester: string;
    academicYear: string;
    ects: number;
    leadProfessorName: string;
    attendanceEnabled: boolean;
    attendanceMaxPoints: number;
    allowBonusPoints: boolean;
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

  try {
    await updateDoc(doc(db, 'courses', courseId), {
      name: sanitizeText(updates.name, VALIDATION_CONSTRAINTS.COURSE_NAME_MAX_LENGTH),
      semester: sanitizeText(updates.semester, VALIDATION_CONSTRAINTS.SEMESTER_MAX_LENGTH),
      academicYear: sanitizeText(
        updates.academicYear,
        VALIDATION_CONSTRAINTS.ACADEMIC_YEAR_MAX_LENGTH
      ),
      ects: Math.max(1, Math.min(30, Number(updates.ects))),
      leadProfessorName: sanitizeText(
        updates.leadProfessorName,
        VALIDATION_CONSTRAINTS.FULL_NAME_MAX_LENGTH
      ),
      attendanceEnabled: updates.attendanceEnabled,
      attendanceMaxPoints: Number(updates.attendanceMaxPoints),
      allowBonusPoints: updates.allowBonusPoints,
      grade6Threshold: Number(updates.grade6Threshold),
      grade7Threshold: Number(updates.grade7Threshold),
      grade8Threshold: Number(updates.grade8Threshold),
      grade9Threshold: Number(updates.grade9Threshold),
      grade10Threshold: Number(updates.grade10Threshold),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `courses/${courseId}`);
  }
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
      professorIds: params.course.professorIds,
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
  const batch = writeBatch(db);
  batch.set(doc(db, 'gradingCategories', categoryId), {
    courseId: params.course.id,
    name: cleanName,
    maxPoints: Number(params.maxPoints),
    order: Math.max(0, Math.min(50, Math.round(params.order))),
    professorIds: params.course.professorIds,
    isSeed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'courses', params.course.id), {
    categoryIds: [...params.course.categoryIds, categoryId],
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return categoryId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `gradingCategories/${categoryId}`);
  }
}

export async function updateGradingCategory(
  categoryId: string,
  professorIds: string[],
  updates: { name: string; maxPoints: number; order: number }
): Promise<void> {
  const cleanName = sanitizeText(updates.name, VALIDATION_CONSTRAINTS.CATEGORY_NAME_MAX_LENGTH);
  if (!cleanName) throw new Error('Naziv kategorije je obavezan.');

  try {
    await updateDoc(doc(db, 'gradingCategories', categoryId), {
      name: cleanName,
      maxPoints: Math.max(0, Math.min(100, Number(updates.maxPoints))),
      order: Math.max(0, Math.min(50, Math.round(updates.order))),
      professorIds,
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
  const batch = writeBatch(db);

  for (const sc of scoresInCategory) {
    batch.delete(doc(db, 'scores', sc.id));
  }
  for (const it of itemsInCategory) {
    batch.delete(doc(db, 'gradingItems', it.id));
  }
  batch.delete(doc(db, 'gradingCategories', categoryId));

  const nextCatIds = course.categoryIds.filter((id) => id !== categoryId);
  const nextItemIds = course.itemIds.filter((id) => !removedItemIds.has(id));

  if (removedItemIds.size > 0) {
    batch.update(doc(db, 'courses', course.id), {
      categoryIds: nextCatIds,
      itemIds: nextItemIds,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(doc(db, 'courses', course.id), {
      categoryIds: nextCatIds,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
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
  const batch = writeBatch(db);
  batch.set(doc(db, 'gradingItems', itemId), {
    courseId: params.course.id,
    categoryId: params.categoryId,
    name: cleanName,
    maxPoints: Number(params.maxPoints),
    date: params.date,
    description: sanitizeText(params.description, VALIDATION_CONSTRAINTS.DESCRIPTION_MAX_LENGTH),
    order: Math.max(0, Math.min(200, Math.round(params.order))),
    professorIds: params.course.professorIds,
    isSeed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'courses', params.course.id), {
    itemIds: [...params.course.itemIds, itemId],
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return itemId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `gradingItems/${itemId}`);
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

  try {
    await updateDoc(doc(db, 'gradingItems', itemId), {
      categoryId: updates.categoryId,
      name: cleanName,
      maxPoints: Number(updates.maxPoints),
      date: updates.date,
      description: sanitizeText(updates.description, VALIDATION_CONSTRAINTS.DESCRIPTION_MAX_LENGTH),
      order: Math.max(0, Math.min(200, Math.round(updates.order))),
      professorIds,
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
  const batch = writeBatch(db);
  for (const sc of itemScores) {
    batch.delete(doc(db, 'scores', sc.id));
  }
  batch.delete(doc(db, 'gradingItems', itemId));
  batch.update(doc(db, 'courses', course.id), {
    itemIds: course.itemIds.filter((id) => id !== itemId),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
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

  if (existingScore) {
    try {
      await updateDoc(doc(db, 'scores', scoreId), {
        points: Number(points),
        feedback: cleanFeedback,
        gradedBy: professorUid,
        professorIds: course.professorIds,
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
        professorIds: course.professorIds,
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
  const batch = writeBatch(db);

  batch.set(doc(db, 'attendanceSessions', sessionId), {
    courseId: course.id,
    date,
    time: sanitizeText(time, VALIDATION_CONSTRAINTS.SESSION_TIME_MAX_LENGTH),
    topic: sanitizeText(topic, VALIDATION_CONSTRAINTS.SESSION_TOPIC_MAX_LENGTH),
    isCancelled: false,
    professorIds: course.professorIds,
    isSeed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'courses', course.id), {
    sessionIds: [...course.sessionIds, sessionId],
    updatedAt: serverTimestamp(),
  });

  if (markAllPresent) {
    for (const enr of enrolledStudents) {
      const recordId = `${sessionId}_${enr.studentId}`;
      batch.set(doc(db, 'attendanceRecords', recordId), {
        courseId: course.id,
        sessionId,
        studentId: enr.studentId,
        present: true,
        note: '',
        markedBy: professorUid,
        professorIds: course.professorIds,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
    return sessionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `attendanceSessions/${sessionId}`);
  }
}

export async function updateAttendanceSession(
  session: AttendanceSession,
  updates: { date: string; time: string; topic: string; isCancelled: boolean }
): Promise<void> {
  if (!isValidIsoDate(updates.date)) {
    throw new Error('Unesite ispravan datum termina.');
  }
  try {
    await updateDoc(doc(db, 'attendanceSessions', session.id), {
      date: updates.date,
      time: sanitizeText(updates.time, VALIDATION_CONSTRAINTS.SESSION_TIME_MAX_LENGTH),
      topic: sanitizeText(updates.topic, VALIDATION_CONSTRAINTS.SESSION_TOPIC_MAX_LENGTH),
      isCancelled: updates.isCancelled,
      professorIds: session.professorIds,
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
  const batch = writeBatch(db);
  for (const r of sessionRecords) {
    batch.delete(doc(db, 'attendanceRecords', r.id));
  }
  batch.delete(doc(db, 'attendanceSessions', sessionId));
  batch.update(doc(db, 'courses', course.id), {
    sessionIds: course.sessionIds.filter((id) => id !== sessionId),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
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

  if (existingRecord) {
    try {
      await updateDoc(doc(db, 'attendanceRecords', recordId), {
        present,
        note: cleanNote,
        markedBy: professorUid,
        professorIds: course.professorIds,
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
        professorIds: course.professorIds,
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
  const batch = writeBatch(db);

  for (const enr of enrolledStudents) {
    const recordId = `${sessionId}_${enr.studentId}`;
    const existing = existingMap.get(enr.studentId);
    if (existing) {
      batch.update(doc(db, 'attendanceRecords', recordId), {
        present: true,
        note: existing.note,
        markedBy: professorUid,
        professorIds: course.professorIds,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(doc(db, 'attendanceRecords', recordId), {
        courseId: course.id,
        sessionId,
        studentId: enr.studentId,
        present: true,
        note: '',
        markedBy: professorUid,
        professorIds: course.professorIds,
        isSeed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `attendanceRecords/${sessionId}`);
  }
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

  if (existingGrade) {
    try {
      await updateDoc(doc(db, 'finalGrades', gradeId), {
        totalPoints: Number(totalPoints.toFixed(2)),
        finalGrade: Math.round(finalGrade),
        status,
        finalizedBy: professorUid,
        comment: cleanComment,
        professorIds: course.professorIds,
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
        professorIds: course.professorIds,
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
// Development Seed Data (isSeed: true — separated from production records)
// ============================================================================

export async function seedEtfDemoData(params: {
  adminUid: string;
  adminName: string;
  adminIndex: string;
}): Promise<void> {
  const { adminUid, adminName, adminIndex } = params;
  const effectiveIndex = adminIndex || '19001';

  // Ensure existing seed data isn't duplicated
  const existingAr = await getDoc(doc(db, 'courses', 'seed_crs_ar'));
  if (existingAr.exists()) {
    return;
  }

  const demoStudents = [
    { uid: 'seed_stu_haris', fullName: 'Haris Begović', index: '18942', dept: 'Računarstvo i informatika' },
    { uid: 'seed_stu_amila', fullName: 'Amila Kovačević', index: '19014', dept: 'Računarstvo i informatika' },
    { uid: 'seed_stu_tarik', fullName: 'Tarik Hadžić', index: '18877', dept: 'Automatika i elektronika' },
    { uid: 'seed_stu_lejla', fullName: 'Lejla Mujić', index: '19103', dept: 'Računarstvo i informatika' },
    { uid: 'seed_stu_mirza', fullName: 'Mirza Delić', index: '18765', dept: 'Telekomunikacije' },
  ];

  const allEnrolled = [
    { uid: adminUid, fullName: adminName, index: effectiveIndex, dept: 'Računarstvo i informatika' },
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

  // Batch 1: Profiles, Directory, Courses, Categories, Items, Sessions, Enrollments
  const batch1 = writeBatch(db);

  for (const stu of demoStudents) {
    batch1.set(doc(db, 'userProfiles', stu.uid), {
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
    });
    batch1.set(doc(db, 'studentDirectory', stu.index), {
      studentIndex: stu.index,
      uid: stu.uid,
      fullName: stu.fullName,
      department: stu.dept,
      isSeed: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch1.set(doc(db, 'courses', 'seed_crs_ar'), {
    code: 'OR-AR',
    name: 'Arhitektura računara',
    semester: 'Zimski semestar · II godina',
    academicYear: '2026/2027',
    ects: 6,
    leadProfessorId: adminUid,
    leadProfessorName: `dr. ${adminName}`,
    professorIds: [adminUid],
    categoryIds: arCatIds,
    itemIds: arItems.map((i) => i.id),
    sessionIds: arSessions.map((s) => s.id),
    attendanceEnabled: true,
    attendanceMaxPoints: 10,
    allowBonusPoints: false,
    grade6Threshold: 55,
    grade7Threshold: 65,
    grade8Threshold: 75,
    grade9Threshold: 85,
    grade10Threshold: 95,
    isSeed: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch1.set(doc(db, 'courses', 'seed_crs_tp'), {
    code: 'RI-TP',
    name: 'Tehnike programiranja',
    semester: 'Zimski semestar · I godina',
    academicYear: '2026/2027',
    ects: 7,
    leadProfessorId: adminUid,
    leadProfessorName: `dr. ${adminName}`,
    professorIds: [adminUid],
    categoryIds: tpCatIds,
    itemIds: tpItems.map((i) => i.id),
    sessionIds: tpSessions.map((s) => s.id),
    attendanceEnabled: true,
    attendanceMaxPoints: 10,
    allowBonusPoints: false,
    grade6Threshold: 55,
    grade7Threshold: 65,
    grade8Threshold: 75,
    grade9Threshold: 85,
    grade10Threshold: 95,
    isSeed: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch1.set(doc(db, 'courses', 'seed_crs_os'), {
    code: 'RI-OS',
    name: 'Operativni sistemi',
    semester: 'Ljetni semestar · II godina',
    academicYear: '2026/2027',
    ects: 5,
    leadProfessorId: adminUid,
    leadProfessorName: `dr. ${adminName}`,
    professorIds: [adminUid],
    categoryIds: osCatIds,
    itemIds: osItems.map((i) => i.id),
    sessionIds: [],
    attendanceEnabled: false,
    attendanceMaxPoints: 0,
    allowBonusPoints: false,
    grade6Threshold: 50,
    grade7Threshold: 62,
    grade8Threshold: 74,
    grade9Threshold: 85,
    grade10Threshold: 94,
    isSeed: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const arCategoriesMeta = [
    { id: 'seed_cat_ar_zad', name: 'Zadaci', max: 10, order: 1 },
    { id: 'seed_cat_ar_vje', name: 'Vježbe', max: 10, order: 2 },
    { id: 'seed_cat_ar_p1', name: 'I parcijalni ispit', max: 20, order: 3 },
    { id: 'seed_cat_ar_p2', name: 'II parcijalni ispit', max: 20, order: 4 },
    { id: 'seed_cat_ar_zav', name: 'Završni ispit', max: 20, order: 5 },
    { id: 'seed_cat_ar_ost', name: 'Ostalo / dodatna aktivnost', max: 10, order: 6 },
  ];
  for (const c of arCategoriesMeta) {
    batch1.set(doc(db, 'gradingCategories', c.id), {
      courseId: 'seed_crs_ar',
      name: c.name,
      maxPoints: c.max,
      order: c.order,
      professorIds: [adminUid],
      isSeed: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const tpCategoriesMeta = [
    { id: 'seed_cat_tp_zad', name: 'Zadaće', max: 20, order: 1 },
    { id: 'seed_cat_tp_vje', name: 'Vježbe', max: 10, order: 2 },
    { id: 'seed_cat_tp_p1', name: 'I parcijalni ispit', max: 20, order: 3 },
    { id: 'seed_cat_tp_p2', name: 'II parcijalni ispit', max: 20, order: 4 },
    { id: 'seed_cat_tp_zav', name: 'Završni ispit', max: 20, order: 5 },
  ];
  for (const c of tpCategoriesMeta) {
    batch1.set(doc(db, 'gradingCategories', c.id), {
      courseId: 'seed_crs_tp',
      name: c.name,
      maxPoints: c.max,
      order: c.order,
      professorIds: [adminUid],
      isSeed: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const osCategoriesMeta = [
    { id: 'seed_cat_os_lab', name: 'Laboratorijske vježbe', max: 25, order: 1 },
    { id: 'seed_cat_os_proj', name: 'Projektni zadatak', max: 25, order: 2 },
    { id: 'seed_cat_os_isp', name: 'Završni ispit', max: 50, order: 3 },
  ];
  for (const c of osCategoriesMeta) {
    batch1.set(doc(db, 'gradingCategories', c.id), {
      courseId: 'seed_crs_os',
      name: c.name,
      maxPoints: c.max,
      order: c.order,
      professorIds: [adminUid],
      isSeed: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const it of arItems) {
    batch1.set(doc(db, 'gradingItems', it.id), {
      courseId: 'seed_crs_ar',
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
    });
  }
  for (const it of tpItems) {
    batch1.set(doc(db, 'gradingItems', it.id), {
      courseId: 'seed_crs_tp',
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
    });
  }
  for (const it of osItems) {
    batch1.set(doc(db, 'gradingItems', it.id), {
      courseId: 'seed_crs_os',
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
    });
  }

  for (const ses of arSessions) {
    batch1.set(doc(db, 'attendanceSessions', ses.id), {
      courseId: 'seed_crs_ar',
      date: ses.date,
      time: ses.time,
      topic: ses.topic,
      isCancelled: ses.cancelled,
      professorIds: [adminUid],
      isSeed: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  for (const ses of tpSessions) {
    batch1.set(doc(db, 'attendanceSessions', ses.id), {
      courseId: 'seed_crs_tp',
      date: ses.date,
      time: ses.time,
      topic: ses.topic,
      isCancelled: ses.cancelled,
      professorIds: [adminUid],
      isSeed: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const courseMetaList = [
    { id: 'seed_crs_ar', code: 'OR-AR', name: 'Arhitektura računara' },
    { id: 'seed_crs_tp', code: 'RI-TP', name: 'Tehnike programiranja' },
    { id: 'seed_crs_os', code: 'RI-OS', name: 'Operativni sistemi' },
  ];
  for (const crs of courseMetaList) {
    for (const stu of allEnrolled) {
      batch1.set(doc(db, 'enrollments', `${crs.id}_${stu.uid}`), {
        courseId: crs.id,
        courseCode: crs.code,
        courseName: crs.name,
        leadProfessorName: `dr. ${adminName}`,
        academicYear: '2026/2027',
        studentId: stu.uid,
        studentName: stu.fullName,
        studentIndex: stu.index,
        studentDepartment: stu.dept,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch1.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seed_batch_1');
  }

  // Batch 2: Attendance records, student scores, and finalized/draft grades
  const batch2 = writeBatch(db);

  // Attendance for AR (5 held sessions: seed_ses_ar_1..4 and seed_ses_ar_6)
  const heldArIds = ['seed_ses_ar_1', 'seed_ses_ar_2', 'seed_ses_ar_3', 'seed_ses_ar_4', 'seed_ses_ar_6'];
  allEnrolled.forEach((stu, stuIdx) => {
    heldArIds.forEach((sesId, sesIdx) => {
      // Make realistic attendance patterns (e.g. 4/5 = 8/10b for first user, 5/5 = 10/10b for Amila, 3/5 = 6/10b for Mirza)
      const present =
        stuIdx === 1
          ? true
          : stuIdx === 5
            ? sesIdx < 3
            : !(sesIdx === 3 && stuIdx % 2 === 0);
      batch2.set(doc(db, 'attendanceRecords', `${sesId}_${stu.uid}`), {
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
      });
    });

    tpSessions.forEach((ses, sesIdx) => {
      const present = !(stuIdx === 3 && sesIdx === 2);
      batch2.set(doc(db, 'attendanceRecords', `${ses.id}_${stu.uid}`), {
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
      });
    });
  });

  // Scores for AR (In-progress semester: Zadaci 1-5, Vježbe 1-2, I parcijalni, Dodatni projekat graded; II parcijalni & Usmeni upcoming)
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
      batch2.set(doc(db, 'scores', `${tmpl.itemId}_${stu.uid}`), {
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
      });
    }
  });

  // Scores & Finalized Grades for TP
  const tpScoredTemplates = [
    { itemId: 'seed_itm_tp_1', catId: 'seed_cat_tp_zad', pts: [9.5, 10, 8.5, 7.5, 9, 6.5] },
    { itemId: 'seed_itm_tp_2', catId: 'seed_cat_tp_zad', pts: [9.0, 9.5, 8.0, 7.0, 8.5, 6.0] },
    { itemId: 'seed_itm_tp_3', catId: 'seed_cat_tp_vje', pts: [10, 10, 9, 8.5, 9.5, 7.5] },
    { itemId: 'seed_itm_tp_4', catId: 'seed_cat_tp_p1', pts: [18, 19.5, 16, 14.5, 17.5, 12] },
    { itemId: 'seed_itm_tp_5', catId: 'seed_cat_tp_p2', pts: [17.5, 19, 15.5, 14, 17, 11.5] },
    { itemId: 'seed_itm_tp_6', catId: 'seed_cat_tp_zav', pts: [18, 19, 15, 13.5, 17, 12] },
  ];

  const tpFinalMeta = [
    { total: 92, grade: 9, status: FinalGradeStatus.FINALIZED },
    { total: 97, grade: 10, status: FinalGradeStatus.FINALIZED },
    { total: 82, grade: 8, status: FinalGradeStatus.FINALIZED },
    { total: 73, grade: 7, status: FinalGradeStatus.FINALIZED },
    { total: 88.5, grade: 9, status: FinalGradeStatus.FINALIZED },
    { total: 65.5, grade: 7, status: FinalGradeStatus.DRAFT },
  ];

  allEnrolled.forEach((stu, idx) => {
    for (const tmpl of tpScoredTemplates) {
      batch2.set(doc(db, 'scores', `${tmpl.itemId}_${stu.uid}`), {
        courseId: 'seed_crs_tp',
        categoryId: tmpl.catId,
        itemId: tmpl.itemId,
        studentId: stu.uid,
        points: tmpl.pts[idx] ?? 8,
        feedback: idx === 0 && tmpl.itemId === 'seed_itm_tp_6' ? 'Čist i moderan C++ kod bez curenja memorije.' : '',
        gradedBy: adminUid,
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const fg = tpFinalMeta[idx];
    if (fg) {
      batch2.set(doc(db, 'finalGrades', `seed_crs_tp_${stu.uid}`), {
        courseId: 'seed_crs_tp',
        studentId: stu.uid,
        totalPoints: fg.total,
        finalGrade: fg.grade,
        status: fg.status,
        finalizedBy: adminUid,
        comment: fg.status === FinalGradeStatus.FINALIZED ? 'Uspješno položen predmet u septembarskom/oktobarskom roku.' : 'Nacrt ocjene prije upisa.',
        professorIds: [adminUid],
        isSeed: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });

  // Scores for OS
  allEnrolled.forEach((stu, idx) => {
    const pts1 = [23, 25, 20, 19, 22, 16][idx] ?? 20;
    const pts2 = [24, 24, 21, 18, 23, 17][idx] ?? 20;
    batch2.set(doc(db, 'scores', `seed_itm_os_1_${stu.uid}`), {
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
    });
    batch2.set(doc(db, 'scores', `seed_itm_os_2_${stu.uid}`), {
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
    });
  });

  try {
    await batch2.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seed_batch_2');
  }
}

export async function clearEtfDemoData(professorUid: string): Promise<number> {
  const collectionsToClean = [
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

    for (let i = 0; i < seedDocs.length; i += 400) {
      const chunk = seedDocs.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const docSnap of chunk) {
        batch.delete(docSnap.ref);
        deletedCount += 1;
      }
      await batch.commit();
    }
  }

  // Clean demo student profiles & directory entries (bootstrap admin allowed)
  try {
    const profSnap = await getDocs(query(collection(db, 'userProfiles'), where('isSeed', '==', true)));
    const dirSnap = await getDocs(query(collection(db, 'studentDirectory'), where('isSeed', '==', true)));
    const batch = writeBatch(db);
    profSnap.docs.forEach((d) => {
      batch.delete(d.ref);
      deletedCount += 1;
    });
    dirSnap.docs.forEach((d) => {
      batch.delete(d.ref);
      deletedCount += 1;
    });
    await batch.commit();
  } catch {
    // Non-bootstrap professor skips global profile cleanup
  }

  return deletedCount;
}
