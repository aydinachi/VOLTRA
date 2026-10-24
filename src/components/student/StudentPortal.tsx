import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpDown,
  Award,
  BookOpen,
  Calendar,
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
} from '../../lib/calculations';
import { cn, formatBosnianDate, formatPoints } from '../../lib/utils';
import {
  fetchCourseBundleByIds,
  subscribeStudentAttendanceRecords,
  subscribeStudentEnrollments,
  subscribeStudentFinalGrades,
  subscribeStudentScores,
} from '../../services/zamioService';
import {
  AttendanceRecord,
  AttendanceSession,
  Course,
  Enrollment,
  FinalGrade,
  GradingCategory,
  GradingItem,
  Score,
} from '../../types/zamio';
import { StudentNavKey } from '../AppShell';
import { ProfileView } from '../ProfileView';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Progress } from '../ui/progress';

interface CourseBundle {
  course: Course;
  categories: GradingCategory[];
  items: GradingItem[];
  sessions: AttendanceSession[];
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
  const [loading, setLoading] = useState(true);

  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [courseSearch, setCourseSearch] = useState('');
  const [itemFilterCat, setItemFilterCat] = useState<string>('all');
  const [courseSortBy, setCourseSortBy] = useState<'name' | 'points' | 'pct'>('name');

  useEffect(() => {
    if (!studentUid) return;
    setLoading(true);

    const unsubEnroll = subscribeStudentEnrollments(studentUid, (rows) => {
      setEnrollments(rows);
      if (rows.length === 0) {
        setLoading(false);
      }
    });
    const unsubScores = subscribeStudentScores(studentUid, setScores);
    const unsubAtt = subscribeStudentAttendanceRecords(studentUid, setAttendanceRecords);
    const unsubGrades = subscribeStudentFinalGrades(studentUid, setFinalGrades);

    return () => {
      unsubEnroll();
      unsubScores();
      unsubAtt();
      unsubGrades();
    };
  }, [studentUid]);

  // Fetch course structure bundles (Course, Categories, Items, Sessions) by enrolled course IDs
  useEffect(() => {
    let cancelled = false;
    if (enrollments.length === 0) {
      setBundlesByCourseId({});
      return;
    }

    async function loadBundles() {
      const entries = await Promise.all(
        enrollments.map(async (enr) => {
          const b = await fetchCourseBundleByIds(enr.courseId);
          return [enr.courseId, b] as const;
        })
      );

      if (cancelled) return;
      const nextMap: Record<string, CourseBundle> = {};
      for (const [cId, bundle] of entries) {
        if (bundle.course) {
          nextMap[cId] = {
            course: bundle.course,
            categories: bundle.categories,
            items: bundle.items,
            sessions: bundle.sessions,
          };
        }
      }
      setBundlesByCourseId(nextMap);
      setSelectedCourseId((prev) => {
        if (prev && nextMap[prev]) return prev;
        const firstId = enrollments[0]?.courseId || '';
        return firstId;
      });
      setLoading(false);
    }

    void loadBundles();
    return () => {
      cancelled = true;
    };
  }, [enrollments, scores.length, attendanceRecords.length, finalGrades.length]);

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

  if (activeNav === 'profil') {
    return <ProfileView />;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 bg-slate-200/70 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-32 bg-white border border-slate-200 rounded-xl p-5 animate-pulse"
            />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (enrollments.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-xl mx-auto my-8">
        <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h2 className="text-base font-semibold text-slate-900">
          Trenutno niste upisani ni na jedan predmet
        </h2>
        <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
          Provjerite jeste li unijeli tačan <strong>broj indeksa</strong> na stranici Profil kako bi
          vas predmetni nastavnik mogao dodati na listu upisanih studenata.
        </p>
        <div className="mt-5">
          <Button onClick={() => onNavigate('profil')}>Otvori moj profil</Button>
        </div>
      </div>
    );
  }

  const activeBundle = selectedCourseId ? bundlesByCourseId[selectedCourseId] : undefined;
  const activeSummary = selectedCourseId ? summariesByCourseId[selectedCourseId] : undefined;

