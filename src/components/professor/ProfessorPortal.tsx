import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  Download,
  Plus,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import {
  calculateCourseStudentSummary,
  CourseStudentSummary,
  getTodayIsoLocal,
} from '../../lib/calculations';
import {
  getCourseProgramCycle,
  getSemesterPresetsForProgram,
  STRUCNI_RS_PROGRAM,
  STUDY_PROGRAM_GROUPS,
  StudyCycleKey,
} from '../../lib/programs';
import {
  cn,
  downloadCsv,
  formatBosnianDate,
  formatCourseAssistants,
  formatCourseProfessors,
  formatPoints,
  getCourseAssistants,
  getCourseProfessors,
} from '../../lib/utils';
import {
  createCourse,
  enrollStudentByIndex,
  removeEnrollment,
  saveFinalGradeRecord,
  subscribeAcademicState,
  subscribeProfessorAllExamData,
  subscribeProfessorCourseData,
  subscribeProfessorCourses,
  subscribeProfessorScheduleEvents,
} from '../../services/zamioService';
import {
  AcademicState,
  ActivityAward,
  AttendanceRecord,
  AttendanceSession,
  Course,
  Enrollment,
  ExamRegistration,
  ExamRegistrationStatus,
  ExamTerm,
  FinalGrade,
  FinalGradeStatus,
  GradingCategory,
  GradingItem,
  ScheduleEvent,
  Score,
} from '../../types/zamio';
import { AnnouncementsView } from '../AnnouncementsView';
import { ProfessorNavKey } from '../AppShell';
import { ProfileView } from '../ProfileView';
import { ScheduleView } from '../ScheduleView';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Label } from '../ui/input';
import { AttendanceManagerView } from './AttendanceManagerView';
import { CourseSettingsView } from './CourseSettingsView';
import { ExamManagerView } from './ExamManagerView';
import { GradebookView } from './GradebookView';
import { ProfessorCourseSelector } from './ProfessorCourseSelector';

interface ProfessorPortalProps {
  activeNav: ProfessorNavKey;
  onNavigate: (nav: ProfessorNavKey) => void;
}

