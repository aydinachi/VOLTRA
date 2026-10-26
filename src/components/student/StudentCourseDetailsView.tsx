import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Award,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  Info,
  MessageSquare,
  MinusCircle,
  Star,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  CourseStudentSummary,
  getExamWindowState,
  getTodayIsoLocal,
} from '../../lib/calculations';
import {
  cn,
  formatBosnianDate,
  formatCourseAssistants,
  formatCourseProfessors,
  formatPoints,
  getCourseAssistants,
  getCourseProfessors,
} from '../../lib/utils';
import { setStudentExamRegistration } from '../../services/zamioService';
import {
  Course,
  Enrollment,
  ExamRegistration,
  ExamRegistrationStatus,
  ExamTerm,
  UserProfile,
} from '../../types/zamio';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';

interface StudentCourseDetailsViewProps {
  course: Course;
  summary: CourseStudentSummary;
  studentProfile: UserProfile;
  courseExamTerms?: ExamTerm[];
  examRegistrations?: ExamRegistration[];
  siblingEnrollments?: Enrollment[];
  onSelectCourse?: (courseId: string) => void;
  onBackToList?: () => void;
  onOpenAllExams?: () => void;
  isArchivedView?: boolean;
}

export function StudentCourseDetailsView({
  course,
  summary,
  studentProfile,
  courseExamTerms = [],
  examRegistrations = [],
  siblingEnrollments = [],
  onSelectCourse,
  onBackToList,
  onOpenAllExams,
  isArchivedView = false,
}: StudentCourseDetailsViewProps) {
  const [assessmentFilter, setAssessmentFilter] = useState<string>('all');
  const [busyTermId, setBusyTermId] = useState<string | null>(null);
  const todayIso = getTodayIsoLocal();

  const {
    attendance,
    categories,
    activity,
    totalEarnedPoints,
    maxPossiblePoints,
    remainingAvailablePoints,
    pointsNeededToPass,
    percentageAchieved,
    suggestedGrade,
    passedThreshold,
    officialFinalGrade,
    studentVisibleFinalGrade,
  } = summary;

  const regByTermId = useMemo(() => {
    const map = new Map<string, ExamRegistration>();
    for (const r of examRegistrations) {
      map.set(r.termId, r);
    }
    return map;
  }, [examRegistrations]);

  const upcomingOrOpenTerms = useMemo(() => {
    if (isArchivedView) return [];
    return [...courseExamTerms]
      .filter((t) => t.examDate >= todayIso)
      .sort((a, b) => a.examDate.localeCompare(b.examDate));
  }, [courseExamTerms, todayIso, isArchivedView]);

  const handleToggleExamReg = async (term: ExamTerm, status: ExamRegistrationStatus) => {
    setBusyTermId(term.id);
    try {
      const existing = regByTermId.get(term.id);
      await setStudentExamRegistration({
        term,
        studentProfile,
        status,
        existingRegistration: existing,
      });
      toast.success(
        status === ExamRegistrationStatus.REGISTERED
          ? `Uspješno ste prijavili ispit: ${term.title}.`
          : `Odjavili ste izlazak na ispit: ${term.title}.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri prijavi ispita.');
    } finally {
      setBusyTermId(null);
    }
  };

  // Visual Attendance Graph percentages across non-cancelled sessions
  const nonCancelledSessions = useMemo(
    () => attendance.sessions.filter((s) => s.state !== 'cancelled'),
    [attendance.sessions]
  );
  const totalGraphSessions = nonCancelledSessions.length;
  const presentShare =
    totalGraphSessions > 0
      ? Math.round((attendance.attendedCount / totalGraphSessions) * 100)
      : 0;
  const absentShare =
    totalGraphSessions > 0
      ? Math.round((attendance.absentCount / totalGraphSessions) * 100)
      : 0;
  const pendingOrFutureCount = attendance.futureCount + attendance.unrecordedCount;
  const pendingShare = Math.max(0, 100 - presentShare - absentShare);

  const visibleCategories = useMemo(() => {
    if (assessmentFilter === 'all') return categories;
    if (assessmentFilter === '__activity__') return [];
    return categories.filter((c) => c.category.id === assessmentFilter);
  }, [categories, assessmentFilter]);

  const showActivitySection =
    assessmentFilter === 'all' ||
    assessmentFilter === '__activity__' ||
    (activity.linkedCategoryId !== null && assessmentFilter === activity.linkedCategoryId);

  const assistantsText = formatCourseAssistants(course);

  return (
    <div className="space-y-6">
      {/* Top Back Navigation & Quick Sibling Course Switcher */}
      {(onBackToList || siblingEnrollments.length > 1) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {onBackToList ? (
            <button
              type="button"
              onClick={onBackToList}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap self-start"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              Nazad na pregled predmeta
            </button>
          ) : (
            <div />
          )}

          {onSelectCourse && siblingEnrollments.length > 1 && (
            <div className="flex items-center gap-2 text-xs self-start sm:self-auto">
              <span className="text-slate-500 whitespace-nowrap">Brzi prelaz:</span>
              <select
                value={course.id}
                onChange={(e) => onSelectCourse(e.target.value)}
                className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 max-w-xs"
              >
                {siblingEnrollments.map((enr) => (
                  <option key={enr.courseId} value={enr.courseId}>
                    {enr.courseCode} — {enr.courseName}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          1. COURSE HEADER
          ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 sm:p-6 space-y-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span className="font-mono font-bold text-blue-700">{course.code}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">Akademska {course.academicYear}</span>
            <span aria-hidden="true">·</span>
            <span>{course.semester}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono font-medium text-slate-700 tabular-nums">
              {course.ects} ECTS
            </span>
            {course.studyProgram && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-700 font-medium">{course.studyProgram}</span>
              </>
            )}
            {isArchivedView && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-slate-700">Arhivirana evidencija</span>
              </>
            )}
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            {course.name}
          </h2>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 pt-0.5">
            <span>
              {getCourseProfessors(course).length > 1 ? 'Profesori: ' : 'Profesor: '}
              <strong className="font-semibold text-slate-900">
                {formatCourseProfessors(course)}
              </strong>
            </span>
            {assistantsText && (
              <>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span>
                  Asistenti: <strong className="font-medium text-slate-800">{assistantsText}</strong>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Integrated Course Exam Terms Bar (if active course has upcoming/open exams) */}
        {upcomingOrOpenTerms.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50/70 px-5 sm:px-6 py-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <CalendarCheck2 className="w-4 h-4 text-blue-700 shrink-0" />
                <span>Aktivni i predstojeći ispitni rokovi na predmetu</span>
              </div>
              {onOpenAllExams && (
                <button
                  type="button"
                  onClick={onOpenAllExams}
                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer whitespace-nowrap"
                >
                  Sve prijave ispita
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-200/80">
              {upcomingOrOpenTerms.map((term) => {
                const win = getExamWindowState(term, todayIso);
                const reg = regByTermId.get(term.id);
                const isRegistered = reg?.status === ExamRegistrationStatus.REGISTERED;
                const isBusy = busyTermId === term.id;

                return (
                  <div
                    key={term.id}
                    className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="text-xs space-y-0.5 min-w-0">
                      <div className="font-semibold text-slate-900">{term.title}</div>
                      <div className="text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono tabular-nums">
                        <span>
                          Ispit: {formatBosnianDate(term.examDate)}
                          {term.examTime ? ` u ${term.examTime}` : ''}
                        </span>
                        {term.classroom && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-sans">{term.classroom}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>Prijava do: {formatBosnianDate(term.registrationCloseDate)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {isRegistered && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          Prijavljeno
                        </span>
                      )}

                      {win.canRegisterOrCancel ? (
                        isRegistered ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() =>
                              handleToggleExamReg(term, ExamRegistrationStatus.CANCELLED)
                            }
                            className="h-8 text-xs text-red-700 border-red-200 hover:bg-red-50 whitespace-nowrap"
                          >
                            {isBusy ? 'Odjava...' : 'Odjavi ispit'}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={isBusy}
                            onClick={() =>
                              handleToggleExamReg(term, ExamRegistrationStatus.REGISTERED)
                            }
                            className="h-8 text-xs whitespace-nowrap"
                          >
                            {isBusy ? 'Slanje...' : 'Prijavi ispit'}
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-slate-500 whitespace-nowrap">{win.label}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* =====================================================================
          2. POINTS OVERVIEW (Top Summary Card)
          ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          {/* Metric 1: Earned / Max Points */}
          <div className="p-5 space-y-2">
            <div className="text-xs font-medium text-slate-500">Ukupno osvojeni bodovi</div>
            <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
              <span className="text-2xl sm:text-3xl font-bold text-slate-900">
                {formatPoints(totalEarnedPoints)}
              </span>
              <span className="text-sm text-slate-500">
                / {formatPoints(maxPossiblePoints)} b
              </span>
            </div>
            <Progress
              value={percentageAchieved}
              indicatorClassName={passedThreshold ? 'bg-emerald-600' : 'bg-blue-700'}
            />
            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
              Ostvareno {percentageAchieved}% ukupnih bodova
            </div>
          </div>

          {/* Metric 2: Current / Official Grade */}
          <div className="p-5 space-y-1.5">
            <div className="text-xs font-medium text-slate-500">Status ocjene</div>
            {studentVisibleFinalGrade !== null ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-2xl sm:text-3xl font-bold text-emerald-700 tabular-nums">
                    Ocjena {studentVisibleFinalGrade}
                  </span>
                </div>
                <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <Award className="w-3.5 h-3.5 shrink-0" />
                  Zvanično zaključena ocjena
                </div>
                {officialFinalGrade?.comment && (
                  <p className="text-[11px] text-slate-600 pt-0.5 line-clamp-2">
                    Napomena: {officialFinalGrade.comment}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="font-mono text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
                  {suggestedGrade !== null ? `Prag za ${suggestedGrade}` : 'U toku'}
                </div>
                <div className="text-xs text-slate-600">
                  {suggestedGrade !== null
                    ? 'Dostignut bodovni prag · čeka zaključenje'
                    : 'Ocjena još nije zaključena'}
                </div>
              </>
            )}
          </div>

          {/* Metric 3: Pass Threshold */}
          <div className="p-5 space-y-1.5">
            <div className="text-xs font-medium text-slate-500">
              Prag prolaznosti (Ocjena 6)
            </div>
            <div className="font-mono text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
              {formatPoints(course.grade6Threshold)} b
            </div>
            {passedThreshold ? (
              <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Ostvaren prag za prolaz
              </div>
            ) : (
              <div className="text-xs text-slate-600 font-mono tabular-nums">
                Nedostaje još <strong>{formatPoints(pointsNeededToPass)} b</strong> do prolaza
              </div>
            )}
          </div>

          {/* Metric 4: Remaining Available Points */}
          <div className="p-5 space-y-1.5">
            <div className="text-xs font-medium text-slate-500">Preostali dostupni bodovi</div>
            <div className="font-mono text-2xl sm:text-3xl font-bold text-blue-700 tabular-nums">
              {formatPoints(remainingAvailablePoints)} b
            </div>
            <div className="text-xs text-slate-500 leading-snug">
              {remainingAvailablePoints > 0
                ? 'Iz još neocijenjenih provjera i preostalih obaveza'
                : 'Sve definisane obaveze su obračunate'}
            </div>
          </div>
        </div>

        {/* Grading Scale Strip (6 - 10) */}
        <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <span className="text-slate-500 font-medium">Bodovna skala predmeta:</span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums">
            {[
              { g: 6, min: course.grade6Threshold },
              { g: 7, min: course.grade7Threshold },
              { g: 8, min: course.grade8Threshold },
              { g: 9, min: course.grade9Threshold },
              { g: 10, min: course.grade10Threshold },
            ].map((tier, idx) => {
              const reached = totalEarnedPoints >= tier.min;
              return (
                <React.Fragment key={tier.g}>
                  {idx > 0 && (
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                  )}
                  <span
                    className={cn(
                      reached ? 'text-blue-800 font-bold' : 'text-slate-500'
                    )}
                  >
                    Ocjena {tier.g}: ≥{tier.min}b
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </section>

      {/* =====================================================================
          3. ATTENDANCE SECTION WITH VISUAL GRAPH
          ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Prisustvo nastavi i vizuelni pregled termina
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {course.attendanceEnabled
                ? `Bodovanje prisustva: maksimalno ${formatPoints(attendance.maxPoints)} bodova (proporcionalno održanim terminima)`
                : 'Prisustvo se na ovom predmetu vodi informativno i ne nosi bodove'}
            </p>
          </div>

          {course.attendanceEnabled && (
            <div className="font-mono text-sm font-bold text-slate-900 tabular-nums">
              {formatPoints(attendance.earnedPoints)} / {formatPoints(attendance.maxPoints)} b
              {attendance.percentage !== null ? ` (${attendance.percentage}%)` : ''}
            </div>
          )}
        </div>

        {!course.attendanceEnabled ? (
          <div className="p-6 flex items-center gap-3 text-xs text-slate-600">
            <Info className="w-4 h-4 text-slate-400 shrink-0" />
            <span>
              Predmetni nastavnik je isključio bodovanje prisustva za ovaj predmet — bodovi se ne
              oduzimaju.
            </span>
          </div>
        ) : (
          <div className="p-5 sm:p-6 space-y-6">
            {/* Numeric Summary + Proportional Visual Distribution Graph */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-5 grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] text-slate-500">Prisustvovao</div>
                  <div className="mt-0.5 font-mono text-xl font-bold text-emerald-700 tabular-nums">
                    {attendance.attendedCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] text-slate-500">Izostanci</div>
                  <div
                    className={cn(
                      'mt-0.5 font-mono text-xl font-bold tabular-nums',
                      attendance.absentCount > 0 ? 'text-red-700' : 'text-slate-900'
                    )}
                  >
                    {attendance.absentCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                  <div className="text-[11px] text-slate-500">Održano</div>
                  <div className="mt-0.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
                    {attendance.heldCount}
                  </div>
                </div>
              </div>

              {/* Visual Bar Graph */}
              <div className="lg:col-span-7 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">
                    Struktura svih zakazanih termina ({totalGraphSessions})
                  </span>
                  <span className="font-mono text-slate-600 tabular-nums">
                    {attendance.heldCount > 0
                      ? `${attendance.percentage ?? 0}% prisustva na održanim terminima`
                      : 'Nema održanih termina'}
                  </span>
                </div>

                {totalGraphSessions === 0 ? (
                  <div className="h-4 w-full rounded-md bg-slate-100" />
                ) : (
                  <div
                    className="h-4 w-full rounded-md bg-slate-100 overflow-hidden flex"
                    role="img"
                    aria-label={`Prisutan ${attendance.attendedCount}, odsutan ${attendance.absentCount}, ostalo ${pendingOrFutureCount}`}
                  >
                    {attendance.attendedCount > 0 && (
                      <div
                        className="bg-emerald-600 h-full transition-opacity"
                        style={{
                          width: `${(attendance.attendedCount / totalGraphSessions) * 100}%`,
                        }}
                        title={`Prisutan: ${attendance.attendedCount}`}
                      />
                    )}
                    {attendance.absentCount > 0 && (
                      <div
                        className="bg-red-500 h-full transition-opacity"
                        style={{
                          width: `${(attendance.absentCount / totalGraphSessions) * 100}%`,
                        }}
                        title={`Odsutan: ${attendance.absentCount}`}
                      />
                    )}
                    {pendingOrFutureCount > 0 && (
                      <div
                        className="bg-slate-300 h-full transition-opacity"
                        style={{
                          width: `${(pendingOrFutureCount / totalGraphSessions) * 100}%`,
                        }}
                        title={`Budući ili neevidentirani: ${pendingOrFutureCount}`}
                      />
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 shrink-0" />
                    <span className="font-sans">Prisutan:</span> {attendance.attendedCount} (
                    {presentShare}%)
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-red-500 shrink-0" />
                    <span className="font-sans">Odsutan:</span> {attendance.absentCount} (
                    {absentShare}%)
                  </span>
                  {pendingOrFutureCount > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 shrink-0" />
                      <span className="font-sans">Budući / u čekanju:</span> {pendingOrFutureCount}{' '}
                      ({pendingShare}%)
                    </span>
                  )}
                </div>

                {/* Session-by-session Visual Timeline */}
                {nonCancelledSessions.length > 0 && (
                  <div className="pt-1">
                    <div className="text-[11px] text-slate-500 mb-1.5">
                      Hronološki niz termina po sedmicama:
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {nonCancelledSessions.map((row, index) => {
                        const stateStyle =
                          row.state === 'present'
                            ? 'bg-emerald-600 text-white'
                            : row.state === 'absent'
                              ? 'bg-red-600 text-white'
                              : row.state === 'future'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-slate-100 text-slate-500 border border-slate-200';
                        const stateText =
                          row.state === 'present'
                            ? 'Prisutan'
                            : row.state === 'absent'
                              ? 'Odsutan'
                              : row.state === 'future'
                                ? 'Budući termin'
                                : 'Čeka evidenciju';
                        return (
                          <div
                            key={row.session.id}
                            title={`Termin ${index + 1} (${formatBosnianDate(row.session.date)}): ${stateText}`}
                            className={cn(
                              'h-7 min-w-7 px-1.5 rounded text-[11px] font-mono font-semibold tabular-nums inline-flex items-center justify-center',
                              stateStyle
                            )}
                          >
                            T{index + 1}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Session History Table */}
            {attendance.sessions.length > 0 && (
              <div className="border-t border-slate-200 pt-4">
                <div className="text-xs font-semibold text-slate-700 mb-2.5">
                  Detaljna evidencija održanih i zakazanih termina
                </div>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="text-left py-2.5 px-4 whitespace-nowrap">Datum i vrijeme</th>
                        <th className="text-left py-2.5 px-4">Tema / Opis termina</th>
                        <th className="text-left py-2.5 px-4">Status</th>
                        <th className="text-left py-2.5 px-4">Napomena</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {attendance.sessions.map((row) => (
                        <tr key={row.session.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4 whitespace-nowrap font-mono text-xs tabular-nums text-slate-900">
                            {formatBosnianDate(row.session.date)}
                            {row.session.time ? ` · ${row.session.time}` : ''}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-800">
                            {row.session.topic || 'Redovni termin nastave'}
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap text-xs font-medium">
                            {row.state === 'present' && (
                              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                Prisutan
                              </span>
                            )}
                            {row.state === 'absent' && (
                              <span className="inline-flex items-center gap-1.5 text-red-700">
                                <XCircle className="w-3.5 h-3.5 shrink-0" />
                                Odsutan
                              </span>
                            )}
                            {row.state === 'cancelled' && (
                              <span className="inline-flex items-center gap-1.5 text-slate-500">
                                <MinusCircle className="w-3.5 h-3.5 shrink-0" />
                                Otkazan termin
                              </span>
                            )}
                            {row.state === 'future' && (
                              <span className="inline-flex items-center gap-1.5 text-blue-700">
                                <Clock className="w-3.5 h-3.5 shrink-0" />
                                Budući termin
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
              </div>
            )}
          </div>
        )}
      </section>

      {/* =====================================================================
          4. CATEGORIZED ASSESSMENTS & ACTIVITY POINTS
          ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Kategorije provjera znanja, zadaće, ispiti i bodovi za aktivnost
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Neocijenjene obaveze su prikazane sa „—“ i ne prikazuju se kao 0 bodova dok nastavnik
              ne upiše rezultat.
            </p>
          </div>

          {categories.length > 0 && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => setAssessmentFilter('all')}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  assessmentFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                Sve obaveze
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.category.id}
                  type="button"
                  onClick={() => setAssessmentFilter(cat.category.id)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
                    assessmentFilter === cat.category.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {cat.category.name}
                </button>
              ))}
              {activity.linkedCategoryId === null && (
                <button
                  type="button"
                  onClick={() => setAssessmentFilter('__activity__')}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
                    assessmentFilter === '__activity__'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  Aktivnost ({activity.awards.length})
                </button>
              )}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="text-left py-2.5 px-5">Kategorija / Stavka provjere</th>
                <th className="text-left py-2.5 px-4 whitespace-nowrap">Datum</th>
                <th className="text-right py-2.5 px-4 whitespace-nowrap">Osvojeno</th>
                <th className="text-right py-2.5 px-4 whitespace-nowrap">Maksimum</th>
                <th className="text-left py-2.5 px-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleCategories.map((catBreakdown, idx) => {
                const isLinkedActivityCategory =
                  activity.linkedCategoryId === catBreakdown.category.id;
                return (
                  <React.Fragment key={catBreakdown.category.id}>
                    <tr className="bg-slate-50/75">
                      <td className="py-3 px-5 font-semibold text-slate-900" colSpan={2}>
                        {idx + 1}. {catBreakdown.category.name}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                        {formatPoints(catBreakdown.earnedPoints)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums">
                        {formatPoints(catBreakdown.maxPoints)}
                      </td>
                      <td className="py-3 px-5 font-mono text-xs text-slate-600 tabular-nums">
                        {catBreakdown.percentage}% kategorije
                      </td>
                    </tr>

                    {catBreakdown.items.map((row) => (
                      <tr key={row.item.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-5 pl-8">
                          <div className="font-medium text-slate-900">{row.item.name}</div>
                          {row.item.description && (
                            <div className="text-xs text-slate-500 mt-0.5">
                              {row.item.description}
                            </div>
                          )}
                          {row.feedback && (
                            <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-blue-700">
                              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                              <span>{row.feedback}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-slate-600 tabular-nums">
                          {row.item.date ? formatBosnianDate(row.item.date) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {row.graded ? formatPoints(row.earnedPoints) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums">
                          {formatPoints(row.maxPoints)}
                        </td>
                        <td className="py-3 px-5 text-xs whitespace-nowrap">
                          {!row.graded ? (
                            <span className="text-slate-400">Nije ocijenjeno</span>
                          ) : (row.earnedPoints ?? 0) >= row.maxPoints * 0.5 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              Ocijenjeno
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              Ocijenjeno
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}

                    {/* If Activity Awards are absorbed into this "Aktivnost" category, display them directly underneath */}
                    {isLinkedActivityCategory &&
                      activity.awards.map(({ award, effectivePoints }) => (
                        <tr key={award.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-5 pl-8">
                            <div className="font-medium text-slate-900 flex items-center gap-1.5">
                              <Star className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                              <span>{award.description}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-slate-600 tabular-nums">
                            {formatBosnianDate(award.date)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                            +{formatPoints(effectivePoints)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums">
                            {award.maxPoints > 0 ? formatPoints(award.maxPoints) : 'Bonus'}
                          </td>
                          <td className="py-3 px-5 text-xs text-emerald-700 font-medium whitespace-nowrap">
                            Dodijeljeno za aktivnost
                          </td>
                        </tr>
                      ))}

                    {catBreakdown.items.length === 0 &&
                      (!isLinkedActivityCategory || activity.awards.length === 0) && (
                        <tr>
                          <td
                            className="py-3 px-5 pl-8 text-xs text-slate-400 italic"
                            colSpan={5}
                          >
                            Nema evidentiranih stavki u ovoj kategoriji.
                          </td>
                        </tr>
                      )}
                  </React.Fragment>
                );
              })}

              {/* Standalone Activity Points Section (when not linked to an "Aktivnost" category) */}
              {showActivitySection && activity.linkedCategoryId === null && (
                <>
                  <tr className="bg-slate-50/75">
                    <td className="py-3 px-5 font-semibold text-slate-900" colSpan={2}>
                      <span className="inline-flex items-center gap-1.5">
                        <Star className="w-4 h-4 text-amber-600 shrink-0" />
                        Bodovi za aktivnost na nastavi i vježbama
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700 tabular-nums">
                      {activity.awards.length > 0
                        ? `+${formatPoints(activity.earnedPoints)}`
                        : '0'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums">
                      {activity.maxPoints > 0 ? formatPoints(activity.maxPoints) : 'Bonus'}
                    </td>
                    <td className="py-3 px-5 text-xs text-slate-600 font-mono tabular-nums">
                      {activity.awards.length}{' '}
                      {activity.awards.length === 1 ? 'dodjela' : 'dodjele'}
                    </td>
                  </tr>

                  {activity.awards.length === 0 ? (
                    <tr>
                      <td className="py-3 px-5 pl-8 text-xs text-slate-500" colSpan={5}>
                        Još nema dodijeljenih bodova za aktivnost na ovom predmetu.
                      </td>
                    </tr>
                  ) : (
                    activity.awards.map(({ award, effectivePoints }) => (
                      <tr key={award.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-5 pl-8">
                          <div className="font-medium text-slate-900">{award.description}</div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-slate-600 tabular-nums">
                          {formatBosnianDate(award.date)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                          +{formatPoints(effectivePoints)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums">
                          {award.maxPoints > 0 ? formatPoints(award.maxPoints) : '—'}
                        </td>
                        <td className="py-3 px-5 text-xs whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Upisano u zbir
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </>
              )}

              {/* Final Verified Total Row */}
              {assessmentFilter === 'all' && (
                <tr className="bg-slate-900 text-white font-semibold">
                  <td className="py-3.5 px-5" colSpan={2}>
                    Ukupno bodova (Prisustvo + Kategorije + Aktivnost)
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-base tabular-nums">
                    {formatPoints(totalEarnedPoints)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-300 tabular-nums">
                    {formatPoints(maxPossiblePoints)}
                  </td>
                  <td className="py-3.5 px-5 font-mono text-xs text-slate-200 tabular-nums">
                    {percentageAchieved}% ostvareno
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
