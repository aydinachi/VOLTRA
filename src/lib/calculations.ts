import {
  ActivityAward,
  AttendanceRecord,
  AttendanceSession,
  Course,
  ExamTerm,
  FinalGrade,
  FinalGradeStatus,
  GradingCategory,
  GradingItem,
  Score,
} from '../types/zamio';

export type SessionAttendanceState = 'present' | 'absent' | 'unrecorded' | 'cancelled' | 'future';

export type ExamWindowState = 'open' | 'upcoming' | 'closed' | 'locked' | 'held';

export interface ExamWindowEvaluation {
  state: ExamWindowState;
  canRegisterOrCancel: boolean;
  label: string;
  daysRemaining: number | null;
}

export interface SessionBreakdownRow {
  session: AttendanceSession;
  state: SessionAttendanceState;
  note: string;
}

export interface AttendanceSummary {
  enabled: boolean;
  earnedPoints: number;
  maxPoints: number;
  heldCount: number;
  attendedCount: number;
  absentCount: number;
  unrecordedCount: number;
  cancelledCount: number;
  futureCount: number;
  percentage: number | null;
  sessions: SessionBreakdownRow[];
}

export interface ItemBreakdownRow {
  item: GradingItem;
  earnedPoints: number | null;
  maxPoints: number;
  feedback: string;
  graded: boolean;
}

export interface CategoryBreakdown {
  category: GradingCategory;
  earnedPoints: number;
  maxPoints: number;
  itemsMaxSum: number;
  percentage: number;
  items: ItemBreakdownRow[];
}

export interface ActivityAwardBreakdownRow {
  award: ActivityAward;
  effectivePoints: number;
}

export interface ActivitySummary {
  awards: ActivityAwardBreakdownRow[];
  earnedPoints: number;
  maxPoints: number;
  /** Non-null when awards are absorbed into an empty "Aktivnost" category so maxPoints aren't double-counted */
  linkedCategoryId: string | null;
}

export interface CourseStudentSummary {
  courseId: string;
  studentId: string;
  attendance: AttendanceSummary;
  categories: CategoryBreakdown[];
  activity: ActivitySummary;
  totalEarnedPoints: number;
  maxPossiblePoints: number;
  remainingAvailablePoints: number;
  pointsNeededToPass: number;
  percentageAchieved: number;
  suggestedGrade: number | null;
  passedThreshold: boolean;
  officialFinalGrade: FinalGrade | null;
  studentVisibleFinalGrade: number | null;
}