export function ProfessorPortal({ activeNav, onNavigate }: ProfessorPortalProps) {
  const { profile, isAdminUser } = useAuth();
  const professorUid = profile?.uid || '';

  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [academicState, setAcademicState] = useState<AcademicState | null>(null);
  const [showArchivedOnHome, setShowArchivedOnHome] = useState(false);

  // Exam terms, registrations & schedule events across all professor's courses
  const [examTerms, setExamTerms] = useState<ExamTerm[]>([]);
  const [examRegistrations, setExamRegistrations] = useState<ExamRegistration[]>([]);
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);

  // Active course relational collections
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [categories, setCategories] = useState<GradingCategory[]>([]);
  const [items, setItems] = useState<GradingItem[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [finalGrades, setFinalGrades] = useState<FinalGrade[]>([]);
  const [activityAwards, setActivityAwards] = useState<ActivityAward[]>([]);

  // Search, Filter & Sort on Student List / Course List
  const [courseSearch, setCourseSearch] = useState('');
  const [programFilter, setProgramFilter] = useState<StudyCycleKey>('all');
  const [studentSearch, setStudentSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState<'all' | 'passed' | 'below' | 'finalized'>(
    'all'
  );
  const [studentSort, setStudentSort] = useState<'name' | 'index' | 'total' | 'attendance'>(
    'total'
  );
  const [scheduleScope, setScheduleScope] = useState<'course' | 'all'>('course');

  // Create Course Modal
  const [newCourseOpen, setNewCourseOpen] = useState(false);
  const [newStudyProgram, setNewStudyProgram] = useState('Bachelor · Računarstvo i informatika');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newSemester, setNewSemester] = useState('Zimski semestar · II godina');
  const [newEcts, setNewEcts] = useState('6');
  const [newCoProfessors, setNewCoProfessors] = useState('');
  const [newAssistants, setNewAssistants] = useState('');
  const [newAttEnabled, setNewAttEnabled] = useState(true);
  const [newAttMax, setNewAttMax] = useState('10');
  const [creatingCourse, setCreatingCourse] = useState(false);

  // Enroll Student Modal
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [enrollIndexInput, setEnrollIndexInput] = useState('');
  const [enrollingBusy, setEnrollingBusy] = useState(false);
  const [unenrollTarget, setUnenrollTarget] = useState<Enrollment | null>(null);

  // Finalize Grade Modal
  const [gradeModalStudent, setGradeModalStudent] = useState<{
    enrollment: Enrollment;
    summary: CourseStudentSummary;
  } | null>(null);
  const [gradeValueInput, setGradeValueInput] = useState('6');
  const [gradeStatusInput, setGradeStatusInput] = useState<FinalGradeStatus>(
    FinalGradeStatus.FINALIZED
  );
  const [gradeCommentInput, setGradeCommentInput] = useState('');
  const [savingGrade, setSavingGrade] = useState(false);

  useEffect(() => {
    if (!professorUid) return;
    setLoadingCourses(true);

    const unsubCourses = subscribeProfessorCourses(professorUid, (list) => {
      const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'bs'));
      setCourses(sorted);
      setSelectedCourseId((prev) => {
        if (prev && sorted.some((c) => c.id === prev)) return prev;
        const firstActive = sorted.find((c) => !c.isArchived);
        return firstActive?.id || sorted[0]?.id || '';
      });
      setLoadingCourses(false);
    });

    const unsubExams = subscribeProfessorAllExamData(professorUid, {
      onExamTerms: setExamTerms,
      onExamRegistrations: setExamRegistrations,
    });

    const unsubSchedule = subscribeProfessorScheduleEvents(professorUid, setScheduleEvents);
    const unsubAcademic = subscribeAcademicState(setAcademicState);

    return () => {
      unsubCourses();
      unsubExams();
      unsubSchedule();
      unsubAcademic();
    };
  }, [professorUid]);

  useEffect(() => {
    if (!professorUid || !selectedCourseId) {
      setEnrollments([]);
      setCategories([]);
      setItems([]);
      setScores([]);
      setSessions([]);
      setAttendanceRecords([]);
      setFinalGrades([]);
      setActivityAwards([]);
      return;
    }

    const unsub = subscribeProfessorCourseData(professorUid, selectedCourseId, {
      onEnrollments: setEnrollments,
      onCategories: setCategories,
      onItems: setItems,
      onScores: setScores,
      onSessions: setSessions,
      onAttendanceRecords: setAttendanceRecords,
      onFinalGrades: setFinalGrades,
      onActivityAwards: setActivityAwards,
    });

    return () => unsub();
  }, [professorUid, selectedCourseId]);

  const activeSemesterCourses = useMemo(
    () => courses.filter((c) => !c.isArchived),
    [courses]
  );
  const archivedCourses = useMemo(
    () => courses.filter((c) => Boolean(c.isArchived)),
    [courses]
  );

  const activeCourse = courses.find((c) => c.id === selectedCourseId) || null;

  const studentSummaries = useMemo(() => {
    if (!activeCourse) return {};
    const map: Record<string, CourseStudentSummary> = {};
    for (const enr of enrollments) {
      const fg = finalGrades.find((g) => g.studentId === enr.studentId) || null;
      map[enr.studentId] = calculateCourseStudentSummary({
        course: activeCourse,
        categories,
        items,
        scores,
        sessions,
        attendanceRecords,
        activityAwards,
        finalGradeRecord: fg,
        studentId: enr.studentId,
      });
    }
    return map;
  }, [
    activeCourse,
    enrollments,
    categories,
    items,
    scores,
    sessions,
    attendanceRecords,
    activityAwards,
    finalGrades,
  ]);

  const activeCourseTerms = useMemo(() => {
    if (!activeCourse) return [];
    return examTerms
      .filter((t) => t.courseId === activeCourse.id)
      .sort((a, b) => a.examDate.localeCompare(b.examDate));
  }, [examTerms, activeCourse]);

  const nearestUpcomingTermInfo = useMemo(() => {
    if (activeCourseTerms.length === 0) return null;
    const today = getTodayIsoLocal();
    const term = activeCourseTerms.find((t) => t.examDate >= today) || activeCourseTerms[0];
    const registeredCount = examRegistrations.filter(
      (r) => r.termId === term.id && r.status === ExamRegistrationStatus.REGISTERED
    ).length;
    return { term, registeredCount };
  }, [activeCourseTerms, examRegistrations]);

  if (activeNav === 'profil') {
    return <ProfileView />;
  }

  if (activeNav === 'obavjestenja') {
    return <AnnouncementsView viewerMode="professor" canManage={false} />;
  }

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setCreatingCourse(true);
    try {
      const titlePrefix = profile.academicTitle?.trim() || 'dr.';
      const leadFormatted = profile.fullName.toLowerCase().startsWith(titlePrefix.toLowerCase())
        ? profile.fullName
        : `${titlePrefix} ${profile.fullName}`;

      const extraProfessors = newCoProfessors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const parsedAssistants = newAssistants
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const id = await createCourse({
        professorUid: profile.uid,
        professorName: leadFormatted,
        professorNames: [leadFormatted, ...extraProfessors],
        assistantNames: parsedAssistants,
        studyProgram: newStudyProgram,
        code: newCode,
        name: newName,
        semester: newSemester,
        academicYear: academicState?.activeAcademicYear || profile.academicYear || '2026/2027',
        ects: Number(newEcts),
        attendanceEnabled: newAttEnabled,
        attendanceMaxPoints: newAttEnabled ? Number(newAttMax) : 0,
      });
      setShowArchivedOnHome(false);
      setSelectedCourseId(id);
      setNewCourseOpen(false);
      setNewCode('');
      setNewName('');
      setNewCoProfessors('');
      setNewAssistants('');
      onNavigate('bodovi');
      toast.success('Novi predmet je uspješno kreiran.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri kreiranju predmeta.');
    } finally {
      setCreatingCourse(false);
    }
  };

  const handleEnrollStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCourse) return;
    setEnrollingBusy(true);
    try {
      const entry = await enrollStudentByIndex({
        course: activeCourse,
        studentIndex: enrollIndexInput,
      });
      setEnrollModalOpen(false);
      setEnrollIndexInput('');
      toast.success(`Student ${entry.fullName} (${entry.studentIndex}) je upisan na predmet.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Neuspješan upis studenta.');
    } finally {
      setEnrollingBusy(false);
    }
  };

  const handleConfirmUnenroll = async () => {
    if (!unenrollTarget) return;
    setEnrollingBusy(true);
    try {
      await removeEnrollment(unenrollTarget.id);
      setUnenrollTarget(null);
      toast.success('Student je uklonjen sa predmeta.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri ispisu studenta.');
    } finally {
      setEnrollingBusy(false);
    }
  };

  const openFinalizeModal = (enrollment: Enrollment, summary: CourseStudentSummary) => {
    const existing = summary.officialFinalGrade;
    const defaultGrade = existing ? existing.finalGrade : summary.suggestedGrade ?? 6;
    setGradeModalStudent({ enrollment, summary });
    setGradeValueInput(String(defaultGrade));
    setGradeStatusInput(existing ? existing.status : FinalGradeStatus.FINALIZED);
    setGradeCommentInput(existing?.comment || '');
  };

  const handleSaveFinalGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCourse || !gradeModalStudent) return;
    setSavingGrade(true);
    try {
      await saveFinalGradeRecord({
        course: activeCourse,
        studentId: gradeModalStudent.enrollment.studentId,
        totalPoints: gradeModalStudent.summary.totalEarnedPoints,
        finalGrade: Number(gradeValueInput),
        status: gradeStatusInput,
        comment: gradeCommentInput,
        professorUid,
        existingGrade: gradeModalStudent.summary.officialFinalGrade || undefined,
      });
      setGradeModalStudent(null);
      toast.success(
        gradeStatusInput === FinalGradeStatus.FINALIZED
          ? 'Konačna ocjena je zvanično zaključena.'
          : 'Ocjena je sačuvana kao nacrt.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju ocjene.');
    } finally {
      setSavingGrade(false);
    }
  };

  const handleExportCsv = () => {
    if (!activeCourse) return;
    const sortedCats = [...categories].sort((a, b) => a.order - b.order);
    const hasStandaloneActivity = Object.values(studentSummaries).some(
      (s) => s.activity.awards.length > 0 && !s.activity.linkedCategoryId
    );
    const headers = [
      'Broj indeksa',
      'Ime i prezime',
      'Odsjek',
      ...(activeCourse.attendanceEnabled
        ? [`Prisustvo (/${activeCourse.attendanceMaxPoints})`]
        : []),
      ...sortedCats.map((c) => `${c.name} (/${c.maxPoints})`),
      ...(hasStandaloneActivity ? ['Aktivnost'] : []),
      'Ukupno bodova',
      'Procenat (%)',
      'Konačna ocjena',
      'Status ocjene',
    ];

    const rows = enrollments
      .slice()
      .sort((a, b) => a.studentName.localeCompare(b.studentName, 'bs'))
      .map((enr) => {
        const sum = studentSummaries[enr.studentId];
        const catCells = sortedCats.map((c) => {
          const found = sum?.categories.find((cb) => cb.category.id === c.id);
          return found ? found.earnedPoints : 0;
        });
        return [
          enr.studentIndex,
          enr.studentName,
          enr.studentDepartment,
          ...(activeCourse.attendanceEnabled ? [sum?.attendance.earnedPoints ?? 0] : []),
          ...catCells,
          ...(hasStandaloneActivity ? [sum?.activity.earnedPoints ?? 0] : []),
          sum?.totalEarnedPoints ?? 0,
          sum?.percentageAchieved ?? 0,
          sum?.officialFinalGrade ? sum.officialFinalGrade.finalGrade : '—',
          sum?.officialFinalGrade?.status === FinalGradeStatus.FINALIZED
            ? 'Zaključena'
            : sum?.officialFinalGrade?.status === FinalGradeStatus.DRAFT
              ? 'Nacrt'
              : 'Nije zaključena',
        ];
      });

    downloadCsv(`VOLTRA_${activeCourse.code}_Ocjene.csv`, headers, rows);
    toast.success('CSV izvještaj ocjena je preuzet.');
  };

  const createCourseDialog = (
    <Dialog
      open={newCourseOpen}
      onOpenChange={setNewCourseOpen}
      title="Kreiraj novi predmet"
      description="Odaberite studijski program (Stručni studij Razvoj softvera 2 god., Bachelor ili jedan od 4 Master smjera) i unesite podatke o predmetu."
    >
      <form onSubmit={handleCreateCourse} className="space-y-4 text-left">
        <div>
          <Label htmlFor="crs-prog">Studijski program / Smjer</Label>
          <select
            id="crs-prog"
            value={newStudyProgram}
            onChange={(e) => {
              const nextProg = e.target.value;
              setNewStudyProgram(nextProg);
              const presets = getSemesterPresetsForProgram(nextProg);
              if (presets.length > 0) {
                setNewSemester(presets[0].value);
              }
            }}
            className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {STUDY_PROGRAM_GROUPS.map((grp) => (
              <optgroup key={grp.groupLabel} label={grp.groupLabel}>
                {grp.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="crs-c">Šifra predmeta</Label>
            <Input
              id="crs-c"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder={newStudyProgram === STRUCNI_RS_PROGRAM ? 'RS-RMW' : 'RI-BP'}
              className="font-mono"
              required
            />
          </div>
          <div>
            <Label htmlFor="crs-e">ECTS bodovi</Label>
            <Input
              id="crs-e"
              type="number"
              min="1"
              max="30"
              value={newEcts}
              onChange={(e) => setNewEcts(e.target.value)}
              className="font-mono tabular-nums"
              required
            />
          </div>
        </div>
        <div>
          <Label htmlFor="crs-n">Naziv predmeta</Label>
          <Input
            id="crs-n"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={
              newStudyProgram === STRUCNI_RS_PROGRAM
                ? 'Razvoj modernih web aplikacija'
                : 'Baze podataka'
            }
            required
          />
        </div>
        <div>
          <Label htmlFor="crs-s">Semestar i godina studija</Label>
          <Input
            id="crs-s"
            value={newSemester}
            onChange={(e) => setNewSemester(e.target.value)}
            maxLength={80}
            required
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {getSemesterPresetsForProgram(newStudyProgram).map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setNewSemester(preset.value)}
                className={cn(
                  'px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap',
                  newSemester === preset.value
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                )}
              >
                {preset.short}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="crs-coprofs">Dodatni profesori na predmetu (opciono, odvojeno zarezom)</Label>
          <Input
            id="crs-coprofs"
            value={newCoProfessors}
            onChange={(e) => setNewCoProfessors(e.target.value)}
            placeholder="npr. vanr. prof. dr. Dženana Đonko"
          />
        </div>
        <div>
          <Label htmlFor="crs-asst">Asistenti na predmetu (opciono, odvojeno zarezom)</Label>
          <Input
            id="crs-asst"
            value={newAssistants}
            onChange={(e) => setNewAssistants(e.target.value)}
            placeholder="npr. mr. Haris Šupić, dipl. el. ing. Maja Kovač"
          />
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={newAttEnabled}
              onChange={(e) => setNewAttEnabled(e.target.checked)}
            />
            <span>Uključi bodovanje prisustva (podrazumijevano 10 b)</span>
          </label>
          {newAttEnabled && (
            <Input
              type="number"
              min="0"
              max="100"
              value={newAttMax}
              onChange={(e) => setNewAttMax(e.target.value)}
              className="w-20 h-8 font-mono text-right tabular-nums"
            />
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setNewCourseOpen(false)}>
            Odustani
          </Button>
          <Button type="submit" disabled={creatingCourse}>
            {creatingCourse ? 'Kreiranje...' : 'Kreiraj predmet'}
          </Button>
        </div>
      </form>
    </Dialog>
  );

  if (loadingCourses) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 bg-white border border-slate-200 rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  // Empty state if professor has no courses yet
  if (courses.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-xl mx-auto my-8">
        <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h2 className="text-base font-semibold text-slate-900">
          Nemate dodijeljenih predmeta
        </h2>
        <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
          Kreirajte novi predmet kako biste započeli objavu rasporeda, ispitnih rokova, unos
          bodova, prisustva i upisanih studenata.
        </p>
        <div className="mt-5">
          <Button onClick={() => setNewCourseOpen(true)}>
            <Plus className="w-4 h-4" />
            Kreiraj prvi predmet
          </Button>
        </div>
        {createCourseDialog}
      </div>
    );
  }

  const activeCourseHeaderBar = activeCourse ? (
    <ProfessorCourseSelector
      activeCourse={activeCourse}
      activeSemesterCourses={activeSemesterCourses}
      archivedCourses={archivedCourses}
      showArchived={showArchivedOnHome}
      onToggleArchived={(nextShowArchived) => {
        setShowArchivedOnHome(nextShowArchived);
        if (nextShowArchived && archivedCourses[0]) {
          setSelectedCourseId(archivedCourses[0].id);
        } else if (!nextShowArchived && activeSemesterCourses[0]) {
          setSelectedCourseId(activeSemesterCourses[0].id);
        }
      }}
      selectedCourseId={selectedCourseId}
      onSelectCourse={setSelectedCourseId}
      onOpenNewCourse={() => setNewCourseOpen(true)}
      activeNav={activeNav}
      onNavigate={onNavigate}
      enrolledCount={enrollments.length}
      termsCount={activeCourseTerms.length}
      sessionsCount={sessions.length}
    />
  ) : null;

  // =========================================================================
  // VIEW: RASPORED NASTAVE, LABOVA, ISPITA I ROKOVA (Inside Course Workspace)
  // =========================================================================
  if (activeNav === 'raspored' && activeCourse) {
    const allTargetCourses =
      activeSemesterCourses.length > 0 ? activeSemesterCourses : courses;
    const targetCourses =
      scheduleScope === 'course' ? [activeCourse] : allTargetCourses;
    const activeCourseIdsSet = new Set(targetCourses.map((c) => c.id));
    return (
      <div className="space-y-5">
        {activeCourseHeaderBar}

        {allTargetCourses.length > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              Prikaz kalendara i termina nastave:
            </span>
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setScheduleScope('course')}
                className={cn(
                  'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap tabular-nums',
                  scheduleScope === 'course'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                Samo {activeCourse.code}
              </button>
              <button
                type="button"
                onClick={() => setScheduleScope('all')}
                className={cn(
                  'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap tabular-nums',
                  scheduleScope === 'all'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                Svi moji predmeti ({allTargetCourses.length})
              </button>
            </div>
          </div>
        )}

        <ScheduleView
          courses={targetCourses}
          scheduleEvents={scheduleEvents.filter((ev) => activeCourseIdsSet.has(ev.courseId))}
          examTerms={examTerms.filter((t) => activeCourseIdsSet.has(t.courseId))}
          gradingItems={scheduleScope === 'course' ? items : items}
          canEdit
        />
        {createCourseDialog}
      </div>
    );
  }

  // =========================================================================
  // VIEW: POČETNA — PREDMETI I BRZI PREGLED
  // =========================================================================
  if (activeNav === 'pocetna') {
    const basePool = showArchivedOnHome ? archivedCourses : activeSemesterCourses;
    const filteredCourses = basePool.filter((c) => {
      if (programFilter !== 'all' && getCourseProgramCycle(c) !== programFilter) {
        return false;
      }
      const q = courseSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.studyProgram || '').toLowerCase().includes(q) ||
        c.semester.toLowerCase().includes(q) ||
        formatCourseProfessors(c).toLowerCase().includes(q) ||
        formatCourseAssistants(c).toLowerCase().includes(q)
      );
    });

    const cycleCounts = {
      all: basePool.length,
      strucni_rs: basePool.filter((c) => getCourseProgramCycle(c) === 'strucni_rs').length,
      bachelor: basePool.filter((c) => getCourseProgramCycle(c) === 'bachelor').length,
      master: basePool.filter((c) => getCourseProgramCycle(c) === 'master').length,
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={courseSearch}
                onChange={(e) => setCourseSearch(e.target.value)}
                placeholder="Pretraži predmete, smjerove ili osoblje..."
                className="pl-9 bg-white"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { key: 'all', label: `Svi programi (${cycleCounts.all})` },
                  { key: 'strucni_rs', label: `Stručni RS · 2 god. (${cycleCounts.strucni_rs})` },
                  { key: 'bachelor', label: `Bachelor (${cycleCounts.bachelor})` },
                  { key: 'master', label: `Master smjerovi (${cycleCounts.master})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setProgramFilter(tab.key)}
                  className={cn(
                    'px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
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

          <div className="flex items-center gap-2 shrink-0 self-start lg:self-auto">
            {archivedCourses.length > 0 && (
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setShowArchivedOnHome(false);
                    if (activeSemesterCourses[0]) {
                      setSelectedCourseId(activeSemesterCourses[0].id);
                    }
                  }}
                  className={cn(
                    'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
                    !showArchivedOnHome
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  Aktivni ({activeSemesterCourses.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowArchivedOnHome(true);
                    if (archivedCourses[0]) {
                      setSelectedCourseId(archivedCourses[0].id);
                    }
                  }}
                  className={cn(
                    'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
                    showArchivedOnHome
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  Arhiva ({archivedCourses.length})
                </button>
              </div>
            )}

            <Button onClick={() => setNewCourseOpen(true)} size="sm">
              <Plus className="w-4 h-4" />
              Novi predmet
            </Button>
          </div>
        </div>

        {/* Courses Grid */}
        {filteredCourses.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
            <p className="text-sm text-slate-600">
              Nema predmeta za odabrani studijski program ili kriterij pretrage.
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              {programFilter !== 'all' && (
                <Button variant="outline" size="sm" onClick={() => setProgramFilter('all')}>
                  Prikaži sve programe
                </Button>
              )}
              <Button size="sm" onClick={() => setNewCourseOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                Dodaj predmet na ovaj smjer
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredCourses.map((crs) => {
              const crsTermsCount = examTerms.filter((t) => t.courseId === crs.id).length;
              const profList = getCourseProfessors(crs);
              const asstList = getCourseAssistants(crs);
              return (
                <button
                  key={crs.id}
                  type="button"
                  onClick={() => {
                    setSelectedCourseId(crs.id);
                    onNavigate('bodovi');
                  }}
                  className="group text-left bg-white rounded-xl p-5 border border-slate-200 hover:border-blue-500 transition-colors cursor-pointer flex flex-col justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono font-semibold text-blue-700">{crs.code}</span>
                      <span className="font-mono tabular-nums">
                        {crs.ects} ECTS · {crs.academicYear}
                        {crs.isArchived ? ' · Arhiva' : ''}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">
                      {crs.name}
                    </h3>
                    <div className="text-xs text-slate-500">
                      {crs.studyProgram ? (
                        <>
                          <span className="font-medium text-slate-700">{crs.studyProgram}</span>
                          <span aria-hidden="true"> · </span>
                        </>
                      ) : null}
                      <span>{crs.semester}</span>
                    </div>

                    <div className="pt-1.5 space-y-1 text-xs">
                      <div className="text-slate-600 line-clamp-2">
                        <span className="text-slate-400">
                          {profList.length > 1 ? 'Profesori: ' : 'Profesor: '}
                        </span>
                        <span className="font-medium text-slate-800">{profList.join(', ')}</span>
                      </div>
                      <div className="text-slate-500 line-clamp-2">
                        <span className="text-slate-400">Asistenti: </span>
                        <span>
                          {asstList.length > 0 ? asstList.join(', ') : 'Nisu upisani'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <span>
                        Rokovi:{' '}
                        <strong className="font-mono text-slate-900 tabular-nums">
                          {crsTermsCount}
                        </strong>
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span>
                        Prag:{' '}
                        <strong className="font-mono text-slate-900 tabular-nums">
                          {crs.grade6Threshold} b
                        </strong>
                      </span>
                    </div>

                    <span className="inline-flex items-center gap-1 font-semibold text-blue-700 whitespace-nowrap shrink-0">
                      <span>Otvori predmet</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {createCourseDialog}
      </div>
    );
  }

  // =========================================================================
  // VIEW: PRIJAVA ISPITA (Publish Exam Terms & Live Turnout Roster)
  // =========================================================================
  if (activeNav === 'ispiti' && activeCourse) {
    return (
      <div className="space-y-5">
        {activeCourseHeaderBar}
        <ExamManagerView
          course={activeCourse}
          professorUid={professorUid}
          enrollments={enrollments}
          examTerms={examTerms}
          examRegistrations={examRegistrations}
        />
        {createCourseDialog}
      </div>
    );
  }

  // =========================================================================
  // VIEW: UNOS BODOVA (Gradebook)
  // =========================================================================
  if (activeNav === 'bodovi' && activeCourse) {
    return (
      <div className="space-y-5">
        {activeCourseHeaderBar}
        <GradebookView
          course={activeCourse}
          professorUid={professorUid}
          enrollments={enrollments}
          categories={categories}
          items={items}
          scores={scores}
          activityAwards={activityAwards}
        />
        {createCourseDialog}
      </div>
    );
  }

  // =========================================================================
  // VIEW: PRISUSTVO (Attendance Manager)
  // =========================================================================
  if (activeNav === 'prisustvo' && activeCourse) {
    return (
      <div className="space-y-5">
        {activeCourseHeaderBar}
        <AttendanceManagerView
          course={activeCourse}
          professorUid={professorUid}
          enrollments={enrollments}
          sessions={sessions}
          records={attendanceRecords}
          onOpenSettings={() => onNavigate('postavke')}
        />
        {createCourseDialog}
      </div>
    );
  }

  // =========================================================================
  // VIEW: POSTAVKE PREDMETA (Course Settings)
  // =========================================================================
  if (activeNav === 'postavke' && activeCourse) {
    return (
      <div className="space-y-5">
        {activeCourseHeaderBar}
        <CourseSettingsView
          course={activeCourse}
          categories={categories}
          items={items}
          scores={scores}
          enrollments={enrollments}
        />
        {createCourseDialog}
      </div>
    );
  }

  // =========================================================================
  // VIEW: STUDENTI I OCJENE
  // =========================================================================
  const filteredAndSortedStudents = enrollments
    .filter((enr) => {
      const q = studentSearch.trim().toLowerCase();
      if (
        q &&
        !enr.studentName.toLowerCase().includes(q) &&
        !enr.studentIndex.toLowerCase().includes(q) &&
        !enr.studentDepartment.toLowerCase().includes(q)
      ) {
        return false;
      }
      const sum = studentSummaries[enr.studentId];
      if (!sum) return true;
      if (studentFilter === 'passed') return sum.passedThreshold;
      if (studentFilter === 'below') return !sum.passedThreshold;
      if (studentFilter === 'finalized') {
        return sum.officialFinalGrade?.status === FinalGradeStatus.FINALIZED;
      }
      return true;
    })
    .sort((a, b) => {
      const sumA = studentSummaries[a.studentId];
      const sumB = studentSummaries[b.studentId];
      if (studentSort === 'total') {
        return (sumB?.totalEarnedPoints ?? 0) - (sumA?.totalEarnedPoints ?? 0);
      }
      if (studentSort === 'attendance') {
        return (sumB?.attendance.earnedPoints ?? 0) - (sumA?.attendance.earnedPoints ?? 0);
      }
      if (studentSort === 'index') {
        return a.studentIndex.localeCompare(b.studentIndex, 'bs', { numeric: true });
      }
      return a.studentName.localeCompare(b.studentName, 'bs');
    });

  const isExamCategory = (catName: string) => {
    const low = catName.toLowerCase();
    return low.includes('ispit') || low.includes('parcijal') || low.includes('završ');
  };

  const avgPoints =
    enrollments.length > 0
      ? enrollments.reduce(
          (acc, e) => acc + (studentSummaries[e.studentId]?.totalEarnedPoints ?? 0),
          0
        ) / enrollments.length
      : 0;

  const passedCount = enrollments.filter(
    (e) => studentSummaries[e.studentId]?.passedThreshold
  ).length;

  return (
    <div className="space-y-5">
      {activeCourseHeaderBar}

      {activeCourse && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Upisani studenti</div>
            <div className="font-mono text-2xl font-bold text-slate-900 mt-1 tabular-nums">
              {enrollments.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Lista na predmetu</div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Izlaze na predstojeći ispit</div>
            {nearestUpcomingTermInfo ? (
              <>
                <div className="font-mono text-2xl font-bold text-blue-700 mt-1 tabular-nums">
                  {nearestUpcomingTermInfo.registeredCount} / {enrollments.length}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {nearestUpcomingTermInfo.term.title} (
                  {formatBosnianDate(nearestUpcomingTermInfo.term.examDate)})
                </div>
              </>
            ) : (
              <>
                <div className="font-mono text-2xl font-bold text-slate-400 mt-1">—</div>
                <button
                  type="button"
                  onClick={() => onNavigate('ispiti')}
                  className="text-[11px] text-blue-700 hover:underline mt-0.5 cursor-pointer"
                >
                  Objavi prvi ispitni rok
                </button>
              </>
            )}
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">
              Ostvarili prag ({activeCourse.grade6Threshold}b)
            </div>
            <div className="font-mono text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
              {passedCount} / {enrollments.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Kandidati za prolaznu ocjenu</div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Prosjek ostvarenih bodova</div>
            <div className="font-mono text-2xl font-bold text-slate-900 mt-1 tabular-nums">
              {formatPoints(avgPoints)} b
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
              Ukupno {items.length} stavki ocjenjivanja
            </div>
          </div>
        </div>
      )}

      {/* Search, Filter, Sort & Actions Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Ime studenta ili broj indeksa..."
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            {[
              { k: 'all', label: 'Svi' },
              { k: 'passed', label: 'Ostvarili prag' },
              { k: 'below', label: 'Ispod praga' },
              { k: 'finalized', label: 'Zaključeni' },
            ].map((f) => (
              <button
                key={f.k}
                type="button"
                onClick={() => setStudentFilter(f.k as typeof studentFilter)}
                className={cn(
                  'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  studentFilter === f.k
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            value={studentSort}
            onChange={(e) => setStudentSort(e.target.value as typeof studentSort)}
            className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700"
          >
            <option value="total">Sortiraj: Ukupno bodova</option>
            <option value="name">Sortiraj: Prezime i ime</option>
            <option value="index">Sortiraj: Broj indeksa</option>
            <option value="attendance">Sortiraj: Prisustvo</option>
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="w-3.5 h-3.5" />
            Izvezi CSV
          </Button>
          <Button size="sm" onClick={() => setEnrollModalOpen(true)}>
            <UserPlus className="w-3.5 h-3.5" />
            Upiši studenta
          </Button>
        </div>
      </div>

      {/* Enrolled Students Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredAndSortedStudents.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Nema studenata koji odgovaraju zadatom kriteriju pretrage.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="text-left py-3 px-4">Student</th>
                  <th className="text-left py-3 px-4 whitespace-nowrap">Indeks</th>
                  <th className="text-right py-3 px-4 whitespace-nowrap">Prisustvo</th>
                  <th className="text-right py-3 px-4 whitespace-nowrap">Zadaci / Vježbe</th>
                  <th className="text-right py-3 px-4 whitespace-nowrap">Ispiti</th>
                  <th className="text-right py-3 px-4 whitespace-nowrap">Ukupno</th>
                  <th className="text-left py-3 px-4 whitespace-nowrap">Konačna ocjena</th>
                  <th className="text-right py-3 px-4">Akcija</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAndSortedStudents.map((enr) => {
                  const sum = studentSummaries[enr.studentId];
                  const standaloneActPts =
                    sum && !sum.activity.linkedCategoryId ? sum.activity.earnedPoints : 0;
                  const courseworkPts =
                    (sum?.categories
                      .filter((c) => !isExamCategory(c.category.name))
                      .reduce((s, c) => s + c.earnedPoints, 0) ?? 0) + standaloneActPts;
                  const examPts =
                    sum?.categories
                      .filter((c) => isExamCategory(c.category.name))
                      .reduce((s, c) => s + c.earnedPoints, 0) ?? 0;

                  const fg = sum?.officialFinalGrade;
                  const isLockedForNonAdmin =
                    fg?.status === FinalGradeStatus.FINALIZED && !isAdminUser;

                  return (
                    <tr key={enr.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{enr.studentName}</div>
                        <div className="text-xs text-slate-500">{enr.studentDepartment}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums">
                        {enr.studentIndex}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-800">
                        {activeCourse?.attendanceEnabled && sum
                          ? `${formatPoints(sum.attendance.earnedPoints)} / ${formatPoints(sum.attendance.maxPoints)}`
                          : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-800">
                        {formatPoints(courseworkPts)}
                        {standaloneActPts > 0 && (
                          <div className="text-[11px] text-emerald-700">
                            uklj. +{formatPoints(standaloneActPts)} akt.
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-800">
                        {formatPoints(examPts)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                        {sum ? (
                          <span>
                            {formatPoints(sum.totalEarnedPoints)}{' '}
                            <span className="text-xs font-normal text-slate-400">
                              ({sum.percentageAchieved}%)
                            </span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        {fg?.status === FinalGradeStatus.FINALIZED ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold font-mono tabular-nums">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Ocjena {fg.finalGrade} (zaključena)
                          </span>
                        ) : fg?.status === FinalGradeStatus.DRAFT ? (
                          <span className="text-amber-700 font-medium font-mono tabular-nums">
                            Nacrt: {fg.finalGrade}
                          </span>
                        ) : sum?.suggestedGrade ? (
                          <span className="text-blue-700 font-mono tabular-nums">
                            Prijedlog: {sum.suggestedGrade}
                          </span>
                        ) : (
                          <span className="text-slate-400">Ispod praga</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {sum && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isLockedForNonAdmin}
                              onClick={() => openFinalizeModal(enr, sum)}
                            >
                              <Award className="w-3.5 h-3.5" />
                              {fg?.status === FinalGradeStatus.FINALIZED
                                ? isAdminUser
                                  ? 'Izmijeni'
                                  : 'Zaključeno'
                                : 'Ocjena'}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setUnenrollTarget(enr)}
                            className="h-8 w-8 text-slate-400 hover:text-red-700 hover:bg-red-50"
                            aria-label="Ispiši studenta"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Enroll Student by Index */}
      <Dialog
        open={enrollModalOpen}
        onOpenChange={setEnrollModalOpen}
        title="Upis studenta na predmet"
        description="Unesite broj indeksa registrovanog studenta (npr. 18942, 19014 ili indeks dodijeljen od strane administratora)."
      >
        <form onSubmit={handleEnrollStudent} className="space-y-4">
          <div>
            <Label htmlFor="enr-idx">Broj indeksa studenta</Label>
            <Input
              id="enr-idx"
              value={enrollIndexInput}
              onChange={(e) => setEnrollIndexInput(e.target.value)}
              placeholder="npr. 18942"
              className="font-mono"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEnrollModalOpen(false)}>
              Odustani
            </Button>
            <Button type="submit" disabled={enrollingBusy}>
              {enrollingBusy ? 'Upisivanje...' : 'Upiši na predmet'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal: Draft / Finalize Grade */}
      <Dialog
        open={Boolean(gradeModalStudent)}
        onOpenChange={(o) => !o && setGradeModalStudent(null)}
        title="Upis ili zaključivanje konačne ocjene"
        description={
          gradeModalStudent
            ? `${gradeModalStudent.enrollment.studentName} (${gradeModalStudent.enrollment.studentIndex}) — Ostvareno: ${formatPoints(gradeModalStudent.summary.totalEarnedPoints)} bodova`
            : ''
        }
      >
        <form onSubmit={handleSaveFinalGrade} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fg-val">Konačna ocjena (5–10)</Label>
              <select
                id="fg-val"
                value={gradeValueInput}
                onChange={(e) => setGradeValueInput(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900"
              >
                {[6, 7, 8, 9, 10, 5].map((g) => (
                  <option key={g} value={g}>
                    Ocjena {g} {g === 5 ? '(nije položio)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="fg-status">Status ocjene</Label>
              <select
                id="fg-status"
                value={gradeStatusInput}
                onChange={(e) => setGradeStatusInput(e.target.value as FinalGradeStatus)}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value={FinalGradeStatus.DRAFT}>Nacrt (nevidljivo studentu)</option>
                <option value={FinalGradeStatus.FINALIZED}>
                  Zaključena (zvanično vidljivo)
                </option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="fg-comm">Napomena uz ocjenu (opciono)</Label>
            <Input
              id="fg-comm"
              value={gradeCommentInput}
              onChange={(e) => setGradeCommentInput(e.target.value)}
              placeholder="npr. Uspješno položen završni ispit u prvom roku"
              maxLength={300}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setGradeModalStudent(null)}>
              Odustani
            </Button>
            <Button type="submit" disabled={savingGrade}>
              {savingGrade ? 'Čuvanje...' : 'Sačuvaj ocjenu'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal: Confirm Unenroll */}
      <Dialog
        open={Boolean(unenrollTarget)}
        onOpenChange={(o) => !o && setUnenrollTarget(null)}
        title="Uklanjanje studenta sa predmeta"
        description={`Želite li ukloniti studenta ${unenrollTarget?.studentName} (${unenrollTarget?.studentIndex}) sa predmeta ${activeCourse?.name}?`}
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setUnenrollTarget(null)}>
            Odustani
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirmUnenroll}
            disabled={enrollingBusy}
          >
            Ukloni sa predmeta
          </Button>
        </div>
      </Dialog>

      {createCourseDialog}
    </div>
  );
}