  const CourseSwitcherBar = () => (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs text-slate-500">Aktivni predmet</div>
        {activeBundle ? (
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <span className="font-mono text-xs font-semibold text-blue-700">
              {activeBundle.course.code}
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="font-semibold text-slate-900 text-sm sm:text-base">
              {activeBundle.course.name}
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="text-xs text-slate-500">
              {activeBundle.course.leadProfessorName}
            </span>
          </div>
        ) : (
          <div className="text-sm text-slate-600">Izaberite predmet</div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <label htmlFor="student-course-select" className="text-xs font-medium text-slate-600 whitespace-nowrap">
          Promijeni predmet:
        </label>
        <select
          id="student-course-select"
          value={selectedCourseId}
          onChange={(e) => {
            setSelectedCourseId(e.target.value);
            setItemFilterCat('all');
          }}
          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {enrollments.map((enr) => (
            <option key={enr.courseId} value={enr.courseId}>
              {enr.courseCode} — {enr.courseName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  // Zamger-inspired Grade Breakdown Component (used on Početna & Ocjene i bodovi)
  const ZamgerCourseBreakdown = () => {
    if (!activeBundle || !activeSummary) return null;
    const { course } = activeBundle;
    const { attendance, categories, totalEarnedPoints, maxPossiblePoints, percentageAchieved, studentVisibleFinalGrade, passedThreshold } = activeSummary;

    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Columns: Structured Zamger Table (Attendance -> Categories -> Items -> Total) */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Struktura bodova — {course.name}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {course.semester} · {course.ects} ECTS · Prag za prolaz:{' '}
                <span className="font-mono font-medium text-slate-700">
                  {course.grade6Threshold}
                </span>{' '}
                bodova
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate('prisustvo')}
              className="self-start sm:self-auto text-blue-700 hover:text-blue-800"
            >
              Detalji prisustva
            </Button>
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
                {/* 1. Prisustvo First (Zamger Tradition) */}
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
                                <span className="font-mono">
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

        {/* Right 4 Columns: Progress Card & Compact Zamger Final Grade Box */}
        <div className="lg:col-span-4 space-y-5">
          {/* Compact Zamger Final Grade Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
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
                  'w-16 h-16 rounded-xl border flex items-center justify-center font-mono text-2xl font-bold tabular-nums shrink-0',
                  studentVisibleFinalGrade !== null
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-slate-50 border-slate-200 text-slate-400'
                )}
              >
                {studentVisibleFinalGrade !== null ? studentVisibleFinalGrade : '—'}
              </div>
            </div>

            {activeSummary.officialFinalGrade?.status === 'finalized' &&
              activeSummary.officialFinalGrade.comment && (
                <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
                  Napomena nastavnika: {activeSummary.officialFinalGrade.comment}
                </p>
              )}

            {studentVisibleFinalGrade === null && (
              <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
                Konačna ocjena se prikazuje tek nakon što predmetni nastavnik zvanično zaključi
                ocjenu u skladu sa pravilima predmeta.
              </p>
            )}
          </div>

          {/* Score Progress Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">Ostvareni napredak</span>
              <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                {formatPoints(totalEarnedPoints)} / {formatPoints(maxPossiblePoints)} bodova ({percentageAchieved}%)
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

            {/* Course Grade Threshold Scale */}
            <div className="pt-3 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                Skala ocjenjivanja na predmetu
              </div>
              <div className="grid grid-cols-5 gap-1.5 text-center font-mono text-xs">
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
                        'rounded-lg border py-1.5 px-1',
                        reached
                          ? 'bg-blue-50/80 border-blue-200 text-blue-900 font-semibold'
                          : 'bg-slate-50 border-slate-200 text-slate-500'
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
  // VIEW 1: POČETNA (Overview Cards + Active Course Zamger Breakdown)
  // =========================================================================
  if (activeNav === 'pocetna') {
    return (
      <div className="space-y-6">
        {/* Enrolled Courses Quick Overview Grid */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">
              Upisani predmeti ({enrollments.length})
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('predmeti')}
              className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
            >
              Svi predmeti u tabeli
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {enrollments.map((enr) => {
              const sum = summariesByCourseId[enr.courseId];
              const isSelected = enr.courseId === selectedCourseId;
              return (
                <button
                  key={enr.id}
                  type="button"
                  onClick={() => setSelectedCourseId(enr.courseId)}
                  className={cn(
                    'text-left bg-white rounded-xl p-4 border transition-colors cursor-pointer flex flex-col justify-between gap-3',
                    isSelected
                      ? 'border-blue-600 ring-1 ring-blue-600'
                      : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-blue-700">
                        {enr.courseCode}
                      </span>
                      <span className="truncate">{enr.leadProfessorName}</span>
                    </div>
                    <h3 className="font-semibold text-slate-900 text-base mt-1 truncate">
                      {enr.courseName}
                    </h3>
                  </div>

                  {sum && (
                    <div className="space-y-2 w-full">
                      <Progress
                        value={sum.percentageAchieved}
                        className="h-1.5"
                        indicatorClassName={
                          sum.studentVisibleFinalGrade !== null
                            ? 'bg-emerald-600'
                            : 'bg-blue-700'
                        }
                      />
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold text-slate-800 tabular-nums">
                          {formatPoints(sum.totalEarnedPoints)} / {formatPoints(sum.maxPossiblePoints)} b ({sum.percentageAchieved}%)
                        </span>
                        {sum.studentVisibleFinalGrade !== null ? (
                          <span className="font-semibold text-emerald-700 font-mono">
                            Ocjena: {sum.studentVisibleFinalGrade}
                          </span>
                        ) : (
                          <span className="text-slate-500">U toku</span>
                        )}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <ZamgerCourseBreakdown />
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: MOJI PREDMETI (Searchable & Sortable Course Table)
  // =========================================================================
  if (activeNav === 'predmeti') {
    const filteredEnrollments = enrollments
      .filter((enr) => {
        const q = courseSearch.trim().toLowerCase();
        if (!q) return true;
        return (
          enr.courseName.toLowerCase().includes(q) ||
          enr.courseCode.toLowerCase().includes(q) ||
          enr.leadProfessorName.toLowerCase().includes(q)
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
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={courseSearch}
              onChange={(e) => setCourseSearch(e.target.value)}
              placeholder="Pretraži predmete ili profesora..."
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
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
                    'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer',
                    courseSortBy === opt.key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="text-left py-3 px-4">Predmet</th>
                  <th className="text-left py-3 px-4">Nastavnik</th>
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
                  return (
                    <tr key={enr.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{enr.courseName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          <span className="font-mono text-blue-700">{enr.courseCode}</span>
                          {bundle && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span>{bundle.course.ects} ECTS</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700">{enr.leadProfessorName}</td>
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
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Zaključena ocjena: {sum.studentVisibleFinalGrade}
                          </span>
                        ) : sum?.passedThreshold ? (
                          <span className="text-blue-700 font-medium">Ostvaren prag · U toku</span>
                        ) : (
                          <span className="text-slate-500">Nastava u toku</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedCourseId(enr.courseId);
                            onNavigate('ocjene');
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
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 3: OCJENE I BODOVI (Focused Course Switcher + Full Breakdown)
  // =========================================================================
  if (activeNav === 'ocjene') {
    return (
      <div className="space-y-5">
        <CourseSwitcherBar />
        <ZamgerCourseBreakdown />
      </div>
    );
  }

  // =========================================================================
  // VIEW 4: PRISUSTVO (Date-by-date Attendance Log & Automatic Calculation)
  // =========================================================================
  if (activeNav === 'prisustvo') {
    const att = activeSummary?.attendance;
    return (
      <div className="space-y-5">
        <CourseSwitcherBar />

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
              {/* Key Attendance Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Bodovi za prisustvo</div>
                  <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                    {formatPoints(att.earnedPoints)} / {formatPoints(att.maxPoints)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {att.maxPoints} × {att.attendedCount} / {att.heldCount || 0}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Procenat prisustva</div>
                  <div
                    className={cn(
                      'mt-1 font-mono text-xl font-bold tabular-nums',
                      (att.percentage ?? 0) >= 70 ? 'text-emerald-700' : 'text-red-700'
                    )}
                  >
                    {att.percentage ?? 0}%
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Od ukupno {att.heldCount} održanih termina
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Prisustvovao termina</div>
                  <div className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">
                    {att.attendedCount}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">Evidentirano prisustvo</div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Broj izostanaka</div>
                  <div
                    className={cn(
                      'mt-1 font-mono text-xl font-bold tabular-nums',
                      att.absentCount > 0 ? 'text-red-700' : 'text-slate-900'
                    )}
                  >
                    {att.absentCount}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Budući i otkazani termini se ne odbijaju
                  </div>
                </div>
              </div>

              {/* Sessions Table */}
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
                              <div className="font-mono font-medium text-slate-900">
                                {formatBosnianDate(row.session.date)}
                              </div>
                              {row.session.time && (
                                <div className="text-xs text-slate-500 font-mono">
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
  // VIEW 5: ZADACI (Assignments, Exercises, and Exams with Feedback)
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
      <CourseSwitcherBar />

      {/* Category Filter Tabs */}
      {activeSummary && activeSummary.categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setItemFilterCat('all')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer',
              itemFilterCat === 'all'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
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
                'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer',
                itemFilterCat === cat.category.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
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
                    <span className="inline-flex items-center gap-1 font-mono">
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
                      <span className="text-slate-400">U pripremi / Čeka ocjenu</span>
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
