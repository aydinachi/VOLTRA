import { describe, expect, it } from 'vitest';
import {
  calculateAttendance,
  calculateCourseStudentSummary,
  calculateSuggestedGrade,
  isCourseActivityEnabled,
} from './calculations';
import {
  AttendanceRecord,
  AttendanceSession,
  Course,
  FinalGradeStatus,
  GradingCategory,
  GradingItem,
  Score,
} from '../types/zamio';

const makeBaseCourse = (overrides: Partial<Course> = {}): Course => ({
  id: 'crs_ar',
  code: 'OR-AR',
  name: 'Arhitektura računara',
  semester: 'Zimski semestar · II godina',
  academicYear: '2026/2027',
  ects: 6,
  leadProfessorId: 'prof_1',
  leadProfessorName: 'dr. Samir Ribić, red. prof.',
  professorIds: ['prof_1'],
  categoryIds: ['cat_zadaci', 'cat_ispit'],
  itemIds: ['item_1', 'item_2', 'item_exam'],
  sessionIds: [],
  attendanceEnabled: true,
  attendanceMaxPoints: 10,
  allowBonusPoints: false,
  grade6Threshold: 55,
  grade7Threshold: 65,
  grade8Threshold: 75,
  grade9Threshold: 85,
  grade10Threshold: 95,
  isSeed: true,
  ...overrides,
});

