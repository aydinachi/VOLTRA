import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowRight,
  ArrowUpDown,
  Award,
  BookOpen,
  Calendar,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  Info,
  MessageSquare,
  MinusCircle,
  Search,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  calculateCourseStudentSummary,
  CourseStudentSummary,
  getExamWindowState,
  getTodayIsoLocal,
} from '../../lib/calculations';
import { getCourseProgramCycle, StudyCycleKey } from '../../lib/programs';
import {
  cn,
  formatBosnianDate,
  formatCourseAssistants,
  formatCourseProfessors,
  formatPoints,
  getCourseAssistants,
  getCourseProfessors,
} from '../../lib/utils';
import {
  StudentCourseBundle,
  subscribeStudentAttendanceRecords,
  subscribeStudentEnrolledCourseLive,
  subscribeStudentEnrollments,
  subscribeStudentExamRegistrations,
  subscribeStudentFinalGrades,
  subscribeStudentScores,
} from '../../services/zamioService';
import {
  AttendanceRecord,
  AttendanceSession,
  Course,
  Enrollment,
  ExamRegistration,
  ExamRegistrationStatus,
  ExamTerm,
  FinalGrade,
  GradingCategory,
  GradingItem,
  ScheduleEvent,
  Score,
} from '../../types/zamio';
import { AnnouncementsView } from '../AnnouncementsView';
import { StudentNavKey } from '../AppShell';
import { ProfileView } from '../ProfileView';
import { ScheduleView } from '../ScheduleView';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Progress } from '../ui/progress';
import { StudentExamsView } from './StudentExamsView';

interface CourseBundle {
  course: Course;
  categories: GradingCategory[];
  items: GradingItem[];
  sessions: AttendanceSession[];
  examTerms: ExamTerm[];
  scheduleEvents: ScheduleEvent[];
}

interface StudentPortalProps {
  activeNav: StudentNavKey;
  onNavigate: (nav: StudentNavKey) => void;
}