export function roundTo2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundTo1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function getTodayIsoLocal(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function diffDaysIso(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const fromUtc = Date.UTC(fy, (fm || 1) - 1, fd || 1);
  const toUtc = Date.UTC(ty, (tm || 1) - 1, td || 1);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/**
 * Evaluates whether a student can currently register or withdraw from an exam term
 * based on the professor's lock flag, registration open date, registration deadline,
 * and exam date.
 */
export function getExamWindowState(
  term: Pick<
    ExamTerm,
    'examDate' | 'registrationOpenDate' | 'registrationCloseDate' | 'isOpen'
  >,
  referenceDateIso: string = getTodayIsoLocal()
): ExamWindowEvaluation {
  if (referenceDateIso > term.examDate) {
    return {
      state: 'held',
      canRegisterOrCancel: false,
      label: 'Ispit održan',
      daysRemaining: null,
    };
  }

  if (!term.isOpen) {
    return {
      state: 'locked',
      canRegisterOrCancel: false,
      label: 'Prijave zaključane',
      daysRemaining: null,
    };
  }

  if (referenceDateIso < term.registrationOpenDate) {
    return {
      state: 'upcoming',
      canRegisterOrCancel: false,
      label: 'Prijava uskoro',
      daysRemaining: diffDaysIso(referenceDateIso, term.registrationOpenDate),
    };
  }

  if (referenceDateIso > term.registrationCloseDate) {
    return {
      state: 'closed',
      canRegisterOrCancel: false,
      label: 'Rok za prijavu istekao',
      daysRemaining: null,
    };
  }

  const remaining = diffDaysIso(referenceDateIso, term.registrationCloseDate);
  return {
    state: 'open',
    canRegisterOrCancel: true,
    label: remaining === 0 ? 'Prijave otvorene · ističe danas' : 'Prijave otvorene',
    daysRemaining: remaining,
  };
}

/**
 * Calculates attendance score and session breakdown for a student on a course.
 *
 * Formula:
 *   Attendance points = Maximum attendance points * Attended sessions / Held sessions
 *
 * Edge cases enforced:
 * - Disabled attendance: returns 0/0 without misleading deductions or percentages.
 * - Cancelled sessions: excluded from held sessions.
 * - Future sessions (session.date > referenceDateIso): excluded from held sessions.
 * - Zero held sessions: returns 0 earned points and 0% without division-by-zero (NaN).
 */
export function calculateAttendance(params: {
  attendanceEnabled: boolean;
  attendanceMaxPoints: number;
  sessions: AttendanceSession[];
  records: AttendanceRecord[];
  studentId: string;
  referenceDateIso?: string;
}): AttendanceSummary {
  const {
    attendanceEnabled,
    attendanceMaxPoints,
    sessions,
    records,
    studentId,
    referenceDateIso = getTodayIsoLocal(),
  } = params;

  const sortedSessions = [...sessions].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return a.time.localeCompare(b.time);
  });

  if (!attendanceEnabled) {
    return {
      enabled: false,
      earnedPoints: 0,
      maxPoints: 0,
      heldCount: 0,
      attendedCount: 0,
      absentCount: 0,
      unrecordedCount: 0,
      cancelledCount: 0,
      futureCount: 0,
      percentage: null,
      sessions: sortedSessions.map((session) => ({
        session,
        state: session.isCancelled
          ? 'cancelled'
          : session.date > referenceDateIso
            ? 'future'
            : 'unrecorded',
        note: '',
      })),
    };
  }

  const safeMaxPoints = Math.max(0, attendanceMaxPoints);

  // Deduplicate records by sessionId for the target student to prevent double counting
  const recordBySessionId = new Map<string, AttendanceRecord>();
  for (const record of records) {
    if (record.studentId === studentId) {
      recordBySessionId.set(record.sessionId, record);
    }
  }

  let heldCount = 0;
  let attendedCount = 0;
  let absentCount = 0;
  let unrecordedCount = 0;
  let cancelledCount = 0;
  let futureCount = 0;

  const rows: SessionBreakdownRow[] = sortedSessions.map((session) => {
    const rec = recordBySessionId.get(session.id);

    if (session.isCancelled) {
      cancelledCount += 1;
      return {
        session,
        state: 'cancelled',
        note: rec?.note ?? '',
      };
    }

    if (session.date > referenceDateIso) {
      futureCount += 1;
      return {
        session,
        state: 'future',
        note: rec?.note ?? '',
      };
    }

    heldCount += 1;
    if (!rec) {
      unrecordedCount += 1;
      return {
        session,
        state: 'unrecorded',
        note: '',
      };
    }

    if (rec.present) {
      attendedCount += 1;
      return {
        session,
        state: 'present',
        note: rec.note,
      };
    }

    absentCount += 1;
    return {
      session,
      state: 'absent',
      note: rec.note,
    };
  });

  const earnedPoints =
    heldCount === 0 ? 0 : roundTo2((safeMaxPoints * attendedCount) / heldCount);
  const percentage =
    heldCount === 0 ? 0 : roundTo1((attendedCount / heldCount) * 100);

  return {
    enabled: true,
    earnedPoints,
    maxPoints: safeMaxPoints,
    heldCount,
    attendedCount,
    absentCount,
    unrecordedCount,
    cancelledCount,
    futureCount,
    percentage,
    sessions: rows,
  };
}

/**
 * Computes suggested university grade (6-10) based on configurable course thresholds.
 * Returns null if totalPoints has not reached grade6Threshold.
 */
export function calculateSuggestedGrade(
  totalPoints: number,
  thresholds: Pick<
    Course,
    | 'grade6Threshold'
    | 'grade7Threshold'
    | 'grade8Threshold'
    | 'grade9Threshold'
    | 'grade10Threshold'
  >
): number | null {
  const pts = roundTo2(totalPoints);
  if (pts >= thresholds.grade10Threshold) return 10;
  if (pts >= thresholds.grade9Threshold) return 9;
  if (pts >= thresholds.grade8Threshold) return 8;
  if (pts >= thresholds.grade7Threshold) return 7;
  if (pts >= thresholds.grade6Threshold) return 6;
  return null;
}

/**
 * Centralized calculation of a student's complete academic standing in a course.
 * Ensures 100% consistency between Student and Professor dashboards and prevents
 * double counting of attendance or orphaned grading items.
 */