describe('Zamio Centralized Calculations', () => {
  it('calculates proportional attendance points accurately (20 held, 16 attended = 8/10)', () => {
    const sessions: AttendanceSession[] = Array.from({ length: 20 }, (_, i) => ({
      id: `ses_${i + 1}`,
      courseId: 'crs_ar',
      date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      time: '09:00',
      topic: `Predavanje ${i + 1}`,
      isCancelled: false,
      professorIds: ['prof_1'],
      isSeed: true,
    }));

    const records: AttendanceRecord[] = sessions.map((s, idx) => ({
      id: `${s.id}_stu_1`,
      courseId: 'crs_ar',
      sessionId: s.id,
      studentId: 'stu_1',
      present: idx < 16, // 16 attended, 4 absent
      note: '',
      markedBy: 'prof_1',
      professorIds: ['prof_1'],
      isSeed: true,
    }));

    const res = calculateAttendance({
      attendanceEnabled: true,
      attendanceMaxPoints: 10,
      sessions,
      records,
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(res.heldCount).toBe(20);
    expect(res.attendedCount).toBe(16);
    expect(res.absentCount).toBe(4);
    expect(res.earnedPoints).toBe(8);
    expect(res.maxPoints).toBe(10);
    expect(res.percentage).toBe(80);
  });

  it('handles zero held sessions without division-by-zero errors', () => {
    const res = calculateAttendance({
      attendanceEnabled: true,
      attendanceMaxPoints: 10,
      sessions: [],
      records: [],
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(res.heldCount).toBe(0);
    expect(res.earnedPoints).toBe(0);
    expect(Number.isNaN(res.earnedPoints)).toBe(false);
    expect(res.percentage).toBe(0);
  });

  it('excludes cancelled and future sessions from attendance deductions', () => {
    const sessions: AttendanceSession[] = [
      {
        id: 'ses_held_1',
        courseId: 'crs_ar',
        date: '2026-10-01',
        time: '09:00',
        topic: 'Uvod',
        isCancelled: false,
        professorIds: ['prof_1'],
        isSeed: true,
      },
      {
        id: 'ses_cancelled',
        courseId: 'crs_ar',
        date: '2026-10-08',
        time: '09:00',
        topic: 'Otkazano predavanje',
        isCancelled: true,
        professorIds: ['prof_1'],
        isSeed: true,
      },
      {
        id: 'ses_future',
        courseId: 'crs_ar',
        date: '2026-12-15',
        time: '09:00',
        topic: 'Buduće predavanje',
        isCancelled: false,
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];

    const records: AttendanceRecord[] = [
      {
        id: 'ses_held_1_stu_1',
        courseId: 'crs_ar',
        sessionId: 'ses_held_1',
        studentId: 'stu_1',
        present: true,
        note: '',
        markedBy: 'prof_1',
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];

    const res = calculateAttendance({
      attendanceEnabled: true,
      attendanceMaxPoints: 10,
      sessions,
      records,
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(res.heldCount).toBe(1);
    expect(res.cancelledCount).toBe(1);
    expect(res.futureCount).toBe(1);
    expect(res.earnedPoints).toBe(10);
    expect(res.percentage).toBe(100);
  });

  it('does not deduct or count attendance points when attendanceEnabled is false', () => {
    const course = makeBaseCourse({ attendanceEnabled: false, attendanceMaxPoints: 10 });
    const categories: GradingCategory[] = [
      {
        id: 'cat_ispit',
        courseId: 'crs_ar',
        name: 'Završni ispit',
        maxPoints: 100,
        order: 1,
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];
    const items: GradingItem[] = [
      {
        id: 'item_exam',
        courseId: 'crs_ar',
        categoryId: 'cat_ispit',
        name: 'Integralni ispit',
        maxPoints: 100,
        date: '2026-10-20',
        description: '',
        order: 1,
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];
    const scores: Score[] = [
      {
        id: 'item_exam_stu_1',
        courseId: 'crs_ar',
        categoryId: 'cat_ispit',
        itemId: 'item_exam',
        studentId: 'stu_1',
        points: 78,
        feedback: 'Odličan rad',
        gradedBy: 'prof_1',
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];

    const summary = calculateCourseStudentSummary({
      course,
      categories,
      items,
      scores,
      sessions: [],
      attendanceRecords: [],
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(summary.attendance.enabled).toBe(false);
    expect(summary.attendance.maxPoints).toBe(0);
    expect(summary.maxPossiblePoints).toBe(100);
    expect(summary.totalEarnedPoints).toBe(78);
    expect(summary.suggestedGrade).toBe(8);
  });

  it('prevents double-counting orphaned scores and respects bonus point flag', () => {
    const course = makeBaseCourse({ allowBonusPoints: false });
    const categories: GradingCategory[] = [
      {
        id: 'cat_zadaci',
        courseId: 'crs_ar',
        name: 'Zadaci',
        maxPoints: 10,
        order: 1,
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];
    const items: GradingItem[] = [
      {
        id: 'item_1',
        courseId: 'crs_ar',
        categoryId: 'cat_zadaci',
        name: 'Logičke funkcije i kola',
        maxPoints: 5,
        date: '2026-10-10',
        description: '',
        order: 1,
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];
    const scores: Score[] = [
      {
        id: 'item_1_stu_1',
        courseId: 'crs_ar',
        categoryId: 'cat_zadaci',
        itemId: 'item_1',
        studentId: 'stu_1',
        points: 7, // exceeds maxPoints 5 while bonus disabled -> clamped to 5
        feedback: '',
        gradedBy: 'prof_1',
        professorIds: ['prof_1'],
        isSeed: true,
      },
      {
        id: 'deleted_item_stu_1',
        courseId: 'crs_ar',
        categoryId: 'cat_zadaci',
        itemId: 'deleted_item', // orphaned item -> must be ignored
        studentId: 'stu_1',
        points: 5,
        feedback: '',
        gradedBy: 'prof_1',
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];

    const summaryNoBonus = calculateCourseStudentSummary({
      course,
      categories,
      items,
      scores,
      sessions: [],
      attendanceRecords: [],
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(summaryNoBonus.categories[0].earnedPoints).toBe(5);
    expect(summaryNoBonus.totalEarnedPoints).toBe(5);

    const summaryWithBonus = calculateCourseStudentSummary({
      course: makeBaseCourse({ allowBonusPoints: true }),
      categories,
      items,
      scores,
      sessions: [],
      attendanceRecords: [],
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(summaryWithBonus.categories[0].earnedPoints).toBe(7);
  });

  it('never displays a student-visible final grade for draft grades or scores below threshold', () => {
    const course = makeBaseCourse();
    const categories: GradingCategory[] = [
      {
        id: 'cat_ispit',
        courseId: 'crs_ar',
        name: 'Ispiti',
        maxPoints: 90,
        order: 1,
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];
    const items: GradingItem[] = [
      {
        id: 'item_exam',
        courseId: 'crs_ar',
        categoryId: 'cat_ispit',
        name: 'Završni ispit',
        maxPoints: 90,
        date: '2026-10-20',
        description: '',
        order: 1,
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];
    const scores: Score[] = [
      {
        id: 'item_exam_stu_1',
        courseId: 'crs_ar',
        categoryId: 'cat_ispit',
        itemId: 'item_exam',
        studentId: 'stu_1',
        points: 86,
        feedback: '',
        gradedBy: 'prof_1',
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];

    const draftSummary = calculateCourseStudentSummary({
      course,
      categories,
      items,
      scores,
      sessions: [],
      attendanceRecords: [],
      finalGradeRecord: {
        id: 'crs_ar_stu_1',
        courseId: 'crs_ar',
        studentId: 'stu_1',
        totalPoints: 86,
        finalGrade: 9,
        status: FinalGradeStatus.DRAFT,
        finalizedBy: 'prof_1',
        comment: '',
        professorIds: ['prof_1'],
        isSeed: true,
      },
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(draftSummary.suggestedGrade).toBe(9);
    expect(draftSummary.studentVisibleFinalGrade).toBeNull();

    const finalizedSummary = calculateCourseStudentSummary({
      course,
      categories,
      items,
      scores,
      sessions: [],
      attendanceRecords: [],
      finalGradeRecord: {
        id: 'crs_ar_stu_1',
        courseId: 'crs_ar',
        studentId: 'stu_1',
        totalPoints: 86,
        finalGrade: 9,
        status: FinalGradeStatus.FINALIZED,
        finalizedBy: 'prof_1',
        comment: 'Čestitke',
        professorIds: ['prof_1'],
        isSeed: true,
      },
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(finalizedSummary.studentVisibleFinalGrade).toBe(9);
  });

  it('supports custom per-course grade thresholds accurately', () => {
    const customThresholds = {
      grade6Threshold: 50,
      grade7Threshold: 60,
      grade8Threshold: 70,
      grade9Threshold: 80,
      grade10Threshold: 90,
    };

    expect(calculateSuggestedGrade(49.99, customThresholds)).toBeNull();
    expect(calculateSuggestedGrade(50, customThresholds)).toBe(6);
    expect(calculateSuggestedGrade(64, customThresholds)).toBe(7);
    expect(calculateSuggestedGrade(75, customThresholds)).toBe(8);
    expect(calculateSuggestedGrade(82, customThresholds)).toBe(9);
    expect(calculateSuggestedGrade(90, customThresholds)).toBe(10);
  });

  it('evaluates exam registration window states accurately (open, upcoming, closed, locked, held)', async () => {
    const { addDaysIso, getExamWindowState } = await import('./calculations');

    expect(addDaysIso('2026-10-28', 5)).toBe('2026-11-02');
    expect(addDaysIso('2026-11-02', -5)).toBe('2026-10-28');

    const baseTerm = {
      registrationOpenDate: '2026-10-20',
      registrationCloseDate: '2026-10-27',
      examDate: '2026-10-30',
      isOpen: true,
    };

    // Upcoming before registrationOpenDate
    const upcoming = getExamWindowState(baseTerm, '2026-10-18');
    expect(upcoming.state).toBe('upcoming');
    expect(upcoming.canRegisterOrCancel).toBe(false);

    // Open inside window
    const open = getExamWindowState(baseTerm, '2026-10-24');
    expect(open.state).toBe('open');
    expect(open.canRegisterOrCancel).toBe(true);
    expect(open.daysRemaining).toBe(3);

    // Closed after registrationCloseDate but before examDate
    const closed = getExamWindowState(baseTerm, '2026-10-28');
    expect(closed.state).toBe('closed');
    expect(closed.canRegisterOrCancel).toBe(false);

    // Locked manually by professor during window
    const locked = getExamWindowState({ ...baseTerm, isOpen: false }, '2026-10-24');
    expect(locked.state).toBe('locked');
    expect(locked.canRegisterOrCancel).toBe(false);

    // Past exam date
    const held = getExamWindowState(baseTerm, '2026-11-01');
    expect(held.state).toBe('held');
    expect(held.canRegisterOrCancel).toBe(false);
  });

  it('includes Activity Points once without double-counting and computes remainingAvailablePoints accurately', () => {
    const course = makeBaseCourse({ attendanceEnabled: false });
    const categories: GradingCategory[] = [
      {
        id: 'cat_zadaci',
        courseId: 'crs_ar',
        name: 'Zadaci',
        maxPoints: 30,
        order: 1,
        professorIds: ['prof_1'],
        isSeed: true,
      },
      {
        id: 'cat_ispit',
        courseId: 'crs_ar',
        name: 'Ispiti',
        maxPoints: 60,
        order: 2,
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];
    const items: GradingItem[] = [
      {
        id: 'item_z1',
        courseId: 'crs_ar',
        categoryId: 'cat_zadaci',
        name: 'Zadaća 1',
        maxPoints: 15,
        date: '2026-10-10',
        description: '',
        order: 1,
        professorIds: ['prof_1'],
        isSeed: true,
      },
      {
        id: 'item_z2',
        courseId: 'crs_ar',
        categoryId: 'cat_zadaci',
        name: 'Zadaća 2',
        maxPoints: 15,
        date: '2026-11-10',
        description: '',
        order: 2,
        professorIds: ['prof_1'],
        isSeed: true,
      },
      {
        id: 'item_exam',
        courseId: 'crs_ar',
        categoryId: 'cat_ispit',
        name: 'Završni ispit',
        maxPoints: 60,
        date: '2026-12-20',
        description: '',
        order: 1,
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];
    const scores: Score[] = [
      {
        id: 'item_z1_stu_1',
        courseId: 'crs_ar',
        categoryId: 'cat_zadaci',
        itemId: 'item_z1',
        studentId: 'stu_1',
        points: 13,
        feedback: 'Odlično',
        gradedBy: 'prof_1',
        professorIds: ['prof_1'],
        isSeed: true,
      },
    ];

    const summaryStandalone = calculateCourseStudentSummary({
      course,
      categories,
      items,
      scores,
      sessions: [],
      attendanceRecords: [],
      activityAwards: [
        {
          id: 'act_1',
          courseId: 'crs_ar',
          studentId: 'stu_1',
          points: 4,
          maxPoints: 5,
          date: '2026-10-18',
          description: 'Rješavanje zadatka na tabli',
          awardedBy: 'prof_1',
          professorIds: ['prof_1'],
          isSeed: false,
        },
      ],
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    // 13 (Zadaća 1) + 4 (Activity) = 17 earned; 30 + 60 + 5 = 95 max; remaining = 15 (Zadaća 2) + 60 (Ispit) = 75
    expect(summaryStandalone.activity.earnedPoints).toBe(4);
    expect(summaryStandalone.activity.linkedCategoryId).toBeNull();
    expect(summaryStandalone.totalEarnedPoints).toBe(17);
    expect(summaryStandalone.maxPossiblePoints).toBe(95);
    expect(summaryStandalone.remainingAvailablePoints).toBe(75);
    expect(summaryStandalone.pointsNeededToPass).toBe(38);

    // When an empty "Aktivnost" category exists, activity points absorb into it without double counting maxPoints
    const summaryLinked = calculateCourseStudentSummary({
      course,
      categories: [
        ...categories,
        {
          id: 'cat_akt',
          courseId: 'crs_ar',
          name: 'Aktivnost na nastavi',
          maxPoints: 10,
          order: 3,
          professorIds: ['prof_1'],
          isSeed: true,
        },
      ],
      items,
      scores,
      sessions: [],
      attendanceRecords: [],
      activityAwards: [
        {
          id: 'act_1',
          courseId: 'crs_ar',
          studentId: 'stu_1',
          points: 4,
          maxPoints: 0,
          date: '2026-10-18',
          description: 'Aktivno učešće u diskusiji',
          awardedBy: 'prof_1',
          professorIds: ['prof_1'],
          isSeed: false,
        },
      ],
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(summaryLinked.activity.linkedCategoryId).toBe('cat_akt');
    expect(summaryLinked.totalEarnedPoints).toBe(17);
    expect(summaryLinked.maxPossiblePoints).toBe(100);
    // Remaining = 15 (Z2) + 60 (Ispit) + 6 (remaining room in 10pt Aktivnost category) = 81
    expect(summaryLinked.remainingAvailablePoints).toBe(81);
  });

  it('supports 0-point plus (+) activity marks (Samir Ribić workflow) and course-level activityMarksEnabled opt-in', () => {
    expect(isCourseActivityEnabled({ activityMarksEnabled: false }, 3)).toBe(false);
    expect(isCourseActivityEnabled({ activityMarksEnabled: undefined }, 0)).toBe(false);
    expect(isCourseActivityEnabled({ activityMarksEnabled: undefined }, 2)).toBe(true);
    expect(isCourseActivityEnabled({ activityMarksEnabled: true }, 0)).toBe(true);

    const osCourse = makeBaseCourse({
      id: 'seed_crs_os',
      code: 'RI-OS',
      name: 'Operativni sistemi',
      attendanceEnabled: false,
      activityMarksEnabled: true,
    });

    const summaryWithPluses = calculateCourseStudentSummary({
      course: osCourse,
      categories: [
        {
          id: 'cat_lab',
          courseId: 'seed_crs_os',
          name: 'Laboratorijske vježbe',
          maxPoints: 25,
          order: 1,
          professorIds: ['prof_1'],
          isSeed: true,
        },
      ],
      items: [],
      scores: [],
      sessions: [],
      attendanceRecords: [],
      activityAwards: [
        {
          id: 'plus_1',
          courseId: 'seed_crs_os',
          studentId: 'stu_1',
          points: 0,
          maxPoints: 0,
          date: '2026-10-12',
          description: 'Urađena vježba 2 (+)',
          awardedBy: 'prof_1',
          professorIds: ['prof_1'],
          isSeed: false,
        },
        {
          id: 'plus_2',
          courseId: 'seed_crs_os',
          studentId: 'stu_1',
          points: 0,
          maxPoints: 0,
          date: '2026-10-19',
          description: 'Urađena vježba 3 (+)',
          awardedBy: 'prof_1',
          professorIds: ['prof_1'],
          isSeed: false,
        },
      ],
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(summaryWithPluses.activity.enabled).toBe(true);
    expect(summaryWithPluses.activity.plusCount).toBe(2);
    expect(summaryWithPluses.activity.earnedPoints).toBe(0);
    expect(summaryWithPluses.totalEarnedPoints).toBe(0);

    const disabledCourse = { ...osCourse, activityMarksEnabled: false };
    const summaryDisabled = calculateCourseStudentSummary({
      course: disabledCourse,
      categories: [],
      items: [],
      scores: [],
      sessions: [],
      attendanceRecords: [],
      activityAwards: summaryWithPluses.activity.awards.map((r) => r.award),
      studentId: 'stu_1',
      referenceDateIso: '2026-10-23',
    });

    expect(summaryDisabled.activity.enabled).toBe(false);
    expect(summaryDisabled.activity.plusCount).toBe(0);
  });
});