export function StudentPortal({ activeNav, onNavigate }: StudentPortalProps) {
  const { profile } = useAuth();
  const studentUid = profile?.uid || '';

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [bundlesByCourseId, setBundlesByCourseId] = useState<Record<string, CourseBundle>>({});
  const [scores, setScores] = useState<Score[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [finalGrades, setFinalGrades] = useState<FinalGrade[]>([]);
  const [examRegistrations, setExamRegistrations] = useState<ExamRegistration[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [selectedHistoryCourseId, setSelectedHistoryCourseId] = useState<string>('');
  const [historyFilter, setHistoryFilter] = useState<'archived' | 'passed' | 'all_history'>(
    'all_history'
  );
  const [historyYearFilter, setHistoryYearFilter] = useState<string>('all');

  const [courseSearch, setCourseSearch] = useState('');
  const [programFilter, setProgramFilter] = useState<StudyCycleKey>('all');
  const [itemFilterCat, setItemFilterCat] = useState<string>('all');
  const [courseSortBy, setCourseSortBy] = useState<'name' | 'points' | 'pct'>('name');

  useEffect(() => {
    if (!studentUid) return;
    setLoading(true);

    const unsubEnroll = subscribeStudentEnrollments(studentUid, (rows) => {
      const sorted = [...rows].sort((a, b) => a.courseCode.localeCompare(b.courseCode, 'bs'));
      setEnrollments(sorted);
      if (sorted.length === 0) {
        setLoading(false);
      }
    });
    const unsubScores = subscribeStudentScores(studentUid, setScores);
    const unsubAtt = subscribeStudentAttendanceRecords(studentUid, setAttendanceRecords);
    const unsubGrades = subscribeStudentFinalGrades(studentUid, setFinalGrades);
    const unsubExamRegs = subscribeStudentExamRegistrations(studentUid, setExamRegistrations);

    return () => {
      unsubEnroll();
      unsubScores();
      unsubAtt();
      unsubGrades();
      unsubExamRegs();
    };
  }, [studentUid]);

  // Live subscriptions to each enrolled course, its exam terms & schedule events
  const enrolledCourseKey = useMemo(
    () => enrollments.map((e) => e.courseId).sort().join(','),
    [enrollments]
  );

  useEffect(() => {
    if (!enrolledCourseKey) {
      setBundlesByCourseId({});
      return;
    }

    const courseIds = enrolledCourseKey.split(',').filter(Boolean);
    const loadedSet = new Set<string>();

    const unsubs = courseIds.map((courseId) =>
      subscribeStudentEnrolledCourseLive(courseId, (bundle: StudentCourseBundle) => {
        loadedSet.add(courseId);
        setBundlesByCourseId((prev) => {
          const next = { ...prev };
          if (bundle.course) {
            next[courseId] = {
              course: bundle.course,
              categories: bundle.categories,
              items: bundle.items,
              sessions: bundle.sessions,
              examTerms: bundle.examTerms,
              scheduleEvents: bundle.scheduleEvents ?? [],
            };
          } else {
            delete next[courseId];
          }
          return next;
        });

        if (loadedSet.size >= courseIds.length) {
          setLoading(false);
        }
      })
    );

    return () => {
      for (const u of unsubs) u();
    };
  }, [enrolledCourseKey]);

  const activeEnrollments = useMemo(
    () =>
      enrollments.filter((enr) => {
        const crs = bundlesByCourseId[enr.courseId]?.course;
        return !enr.isArchived && !crs?.isArchived;
      }),
    [enrollments, bundlesByCourseId]
  );

  const archivedEnrollments = useMemo(
    () =>
      enrollments.filter((enr) => {
        const crs = bundlesByCourseId[enr.courseId]?.course;
        return Boolean(enr.isArchived || crs?.isArchived);
      }),
    [enrollments, bundlesByCourseId]
  );

  // Keep selectedCourseId synced to active enrollments
  useEffect(() => {
    setSelectedCourseId((prev) => {
      if (prev && activeEnrollments.some((e) => e.courseId === prev)) {
        return prev;
      }
      return activeEnrollments[0]?.courseId || '';
    });
  }, [activeEnrollments]);

  const summariesByCourseId = useMemo(() => {
    const map: Record<string, CourseStudentSummary> = {};
    for (const enr of enrollments) {
      const bundle = bundlesByCourseId[enr.courseId];
      if (!bundle) continue;
      const fg = finalGrades.find((g) => g.courseId === enr.courseId) || null;
      map[enr.courseId] = calculateCourseStudentSummary({
        course: bundle.course,
        categories: bundle.categories,
        items: bundle.items,
        scores,
        sessions: bundle.sessions,
        attendanceRecords,
        finalGradeRecord: fg,
        studentId: studentUid,
      });
    }
    return map;
  }, [enrollments, bundlesByCourseId, scores, attendanceRecords, finalGrades, studentUid]);

  // Historical / Passed enrollments for "Stari semestri i položeni predmeti"
  const historicalEnrollments = useMemo(() => {
    return enrollments
      .filter((enr) => {
        const crs = bundlesByCourseId[enr.courseId]?.course;
        const isArch = Boolean(enr.isArchived || crs?.isArchived);
        const sum = summariesByCourseId[enr.courseId];
        const isPassed =
          sum?.studentVisibleFinalGrade !== null &&
          sum?.studentVisibleFinalGrade !== undefined &&
          sum.studentVisibleFinalGrade >= 6;
        return isArch || isPassed;
      })
      .sort((a, b) => {
        const yearCmp = (b.academicYear || '').localeCompare(a.academicYear || '');
        if (yearCmp !== 0) return yearCmp;
        return a.courseCode.localeCompare(b.courseCode, 'bs');
      });
  }, [enrollments, bundlesByCourseId, summariesByCourseId]);

  useEffect(() => {
    setSelectedHistoryCourseId((prev) => {
      if (prev && historicalEnrollments.some((e) => e.courseId === prev)) {
        return prev;
      }
      return historicalEnrollments[0]?.courseId || '';
    });
  }, [historicalEnrollments]);

  const activeExamTerms = useMemo(() => {
    const list: ExamTerm[] = [];
    for (const enr of activeEnrollments) {
      const bundle = bundlesByCourseId[enr.courseId];
      if (bundle?.examTerms) {
        list.push(...bundle.examTerms);
      }
    }
    return list;
  }, [activeEnrollments, bundlesByCourseId]);

  const activeCoursesById = useMemo(() => {
    const map: Record<string, Course> = {};
    for (const enr of activeEnrollments) {
      const bundle = bundlesByCourseId[enr.courseId];
      if (bundle?.course) {
        map[enr.courseId] = bundle.course;
      }
    }
    return map;
  }, [activeEnrollments, bundlesByCourseId]);

  const activeCoursesList = useMemo(
    () => Object.values(activeCoursesById),
    [activeCoursesById]
  );

  const activeScheduleEvents = useMemo(() => {
    const list: ScheduleEvent[] = [];
    for (const enr of activeEnrollments) {
      const bundle = bundlesByCourseId[enr.courseId];
      if (bundle?.scheduleEvents) {
        list.push(...bundle.scheduleEvents);
      }
    }
    return list;
  }, [activeEnrollments, bundlesByCourseId]);

  const activeGradingItems = useMemo(() => {
    const list: GradingItem[] = [];
    for (const enr of activeEnrollments) {
      const bundle = bundlesByCourseId[enr.courseId];
      if (bundle?.items) {
        list.push(...bundle.items);
      }
    }
    return list;
  }, [activeEnrollments, bundlesByCourseId]);

  const todayIso = getTodayIsoLocal();

  const openExamStats = useMemo(() => {
    const openTerms = activeExamTerms.filter(
      (t) => getExamWindowState(t, todayIso).state === 'open'
    );
    const regMap = new Map(examRegistrations.map((r) => [r.termId, r]));
    const unansweredOpen = openTerms.filter((t) => !regMap.has(t.id));
    const registeredOpen = openTerms.filter(
      (t) => regMap.get(t.id)?.status === ExamRegistrationStatus.REGISTERED
    );
    return {
      openCount: openTerms.length,
      unansweredCount: unansweredOpen.length,
      registeredCount: registeredOpen.length,
      firstOpenTerm: unansweredOpen[0] || openTerms[0] || null,
    };
  }, [activeExamTerms, examRegistrations, todayIso]);

  if (activeNav === 'profil') {
    return <ProfileView />;
  }

  if (activeNav === 'obavjestenja') {
    return <AnnouncementsView viewerMode="student" canManage={false} />;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />
          <div className="lg:col-span-4 h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  // Reusable Zamger-inspired Grade Breakdown Component (supports both active & archived courses)
  const renderCourseBreakdown = (
    targetBundle?: CourseBundle,
    targetSummary?: CourseStudentSummary,
    isReadOnlyArchive = false
  ) => {
    if (!targetBundle || !targetSummary) return null;
    const { course } = targetBundle;
    const {
      attendance,
      categories,
      totalEarnedPoints,
      maxPossiblePoints,
      percentageAchieved,
      studentVisibleFinalGrade,
      passedThreshold,
    } = targetSummary;

    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Columns: Structured Grade Table (Attendance -> Categories -> Items -> Total) */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-0.5">
                <span className="font-mono font-semibold text-blue-700">{course.code}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{course.academicYear}</span>
                <span aria-hidden="true">·</span>
                <span>{course.semester}</span>
                {isReadOnlyArchive && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-700">Arhivirana evidencija</span>
                  </>
                )}
              </div>
              <h2 className="text-base font-semibold text-slate-900">
                Struktura bodova — {course.name}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Prag za prolaz:{' '}
                <span className="font-mono font-semibold text-slate-700 tabular-nums">
                  {course.grade6Threshold}
                </span>{' '}
                bodova · Maksimalno:{' '}
                <span className="font-mono font-semibold text-slate-700 tabular-nums">
                  {formatPoints(maxPossiblePoints)}
                </span>{' '}
                bodova
              </p>
            </div>
            {!isReadOnlyArchive && (
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('prisustvo')}
                  className="text-blue-700 hover:text-blue-800"
                >
                  Detalji prisustva
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="text-left py-2.5 px-4">Kategorija / Stavka</th>
                  <th className="text-right py-2.5 px-4 whitespace-nowrap">Osvojeno</th>
                  <th className="text-right py-2.5 px-4 whitespace-nowrap">Maksimum</th>
                  <th className="text-left py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* 1. Prisustvo First */}
                {course.attendanceEnabled ? (
                  <tr className="bg-slate-50/60">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">1. Prisustvo nastavi</div>
                      <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                        Prisustvovao: {attendance.attendedCount}/{attendance.heldCount} održanih termina
                        {attendance.absentCount > 0 ? ` · Izostanci: ${attendance.absentCount}` : ''}
                        {attendance.percentage !== null ? ` (${attendance.percentage}%)` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatPoints(attendance.earnedPoints)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums">
                      {formatPoints(attendance.maxPoints)}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {attendance.heldCount === 0 ? (
                        <span className="text-slate-500">Nema održanih termina</span>
                      ) : (attendance.percentage ?? 0) >= 70 ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          Uredno prisustvo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-red-700 font-medium">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Povećan broj izostanaka
                        </span>
                      )}
                    </td>
                  </tr>
                ) : (
                  <tr className="bg-slate-50/40">
                    <td className="py-2.5 px-4 text-xs text-slate-500" colSpan={4}>
                      <span className="inline-flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        Prisustvo se ne boduje na ovom predmetu — bodovi se ne oduzimaju.
                      </span>
                    </td>
                  </tr>
                )}

                {/* 2..N. Configurable Categories & Individual Items */}
                {categories.map((catBreakdown, idx) => {
                  const sectionNumber = course.attendanceEnabled ? idx + 2 : idx + 1;
                  return (
                    <React.Fragment key={catBreakdown.category.id}>
                      <tr className="bg-slate-50/60">
                        <td className="py-2.5 px-4 font-semibold text-slate-900">
                          {sectionNumber}. {catBreakdown.category.name}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {formatPoints(catBreakdown.earnedPoints)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-slate-500 tabular-nums">
                          {formatPoints(catBreakdown.maxPoints)}
                        </td>
                        <td className="py-2.5 px-4 text-xs font-mono text-slate-600 tabular-nums">
                          {catBreakdown.percentage}% kategorije
                        </td>
                      </tr>

                      {catBreakdown.items.length === 0 ? (
                        <tr>
                          <td className="py-2 px-4 pl-8 text-xs text-slate-400 italic" colSpan={4}>
                            Nema unesenih stavki u ovoj kategoriji.
                          </td>
                        </tr>
                      ) : (
                        catBreakdown.items.map((row) => (
                          <tr
                            key={row.item.id}
                            className="hover:bg-slate-50/80 transition-colors"
                          >
                            <td className="py-2.5 px-4 pl-8">
                              <div className="text-slate-800 font-medium">{row.item.name}</div>
                              <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                                <span className="font-mono tabular-nums">
                                  {formatBosnianDate(row.item.date)}
                                </span>
                                {row.feedback && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="inline-flex items-center gap-1 text-blue-700">
                                      <MessageSquare className="w-3 h-3 shrink-0" />
                                      {row.feedback}
                                    </span>
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900">
                              {row.graded ? formatPoints(row.earnedPoints) : '—'}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                              {formatPoints(row.maxPoints)}
                            </td>
                            <td className="py-2.5 px-4 text-xs">
                              {!row.graded ? (
                                <span className="text-slate-400">Nije ocijenjeno</span>
                              ) : (row.earnedPoints ?? 0) >= row.maxPoints * 0.5 ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  Upisano
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-700">
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                  Upisano
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </React.Fragment>
                  );
                })}

                {/* Ukupno bodova Row */}
                <tr className="bg-slate-900 text-white font-semibold">
                  <td className="py-3.5 px-4">Ukupno bodova</td>
                  <td className="py-3.5 px-4 text-right font-mono text-base tabular-nums">
                    {formatPoints(totalEarnedPoints)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-300 tabular-nums">
                    {formatPoints(maxPossiblePoints)}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-200 tabular-nums">
                    {percentageAchieved}% ostvareno
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Right 4 Columns: Single-Elevation Final Grade & Progress Panel */}
        <div className="lg:col-span-4 space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-slate-500">Konačna ocjena</div>
                <div className="mt-1 text-sm text-slate-700">
                  {studentVisibleFinalGrade !== null ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                      <Award className="w-4 h-4 shrink-0" />
                      Ocjena zaključena
                    </span>
                  ) : (
                    <span className="text-slate-600">Ocjena još nije zaključena</span>
                  )}
                </div>
              </div>

              <div
                className={cn(
                  'font-mono text-4xl font-bold tabular-nums shrink-0',
                  studentVisibleFinalGrade !== null ? 'text-emerald-700' : 'text-slate-300'
                )}
              >
                {studentVisibleFinalGrade !== null ? studentVisibleFinalGrade : '—'}
              </div>
            </div>

            {targetSummary.officialFinalGrade?.status === 'finalized' &&
              targetSummary.officialFinalGrade.comment && (
                <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
                  Napomena nastavnika: {targetSummary.officialFinalGrade.comment}
                </p>
              )}

            {studentVisibleFinalGrade === null && (
              <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
                Konačna ocjena se prikazuje tek nakon što predmetni nastavnik zvanično zaključi
                ocjenu u skladu sa pravilima predmeta.
              </p>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-5 space-y-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">Ostvareni napredak</span>
                <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                  {formatPoints(totalEarnedPoints)} / {formatPoints(maxPossiblePoints)} b (
                  {percentageAchieved}%)
                </span>
              </div>

              <Progress
                value={percentageAchieved}
                indicatorClassName={passedThreshold ? 'bg-emerald-600' : 'bg-blue-700'}
              />

              <div className="text-xs text-slate-600 flex items-center justify-between">
                <span>Status praga ({course.grade6Threshold} b):</span>
                {passedThreshold ? (
                  <span className="font-semibold text-emerald-700">Ostvaren prag prolaza</span>
                ) : (
                  <span className="font-mono text-slate-700 tabular-nums">
                    Nedostaje još {formatPoints(course.grade6Threshold - totalEarnedPoints)} b
                  </span>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50/50">
              <div className="px-5 py-2 text-[11px] font-medium text-slate-500 border-b border-slate-100">
                Skala ocjenjivanja na predmetu
              </div>
              <div className="grid grid-cols-5 divide-x divide-slate-200 text-center font-mono text-xs">
                {[
                  { g: 6, min: course.grade6Threshold },
                  { g: 7, min: course.grade7Threshold },
                  { g: 8, min: course.grade8Threshold },
                  { g: 9, min: course.grade9Threshold },
                  { g: 10, min: course.grade10Threshold },
                ].map((tier) => {
                  const reached = totalEarnedPoints >= tier.min;
                  return (
                    <div
                      key={tier.g}
                      className={cn(
                        'py-2.5 px-1 tabular-nums',
                        reached
                          ? 'bg-blue-50/70 text-blue-900 font-semibold'
                          : 'text-slate-500'
                      )}
                    >
                      <div className="text-xs font-bold">{tier.g}</div>
                      <div className="text-[10px] opacity-80">≥{tier.min}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // =========================================================================
  // VIEW: STARI SEMESTRI I POLOŽENI PREDMETI (Accessible even if 0 active courses)
  // =========================================================================
  if (activeNav === 'semestri') {
    const passedEnrollmentsAll = enrollments.filter((enr) => {
      const g = summariesByCourseId[enr.courseId]?.studentVisibleFinalGrade;
      return g !== null && g !== undefined && g >= 6;
    });

    const earnedEcts = passedEnrollmentsAll.reduce((acc, enr) => {
      const ects = bundlesByCourseId[enr.courseId]?.course.ects ?? 0;
      return acc + ects;
    }, 0);

    const avgFinalGrade =
      passedEnrollmentsAll.length > 0
        ? passedEnrollmentsAll.reduce(
            (acc, enr) =>
              acc + (summariesByCourseId[enr.courseId]?.studentVisibleFinalGrade ?? 0),
            0
          ) / passedEnrollmentsAll.length
        : 0;

    const distinctYears = Array.from(
      new Set(
        historicalEnrollments
          .map((e) => bundlesByCourseId[e.courseId]?.course.academicYear || e.academicYear)
          .filter(Boolean)
      )
    ).sort((a, b) => b.localeCompare(a));

    const visibleHistory = historicalEnrollments.filter((enr) => {
      const crs = bundlesByCourseId[enr.courseId]?.course;
      const isArch = Boolean(enr.isArchived || crs?.isArchived);
      const g = summariesByCourseId[enr.courseId]?.studentVisibleFinalGrade;
      const isPassed = g !== null && g !== undefined && g >= 6;
      const yearStr = crs?.academicYear || enr.academicYear;

      if (historyFilter === 'archived' && !isArch) return false;
      if (historyFilter === 'passed' && !isPassed) return false;
      if (historyYearFilter !== 'all' && yearStr !== historyYearFilter) return false;
      return true;
    });

    const selectedHistBundle = selectedHistoryCourseId
      ? bundlesByCourseId[selectedHistoryCourseId]
      : undefined;
    const selectedHistSummary = selectedHistoryCourseId
      ? summariesByCourseId[selectedHistoryCourseId]
      : undefined;

    return (
      <div className="space-y-6">
        {/* Historical KPI Strip */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 sm:divide-x divide-slate-200">
            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Arhivirani predmeti</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {archivedEnrollments.length}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Stari semestri u dosjeu</div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Ukupno položeno predmeta</div>
              <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                {passedEnrollmentsAll.length}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Sa zaključenom ocjenom ≥ 6</div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Ostvareno ECTS kredita</div>
              <div className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums">
                {earnedEcts} ECTS
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Zbir položenih predmeta</div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Prosjek zaključenih ocjena</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {passedEnrollmentsAll.length > 0 ? avgFinalGrade.toFixed(2) : '—'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Na osnovu položenih ispita</div>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { key: 'all_history', label: `Sva historija (${historicalEnrollments.length})` },
              { key: 'archived', label: `Arhivirani semestri (${archivedEnrollments.length})` },
              { key: 'passed', label: `Položeni predmeti (${passedEnrollmentsAll.length})` },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() =>
                  setHistoryFilter(tab.key as 'archived' | 'passed' | 'all_history')
                }
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
                  historyFilter === tab.key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {distinctYears.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 whitespace-nowrap">Akademska godina:</span>
              <select
                value={historyYearFilter}
                onChange={(e) => setHistoryYearFilter(e.target.value)}
                className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-800 tabular-nums"
              >
                <option value="all">Sve godine</option>
                {distinctYears.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Historical Courses Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {visibleHistory.length === 0 ? (
            <div className="p-8 text-center">
              <Archive className="w-7 h-7 text-slate-400 mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-slate-900">
                Nema arhiviranih semestara ili položenih predmeta za izabrani filter
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
                Kada uprava fakulteta arhivira završeni semestar ili nastavnik zaključi prolaznu
                ocjenu, cjelokupna evidencija predmeta trajno ostaje dostupna na ovoj stranici.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="text-left py-3 px-4">Predmet</th>
                    <th className="text-left py-3 px-4 whitespace-nowrap">Godina i semestar</th>
                    <th className="text-left py-3 px-4">Nastavnik</th>
                    <th className="text-right py-3 px-4 whitespace-nowrap">Bodovi</th>
                    <th className="text-left py-3 px-4 whitespace-nowrap">Konačna ocjena</th>
                    <th className="text-right py-3 px-4">Detalji</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleHistory.map((enr) => {
                    const bundle = bundlesByCourseId[enr.courseId];
                    const crs = bundle?.course;
                    const sum = summariesByCourseId[enr.courseId];
                    const isSelected = enr.courseId === selectedHistoryCourseId;
                    const isArch = Boolean(enr.isArchived || crs?.isArchived);
                    return (
                      <tr
                        key={enr.id}
                        className={cn(
                          'transition-colors',
                          isSelected ? 'bg-blue-50/45' : 'hover:bg-slate-50/80'
                        )}
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{enr.courseName}</div>
                          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-blue-700">{enr.courseCode}</span>
                            {crs && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">{crs.ects} ECTS</span>
                              </>
                            )}
                            {isArch && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>Arhiviran semestar</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700">
                          <div className="font-mono font-semibold text-slate-900 tabular-nums">
                            {crs?.academicYear || enr.academicYear}
                          </div>
                          <div className="text-slate-500 mt-0.5">
                            {crs?.semester || enr.semester || 'Završen semestar'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700">
                          {formatCourseProfessors(crs, enr.leadProfessorName)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {sum
                            ? `${formatPoints(sum.totalEarnedPoints)} / ${formatPoints(sum.maxPossiblePoints)}`
                            : '—'}
                        </td>
                        <td className="py-3 px-4 text-xs whitespace-nowrap">
                          {sum?.studentVisibleFinalGrade !== null && sum !== undefined ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold font-mono tabular-nums">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              Ocjena {sum.studentVisibleFinalGrade}
                            </span>
                          ) : (
                            <span className="text-slate-500">Arhivirano bez ocjene</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <Button
                            variant={isSelected ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setSelectedHistoryCourseId(enr.courseId)}
                          >
                            {isSelected ? 'Prikazano ispod' : 'Pregled bodova'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detailed Breakdown for Selected Historical Course */}
        {selectedHistBundle &&
          selectedHistSummary &&
          renderCourseBreakdown(selectedHistBundle, selectedHistSummary, true)}
      </div>
    );
  }

  // Empty state for active semester views if student has 0 active courses
  if (activeEnrollments.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-xl mx-auto my-8">
        <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h2 className="text-base font-semibold text-slate-900">
          Trenutno nemate aktivnih predmeta u tekućem semestru
        </h2>
        <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
          Studentska služba (administrator) ili predmetni nastavnik vrši upis na predmete prema
          vašem dodijeljenom broju indeksa{' '}
          {profile?.studentIndex ? (
            <strong className="font-mono text-slate-900 tabular-nums">
              ({profile.studentIndex})
            </strong>
          ) : (
            ''
          )}
          .
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {archivedEnrollments.length > 0 && (
            <Button onClick={() => onNavigate('semestri')}>
              <Archive className="w-4 h-4" />
              Pregledaj stare semestre ({archivedEnrollments.length})
            </Button>
          )}
          <Button variant="outline" onClick={() => onNavigate('obavjestenja')}>
            Obavještenja uprave
          </Button>
          <Button variant="outline" onClick={() => onNavigate('profil')}>
            Otvori moj profil
          </Button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW: RASPORED PREDAVANJA, LABOVA, ISPITA I ROKOVA ("Danas", "Ove sedmice", "Cijeli semestar")
  // =========================================================================
  if (activeNav === 'raspored') {
    return (
      <ScheduleView
        courses={activeCoursesList}
        scheduleEvents={activeScheduleEvents}
        examTerms={activeExamTerms}
        gradingItems={activeGradingItems}
        canEdit={false}
      />
    );
  }

  // =========================================================================
  // VIEW: PRIJAVA ISPITA
  // =========================================================================
  if (activeNav === 'ispiti' && profile) {
    return (
      <StudentExamsView
        studentProfile={profile}
        examTerms={activeExamTerms}
        examRegistrations={examRegistrations}
        coursesById={activeCoursesById}
      />
    );
  }

  const activeBundle = selectedCourseId ? bundlesByCourseId[selectedCourseId] : undefined;
  const activeSummary = selectedCourseId ? summariesByCourseId[selectedCourseId] : undefined;

  // Fast 1-click horizontal course switcher bar across active semester courses
  const CourseTabsBar = () => (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2.5 flex items-center gap-1.5 overflow-x-auto">
        {activeEnrollments.map((enr) => {
          const isSelected = enr.courseId === selectedCourseId;
          const sum = summariesByCourseId[enr.courseId];
          return (
            <button
              key={enr.id}
              type="button"
              onClick={() => {
                setSelectedCourseId(enr.courseId);
                setItemFilterCat('all');
              }}
              className={cn(
                'px-3.5 py-2 rounded-lg text-left transition-colors cursor-pointer shrink-0 flex items-center gap-3',
                isSelected
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              )}
            >
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span
                  className={cn(
                    'font-mono text-xs font-semibold',
                    isSelected ? 'text-blue-300' : 'text-blue-700'
                  )}
                >
                  {enr.courseCode}
                </span>
                <span className="text-sm font-semibold">{enr.courseName}</span>
              </div>

              {sum && (
                <span
                  className={cn(
                    'font-mono text-xs tabular-nums whitespace-nowrap',
                    isSelected ? 'text-slate-300' : 'text-slate-500'
                  )}
                >
                  {sum.studentVisibleFinalGrade !== null
                    ? `Ocjena ${sum.studentVisibleFinalGrade}`
                    : `${formatPoints(sum.totalEarnedPoints)}b`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeBundle && (
        <div className="px-4 py-2.5 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {activeBundle.course.studyProgram && (
              <>
                <span className="font-medium text-blue-700">
                  {activeBundle.course.studyProgram}
                </span>
                <span aria-hidden="true" className="text-slate-300">·</span>
              </>
            )}
            <span>
              {getCourseProfessors(activeBundle.course).length > 1 ? 'Profesori: ' : 'Profesor: '}
              <strong className="font-medium text-slate-900">
                {formatCourseProfessors(activeBundle.course)}
              </strong>
            </span>
            {getCourseAssistants(activeBundle.course).length > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span>
                  Asistenti:{' '}
                  <strong className="font-medium text-slate-800">
                    {formatCourseAssistants(activeBundle.course)}
                  </strong>
                </span>
              </>
            )}
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>{activeBundle.course.semester}</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="font-mono tabular-nums">{activeBundle.course.ects} ECTS</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onNavigate('raspored')}
              className="font-medium text-slate-600 hover:text-slate-900 hover:underline cursor-pointer whitespace-nowrap"
            >
              Raspored
            </button>
            <button
              type="button"
              onClick={() => onNavigate('ispiti')}
              className="font-medium text-blue-700 hover:underline cursor-pointer whitespace-nowrap tabular-nums"
            >
              Prijava ispita ({activeBundle.examTerms.length})
            </button>
            <button
              type="button"
              onClick={() => onNavigate('predmeti')}
              className="font-medium text-slate-600 hover:text-slate-900 hover:underline cursor-pointer whitespace-nowrap"
            >
              Svi predmeti
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // =========================================================================
  // VIEW 1: POČETNA — PREGLED I BODOVI
  // =========================================================================
  if (activeNav === 'pocetna') {
    return (
      <div className="space-y-5">
        {openExamStats.openCount > 0 && (
          <div className="bg-white border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3 min-w-0">
              <CalendarCheck2 className="w-5 h-5 text-blue-700 shrink-0 mt-0.5 sm:mt-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 tabular-nums">
                  {openExamStats.unansweredCount > 0
                    ? `Otvorena je prijava za ${openExamStats.unansweredCount} ${openExamStats.unansweredCount === 1 ? 'ispitni rok' : 'ispitna roka'}`
                    : `Aktivna prijava ispita (${openExamStats.registeredCount} prijavljeno)`}
                </div>
                {openExamStats.firstOpenTerm && (
                  <p className="text-xs text-slate-600 mt-0.5 truncate">
                    {openExamStats.firstOpenTerm.courseCode} · {openExamStats.firstOpenTerm.title}{' '}
                    — rok za prijavu do{' '}
                    <span className="font-mono font-semibold text-slate-800 tabular-nums">
                      {formatBosnianDate(openExamStats.firstOpenTerm.registrationCloseDate)}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => onNavigate('ispiti')}
              className="shrink-0 self-start sm:self-auto"
            >
              Prijava ispita
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        <CourseTabsBar />
        {renderCourseBreakdown(activeBundle, activeSummary, false)}
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: SVI PREDMETI (Active Semester Courses + Quick Link to Archive)
  // =========================================================================
  if (activeNav === 'predmeti') {
    const filteredEnrollments = activeEnrollments
      .filter((enr) => {
        const crs = bundlesByCourseId[enr.courseId]?.course;
        if (programFilter !== 'all') {
          const cycle = getCourseProgramCycle(
            crs || { code: enr.courseCode, semester: '', studyProgram: undefined }
          );
          if (cycle !== programFilter) return false;
        }
        const q = courseSearch.trim().toLowerCase();
        if (!q) return true;
        return (
          enr.courseName.toLowerCase().includes(q) ||
          enr.courseCode.toLowerCase().includes(q) ||
          (crs?.studyProgram || '').toLowerCase().includes(q) ||
          (crs?.semester || '').toLowerCase().includes(q) ||
          formatCourseProfessors(crs, enr.leadProfessorName).toLowerCase().includes(q) ||
          formatCourseAssistants(crs).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const sumA = summariesByCourseId[a.courseId];
        const sumB = summariesByCourseId[b.courseId];
        if (courseSortBy === 'points') {
          return (sumB?.totalEarnedPoints ?? 0) - (sumA?.totalEarnedPoints ?? 0);
        }
        if (courseSortBy === 'pct') {
          return (sumB?.percentageAchieved ?? 0) - (sumA?.percentageAchieved ?? 0);
        }
        return a.courseName.localeCompare(b.courseName, 'bs');
      });

    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={courseSearch}
                onChange={(e) => setCourseSearch(e.target.value)}
                placeholder="Pretraži predmete, smjerove ili osoblje..."
                className="pl-9"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
              {(
                [
                  { key: 'all', label: 'Svi programi' },
                  { key: 'strucni_rs', label: 'Stručni RS (2 god.)' },
                  { key: 'bachelor', label: 'Bachelor' },
                  { key: 'master', label: 'Master smjerovi' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setProgramFilter(tab.key)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
                    programFilter === tab.key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-600">Sortiraj po:</span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {[
                { key: 'name', label: 'Nazivu' },
                { key: 'points', label: 'Bodovima' },
                { key: 'pct', label: 'Procentu' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setCourseSortBy(opt.key as 'name' | 'points' | 'pct')}
                  className={cn(
                    'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0',
                    courseSortBy === opt.key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {archivedEnrollments.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => onNavigate('semestri')}>
                <Archive className="w-3.5 h-3.5" />
                Stari semestri ({archivedEnrollments.length})
              </Button>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filteredEnrollments.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Nema upisanih predmeta u tekućem semestru za izabrani kriterij pretrage.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="text-left py-3 px-4">Predmet</th>
                    <th className="text-left py-3 px-4">Profesori i asistenti</th>
                    <th className="text-right py-3 px-4 whitespace-nowrap">Osvojeno</th>
                    <th className="text-right py-3 px-4 whitespace-nowrap">Maksimalno</th>
                    <th className="text-right py-3 px-4 whitespace-nowrap">Ostvareno</th>
                    <th className="text-left py-3 px-4 whitespace-nowrap">Status / Ocjena</th>
                    <th className="text-right py-3 px-4">Akcija</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEnrollments.map((enr) => {
                    const sum = summariesByCourseId[enr.courseId];
                    const bundle = bundlesByCourseId[enr.courseId];
                    const crs = bundle?.course;
                    const assistantsStr = formatCourseAssistants(crs);
                    return (
                      <tr key={enr.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{enr.courseName}</div>
                          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className="font-mono text-blue-700">{enr.courseCode}</span>
                            {bundle && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  {bundle.course.ects} ECTS
                                </span>
                              </>
                            )}
                            {crs?.studyProgram && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{crs.studyProgram}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-xs text-slate-800">
                            <span className="text-slate-500">
                              {getCourseProfessors(crs, enr.leadProfessorName).length > 1
                                ? 'Profesori: '
                                : 'Profesor: '}
                            </span>
                            <span className="font-medium">
                              {formatCourseProfessors(crs, enr.leadProfessorName)}
                            </span>
                          </div>
                          {assistantsStr && (
                            <div className="text-xs text-slate-500 mt-0.5">
                              <span>Asistenti: </span>
                              <span className="text-slate-700">{assistantsStr}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {sum ? formatPoints(sum.totalEarnedPoints) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums">
                          {sum ? formatPoints(sum.maxPossiblePoints) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-700 tabular-nums">
                          {sum ? `${sum.percentageAchieved}%` : '—'}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {sum?.studentVisibleFinalGrade !== null && sum !== undefined ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold font-mono tabular-nums">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              Zaključena ocjena: {sum.studentVisibleFinalGrade}
                            </span>
                          ) : sum?.passedThreshold ? (
                            <span className="text-blue-700 font-medium">Ostvaren prag · U toku</span>
                          ) : (
                            <span className="text-slate-500">Nastava u toku</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedCourseId(enr.courseId);
                              onNavigate('pocetna');
                            }}
                          >
                            Detalji bodova
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 3: PRISUSTVO
  // =========================================================================
  if (activeNav === 'prisustvo') {
    const att = activeSummary?.attendance;
    return (
      <div className="space-y-5">
        <CourseTabsBar />

        {!activeBundle?.course.attendanceEnabled ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
            <Info className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-900">
              Praćenje prisustva nije aktivno na ovom predmetu
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Nastavnik je isključio bodovanje prisustva za predmet {activeBundle?.course.name}.
            </p>
          </div>
        ) : (
          att && (
            <>
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                  <div className="p-4 sm:p-5">
                    <div className="text-xs text-slate-500">Bodovi za prisustvo</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                      {formatPoints(att.earnedPoints)} / {formatPoints(att.maxPoints)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                      {att.maxPoints} × {att.attendedCount} / {att.heldCount || 0}
                    </div>
                  </div>

                  <div className="p-4 sm:p-5">
                    <div className="text-xs text-slate-500">Procenat prisustva</div>
                    <div
                      className={cn(
                        'mt-1 font-mono text-2xl font-bold tabular-nums',
                        (att.percentage ?? 0) >= 70 ? 'text-emerald-700' : 'text-red-700'
                      )}
                    >
                      {att.percentage ?? 0}%
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      Od ukupno {att.heldCount} održanih termina
                    </div>
                  </div>

                  <div className="p-4 sm:p-5">
                    <div className="text-xs text-slate-500">Prisustvovao termina</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                      {att.attendedCount}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">Evidentirano prisustvo</div>
                  </div>

                  <div className="p-4 sm:p-5">
                    <div className="text-xs text-slate-500">Broj izostanaka</div>
                    <div
                      className={cn(
                        'mt-1 font-mono text-2xl font-bold tabular-nums',
                        att.absentCount > 0 ? 'text-red-700' : 'text-slate-900'
                      )}
                    >
                      {att.absentCount}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Budući i otkazani se ne odbijaju
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Evidencija termina po datumima
                  </h3>
                </div>

                {att.sessions.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Nastavnik još nije kreirao nijedan termin prisustva za ovaj predmet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="text-left py-2.5 px-4">Datum i vrijeme</th>
                          <th className="text-left py-2.5 px-4">Tema / Opis termina</th>
                          <th className="text-left py-2.5 px-4">Status</th>
                          <th className="text-left py-2.5 px-4">Napomena</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {att.sessions.map((row) => (
                          <tr key={row.session.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <div className="font-mono font-medium text-slate-900 tabular-nums">
                                {formatBosnianDate(row.session.date)}
                              </div>
                              {row.session.time && (
                                <div className="text-xs text-slate-500 font-mono tabular-nums">
                                  {row.session.time}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-slate-800">
                              {row.session.topic || 'Redovni termin nastave'}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap text-xs font-medium">
                              {row.state === 'present' && (
                                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                                  Prisutan
                                </span>
                              )}
                              {row.state === 'absent' && (
                                <span className="inline-flex items-center gap-1.5 text-red-700">
                                  <XCircle className="w-4 h-4 shrink-0" />
                                  Odsutan
                                </span>
                              )}
                              {row.state === 'cancelled' && (
                                <span className="inline-flex items-center gap-1.5 text-slate-500">
                                  <MinusCircle className="w-4 h-4 shrink-0" />
                                  Otkazan termin (ne ulazi u obračun)
                                </span>
                              )}
                              {row.state === 'future' && (
                                <span className="inline-flex items-center gap-1.5 text-blue-700">
                                  <Clock className="w-4 h-4 shrink-0" />
                                  Budući termin (ne oduzima bodove)
                                </span>
                              )}
                              {row.state === 'unrecorded' && (
                                <span className="text-slate-400">Čeka evidenciju</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-xs text-slate-500">
                              {row.note || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )
        )}
      </div>
    );
  }

  // =========================================================================
  // VIEW 4: ZADACI I PROVJERE
  // =========================================================================
  const allItemsWithMeta =
    activeSummary?.categories.flatMap((cat) =>
      cat.items.map((itemRow) => ({
        categoryName: cat.category.name,
        categoryId: cat.category.id,
        ...itemRow,
      }))
    ) || [];

  const filteredItems =
    itemFilterCat === 'all'
      ? allItemsWithMeta
      : allItemsWithMeta.filter((i) => i.categoryId === itemFilterCat);

  return (
    <div className="space-y-5">
      <CourseTabsBar />

      {activeSummary && activeSummary.categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit max-w-full">
          <button
            type="button"
            onClick={() => setItemFilterCat('all')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
              itemFilterCat === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            Sve stavke ({allItemsWithMeta.length})
          </button>
          {activeSummary.categories.map((cat) => (
            <button
              key={cat.category.id}
              type="button"
              onClick={() => setItemFilterCat(cat.category.id)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
                itemFilterCat === cat.category.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {cat.category.name} ({cat.items.length})
            </button>
          ))}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Nema evidentiranih zadataka, vježbi ili ispita za izabrani filter.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredItems.map((entry) => (
              <div
                key={entry.item.id}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-blue-700">{entry.categoryName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {formatBosnianDate(entry.item.date)}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">{entry.item.name}</h3>
                  {entry.item.description && (
                    <p className="text-xs text-slate-600">{entry.item.description}</p>
                  )}
                  {entry.feedback && (
                    <div className="pt-1 flex items-start gap-1.5 text-xs text-slate-700">
                      <MessageSquare className="w-3.5 h-3.5 text-blue-700 shrink-0 mt-0.5" />
                      <span>
                        <strong>Komentar nastavnika:</strong> {entry.feedback}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                  <div className="font-mono text-base font-bold text-slate-900 tabular-nums">
                    {entry.graded ? formatPoints(entry.earnedPoints) : '—'}{' '}
                    <span className="text-xs font-normal text-slate-500">
                      / {formatPoints(entry.maxPoints)} b
                    </span>
                  </div>
                  <div className="text-xs">
                    {entry.graded ? (
                      <span className="text-emerald-700 font-medium">Ocijenjeno</span>
                    ) : (
                      <span className="text-slate-400">Čeka ocjenu</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
