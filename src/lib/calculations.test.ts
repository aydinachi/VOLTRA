import { describe, expect, it } from 'vitest';
import {
  calculateAttendance,
  calculateCourseStudentSummary,
  calculateSuggestedGrade,
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
});