export function calculateCourseStudentSummary(params: {
  course: Course;
  categories: GradingCategory[];
  items: GradingItem[];
  scores: Score[];
  sessions: AttendanceSession[];
  attendanceRecords: AttendanceRecord[];
  activityAwards?: ActivityAward[];
  finalGradeRecord?: FinalGrade | null;
  studentId: string;
  referenceDateIso?: string;
}): CourseStudentSummary {
  const {
    course,
    categories,
    items,
    scores,
    sessions,
    attendanceRecords,
    activityAwards = [],
    finalGradeRecord = null,
    studentId,
    referenceDateIso = getTodayIsoLocal(),
  } = params;

  const courseCategories = [...categories]
    .filter((cat) => cat.courseId === course.id)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  // Deduplicate active items by item.id
  const activeItemMap = new Map<string, GradingItem>();
  for (const item of items) {
    if (item.courseId === course.id) {
      activeItemMap.set(item.id, item);
    }
  }

  // Deduplicate scores by itemId for this student, ignoring negative or orphaned scores
  const scoreByItemId = new Map<string, Score>();
  for (const score of scores) {
    if (score.courseId === course.id && score.studentId === studentId && activeItemMap.has(score.itemId)) {
      scoreByItemId.set(score.itemId, score);
    }
  }

  // Deduplicate activity awards by id for this course & student
  const awardMap = new Map<string, ActivityAward>();
  for (const aw of activityAwards) {
    if (aw.courseId === course.id && aw.studentId === studentId) {
      awardMap.set(aw.id, aw);
    }
  }
  const studentAwards = [...awardMap.values()].sort((a, b) => b.date.localeCompare(a.date));

  let rawActivityEarned = 0;
  let rawActivityMax = 0;
  const awardRows: ActivityAwardBreakdownRow[] = studentAwards.map((award) => {
    const safeMax = Math.max(0, award.maxPoints || 0);
    const effective = Math.max(
      0,
      safeMax > 0 && !course.allowBonusPoints
        ? Math.min(award.points, safeMax)
        : award.points
    );
    rawActivityEarned = roundTo2(rawActivityEarned + effective);
    rawActivityMax = roundTo2(rawActivityMax + safeMax);
    return {
      award,
      effectivePoints: roundTo2(effective),
    };
  });

  // Check if the course already defines an empty "Aktivnost" category so we don't double-count max points
  const emptyActivityCat = courseCategories.find((cat) => {
    const hasItems = [...activeItemMap.values()].some((it) => it.categoryId === cat.id);
    return !hasItems && /aktivnost|activity/i.test(cat.name);
  });
  const linkedActivityCategoryId =
    emptyActivityCat && awardRows.length > 0 ? emptyActivityCat.id : null;

  const attendance = calculateAttendance({
    attendanceEnabled: course.attendanceEnabled,
    attendanceMaxPoints: course.attendanceMaxPoints,
    sessions: sessions.filter((s) => s.courseId === course.id),
    records: attendanceRecords.filter((r) => r.courseId === course.id),
    studentId,
    referenceDateIso,
  });

  let remainingAssessmentPoints = 0;

  const categoryBreakdowns: CategoryBreakdown[] = courseCategories.map((category) => {
    const categoryItems = [...activeItemMap.values()]
      .filter((item) => item.categoryId === category.id)
      .sort((a, b) => a.order - b.order || a.date.localeCompare(b.date));

    let rawEarned = 0;
    let itemsMaxSum = 0;
    let ungradedItemsMaxSum = 0;

    const itemRows: ItemBreakdownRow[] = categoryItems.map((item) => {
      itemsMaxSum = roundTo2(itemsMaxSum + item.maxPoints);
      const score = scoreByItemId.get(item.id);
      if (!score) {
        ungradedItemsMaxSum = roundTo2(ungradedItemsMaxSum + Math.max(0, item.maxPoints));
        return {
          item,
          earnedPoints: null,
          maxPoints: item.maxPoints,
          feedback: '',
          graded: false,
        };
      }

      const sanitizedPoints = Math.max(
        0,
        course.allowBonusPoints ? score.points : Math.min(score.points, item.maxPoints)
      );
      rawEarned = roundTo2(rawEarned + sanitizedPoints);

      return {
        item,
        earnedPoints: roundTo2(sanitizedPoints),
        maxPoints: item.maxPoints,
        feedback: score.feedback,
        graded: true,
      };
    });

    const catMax = Math.max(0, category.maxPoints);

    if (linkedActivityCategoryId === category.id) {
      const cappedAct = course.allowBonusPoints
        ? rawActivityEarned
        : Math.min(rawActivityEarned, catMax);
      const actPct = catMax > 0 ? roundTo1((cappedAct / catMax) * 100) : 0;
      const unallocatedRoom = Math.max(0, roundTo2(catMax - cappedAct));
      remainingAssessmentPoints = roundTo2(remainingAssessmentPoints + unallocatedRoom);
      return {
        category,
        earnedPoints: roundTo2(cappedAct),
        maxPoints: catMax,
        itemsMaxSum: roundTo2(rawActivityMax),
        percentage: actPct,
        items: [],
      };
    }

    const cappedEarned = course.allowBonusPoints
      ? rawEarned
      : Math.min(rawEarned, catMax);

    // Remaining available points in this category: ungraded items + any unscheduled category points, capped by remaining category room when bonus is off
    const unscheduledCatPoints = Math.max(0, roundTo2(catMax - itemsMaxSum));
    const rawCatRemaining = roundTo2(ungradedItemsMaxSum + unscheduledCatPoints);
    const effectiveCatRemaining = course.allowBonusPoints
      ? rawCatRemaining
      : Math.min(rawCatRemaining, Math.max(0, roundTo2(catMax - cappedEarned)));
    remainingAssessmentPoints = roundTo2(remainingAssessmentPoints + effectiveCatRemaining);

    const catPct = catMax > 0 ? roundTo1((cappedEarned / catMax) * 100) : 0;

    return {
      category,
      earnedPoints: roundTo2(cappedEarned),
      maxPoints: catMax,
      itemsMaxSum: roundTo2(itemsMaxSum),
      percentage: catPct,
      items: itemRows,
    };
  });

  const standaloneActivityEarned = linkedActivityCategoryId ? 0 : roundTo2(rawActivityEarned);
  const standaloneActivityMax = linkedActivityCategoryId ? 0 : roundTo2(rawActivityMax);

  const activitySummary: ActivitySummary = {
    awards: awardRows,
    earnedPoints: linkedActivityCategoryId
      ? categoryBreakdowns.find((c) => c.category.id === linkedActivityCategoryId)?.earnedPoints ??
        roundTo2(rawActivityEarned)
      : standaloneActivityEarned,
    maxPoints: linkedActivityCategoryId
      ? categoryBreakdowns.find((c) => c.category.id === linkedActivityCategoryId)?.maxPoints ?? 0
      : standaloneActivityMax,
    linkedCategoryId: linkedActivityCategoryId,
  };

  const categoriesEarnedSum = categoryBreakdowns.reduce(
    (acc, c) => roundTo2(acc + c.earnedPoints),
    0
  );
  const categoriesMaxSum = categoryBreakdowns.reduce(
    (acc, c) => roundTo2(acc + c.maxPoints),
    0
  );

  const totalEarnedPoints = roundTo2(
    (course.attendanceEnabled ? attendance.earnedPoints : 0) +
      categoriesEarnedSum +
      standaloneActivityEarned
  );
  const maxPossiblePoints = roundTo2(
    (course.attendanceEnabled ? attendance.maxPoints : 0) +
      categoriesMaxSum +
      standaloneActivityMax
  );

  // If attendance has future/unrecorded sessions and hasn't been held yet, include potential remaining attendance points only if heldCount === 0
  const remainingAttendancePoints =
    course.attendanceEnabled && attendance.heldCount === 0 && attendance.futureCount > 0
      ? attendance.maxPoints
      : 0;
  const remainingAvailablePoints = roundTo2(
    remainingAssessmentPoints + remainingAttendancePoints
  );
  const pointsNeededToPass = Math.max(
    0,
    roundTo2(course.grade6Threshold - totalEarnedPoints)
  );

  const percentageAchieved =
    maxPossiblePoints > 0 ? roundTo1((totalEarnedPoints / maxPossiblePoints) * 100) : 0;

  const suggestedGrade = calculateSuggestedGrade(totalEarnedPoints, course);
  const passedThreshold = totalEarnedPoints >= course.grade6Threshold;

  // Student-visible final grade is NEVER invented before finalized by professor AND passing rules met
  let studentVisibleFinalGrade: number | null = null;
  if (
    finalGradeRecord &&
    finalGradeRecord.status === FinalGradeStatus.FINALIZED &&
    finalGradeRecord.finalGrade >= 6 &&
    passedThreshold
  ) {
    studentVisibleFinalGrade = finalGradeRecord.finalGrade;
  }

  return {
    courseId: course.id,
    studentId,
    attendance,
    categories: categoryBreakdowns,
    activity: activitySummary,
    totalEarnedPoints,
    maxPossiblePoints,
    remainingAvailablePoints,
    pointsNeededToPass,
    percentageAchieved,
    suggestedGrade,
    passedThreshold,
    officialFinalGrade: finalGradeRecord,
    studentVisibleFinalGrade,
  };
}

