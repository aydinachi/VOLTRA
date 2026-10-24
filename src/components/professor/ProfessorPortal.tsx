import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Download,
  Plus,
  Search,
  Settings,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import {
  calculateCourseStudentSummary,
  CourseStudentSummary,
} from '../../lib/calculations';
import { cn, downloadCsv, formatPoints } from '../../lib/utils';
import {
  createCourse,
  enrollStudentByIndex,
  removeEnrollment,
  saveFinalGradeRecord,
  subscribeProfessorCourseData,
  subscribeProfessorCourses,
} from '../../services/zamioService';
import {
  AttendanceRecord,
  AttendanceSession,
  Course,
  Enrollment,
  FinalGrade,
  FinalGradeStatus,
  GradingCategory,
  GradingItem,
  Score,
} from '../../types/zamio';
import { ProfessorNavKey } from '../AppShell';
import { ProfileView } from '../ProfileView';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Label } from '../ui/input';
import { AttendanceManagerView } from './AttendanceManagerView';
import { CourseSettingsView } from './CourseSettingsView';
import { GradebookView } from './GradebookView';

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

  // Active course relational collections
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [categories, setCategories] = useState<GradingCategory[]>([]);
  const [items, setItems] = useState<GradingItem[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [finalGrades, setFinalGrades] = useState<FinalGrade[]>([]);

  // Search, Filter & Sort on Student List / Course List
  const [courseSearch, setCourseSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState<'all' | 'passed' | 'below' | 'finalized'>('all');
  const [studentSort, setStudentSort] = useState<'name' | 'index' | 'total' | 'attendance'>('total');

  // Create Course Modal
  const [newCourseOpen, setNewCourseOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newSemester, setNewSemester] = useState('Zimski semestar · II godina');
  const [newEcts, setNewEcts] = useState('6');
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
    const unsub = subscribeProfessorCourses(professorUid, (list) => {
      const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'bs'));
      setCourses(sorted);
      setSelectedCourseId((prev) => {
        if (prev && sorted.some((c) => c.id === prev)) return prev;
        return sorted[0]?.id || '';
      });
      setLoadingCourses(false);
    });
    return () => unsub();
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
    });

    return () => unsub();
  }, [professorUid, selectedCourseId]);

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
    finalGrades,
  ]);

  if (activeNav === 'profil') {
    return <ProfileView />;
  }

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setCreatingCourse(true);
    try {
      const id = await createCourse({
        professorUid: profile.uid,
        professorName: `dr. ${profile.fullName}`,
        code: newCode,
        name: newName,
        semester: newSemester,
        academicYear: profile.academicYear || '2026/2027',
        ects: Number(newEcts),
        attendanceEnabled: newAttEnabled,
        attendanceMaxPoints: newAttEnabled ? Number(newAttMax) : 0,
      });
      setSelectedCourseId(id);
      setNewCourseOpen(false);
      setNewCode('');
      setNewName('');
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
    const defaultGrade = existing
      ? existing.finalGrade
      : summary.suggestedGrade ?? 6;
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
    const headers = [
      'Broj indeksa',
      'Ime i prezime',
      'Odsjek',
      ...(activeCourse.attendanceEnabled
        ? [`Prisustvo (/${activeCourse.attendanceMaxPoints})`]
        : []),
      ...sortedCats.map((c) => `${c.name} (/${c.maxPoints})`),
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

    downloadCsv(`Zamio_${activeCourse.code}_Ocjene.csv`, headers, rows);
    toast.success('CSV izvještaj ocjena je preuzet.');
  };

  if (loadingCourses) {
    return (
      <div className="space-y-4">
        <div className="h-12 w-72 bg-slate-200/70 rounded-lg animate-pulse" />
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

  const ActiveCourseHeaderBar = () => (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs text-slate-500">Aktivni predmet za upravljanje</div>
        {activeCourse ? (
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <span className="font-mono text-xs font-semibold text-blue-700">
              {activeCourse.code}
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="font-semibold text-slate-900">{activeCourse.name}</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="text-xs text-slate-500">
              Upisano studenata: <strong className="font-mono">{enrollments.length}</strong>
            </span>
          </div>
        ) : (
          <div className="text-sm text-slate-600">Nema izabranog predmeta</div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <select
          value={selectedCourseId}
          onChange={(e) => setSelectedCourseId(e.target.value)}
          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => setNewCourseOpen(true)}>
          <Plus className="w-3.5 h-3.5" />
          Novi predmet
        </Button>
      </div>
    </div>
  );

  // Empty state if professor has no courses yet
  if (courses.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-xl mx-auto my-8">
        <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h2 className="text-base font-semibold text-slate-900">
          Nemate dodijeljenih predmeta
        </h2>
        <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
          Kreirajte novi predmet kako biste započeli unos kategorija, zadataka, prisustva i
          upisanih studenata.
        </p>
        <div className="mt-5">
          <Button onClick={() => setNewCourseOpen(true)}>
            <Plus className="w-4 h-4" />
            Kreiraj prvi predmet
          </Button>
        </div>

        <Dialog
          open={newCourseOpen}
          onOpenChange={setNewCourseOpen}
          title="Kreiraj novi predmet"
        >
          <form onSubmit={handleCreateCourse} className="space-y-4 text-left">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="nc-code">Šifra predmeta</Label>
                <Input
                  id="nc-code"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="OR-AR"
                  className="font-mono"
                  required
                />
              </div>
              <div>
                <Label htmlFor="nc-ects">ECTS</Label>
                <Input
                  id="nc-ects"
                  type="number"
                  min="1"
                  max="30"
                  value={newEcts}
                  onChange={(e) => setNewEcts(e.target.value)}
                  className="font-mono"
                  required
                />
              </div>
            </div>
            <div>
              <Label htmlFor="nc-name">Naziv predmeta</Label>
              <Input
                id="nc-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Arhitektura računara"
                required
              />
            </div>
            <div>
              <Label htmlFor="nc-sem">Semestar</Label>
              <Input
                id="nc-sem"
                value={newSemester}
                onChange={(e) => setNewSemester(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setNewCourseOpen(false)}>
                Odustani
              </Button>
              <Button type="submit" disabled={creatingCourse}>
                Kreiraj predmet
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    );
  }

  // =========================================================================
  // VIEW: POČETNA & MOJI PREDMETI
  // =========================================================================
  if (activeNav === 'pocetna' || activeNav === 'predmeti') {
    const filteredCourses = courses.filter((c) => {
      const q = courseSearch.trim().toLowerCase();
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
    });

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
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={courseSearch}
              onChange={(e) => setCourseSearch(e.target.value)}
              placeholder="Pretraži dodijeljene predmete..."
              className="pl-9 bg-white"
            />
          </div>
          <Button onClick={() => setNewCourseOpen(true)} size="sm">
            <Plus className="w-4 h-4" />
            Novi predmet
          </Button>
        </div>

        {/* Courses Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filteredCourses.map((crs) => {
            const isSel = crs.id === selectedCourseId;
            return (
              <div
                key={crs.id}
                onClick={() => setSelectedCourseId(crs.id)}
                className={cn(
                  'bg-white rounded-xl p-5 border transition-colors cursor-pointer flex flex-col justify-between gap-4',
                  isSel
                    ? 'border-blue-600 ring-1 ring-blue-600'
                    : 'border-slate-200 hover:border-slate-300'
                )}
              >
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-mono font-semibold text-blue-700">{crs.code}</span>
                    <span>{crs.ects} ECTS · {crs.academicYear}</span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 mt-1">{crs.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{crs.semester}</p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                  <span>
                    Prisustvo:{' '}
                    <strong className="font-mono text-slate-900">
                      {crs.attendanceEnabled ? `${crs.attendanceMaxPoints} b` : 'Isključeno'}
                    </strong>
                  </span>
                  <span>
                    Prag prolaza:{' '}
                    <strong className="font-mono text-slate-900">{crs.grade6Threshold} b</strong>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Workspace Summary for Active Course */}
        {activeCourse && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <div className="text-xs text-slate-500">Brzi pregled izabranog predmeta</div>
                <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                  {activeCourse.code} — {activeCourse.name}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => onNavigate('studenti')}>
                  <Users className="w-3.5 h-3.5" />
                  Studenti ({enrollments.length})
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onNavigate('bodovi')}>
                  <ClipboardList className="w-3.5 h-3.5" />
                  Evidencija bodova
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onNavigate('prisustvo')}>
                  <CalendarCheck className="w-3.5 h-3.5" />
                  Prisustvo ({sessions.length})
                </Button>
                <Button variant="outline" size="sm" onClick={() => onNavigate('postavke')}>
                  <Settings className="w-3.5 h-3.5" />
                  Postavke
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="border border-slate-200 rounded-lg p-3.5">
                <div className="text-xs text-slate-500">Upisani studenti</div>
                <div className="font-mono text-xl font-bold text-slate-900 mt-1 tabular-nums">
                  {enrollments.length}
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3.5">
                <div className="text-xs text-slate-500">Prosjek ostvarenih bodova</div>
                <div className="font-mono text-xl font-bold text-slate-900 mt-1 tabular-nums">
                  {formatPoints(avgPoints)} b
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3.5">
                <div className="text-xs text-slate-500">Ostvarili prag ({activeCourse.grade6Threshold}b)</div>
                <div className="font-mono text-xl font-bold text-emerald-700 mt-1 tabular-nums">
                  {passedCount} / {enrollments.length}
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3.5">
                <div className="text-xs text-slate-500">Stavke ocjenjivanja</div>
                <div className="font-mono text-xl font-bold text-slate-900 mt-1 tabular-nums">
                  {items.length}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create Course Modal */}
        <Dialog
          open={newCourseOpen}
          onOpenChange={setNewCourseOpen}
          title="Kreiraj novi predmet"
          description="Unesite osnovne podatke o predmetu. Kategorije i pragove možete detaljno prilagoditi u postavkama."
        >
          <form onSubmit={handleCreateCourse} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="crs-c">Šifra predmeta</Label>
                <Input
                  id="crs-c"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="RI-BP"
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
                  className="font-mono"
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
                placeholder="Baze podataka"
                required
              />
            </div>
            <div>
              <Label htmlFor="crs-s">Semestar</Label>
              <Input
                id="crs-s"
                value={newSemester}
                onChange={(e) => setNewSemester(e.target.value)}
                required
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
                  className="w-20 h-8 font-mono text-right"
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
      </div>
    );
  }

  // =========================================================================
  // VIEW: EVIDENCIJA BODOVA (Gradebook)
  // =========================================================================
  if (activeNav === 'bodovi' && activeCourse) {
    return (
      <div className="space-y-5">
        <ActiveCourseHeaderBar />
        <GradebookView
          course={activeCourse}
          professorUid={professorUid}
          enrollments={enrollments}
          categories={categories}
          items={items}
          scores={scores}
        />
      </div>
    );
  }

  // =========================================================================
  // VIEW: PRISUSTVO (Attendance Manager)
  // =========================================================================
  if (activeNav === 'prisustvo' && activeCourse) {
    return (
      <div className="space-y-5">
        <ActiveCourseHeaderBar />
        <AttendanceManagerView
          course={activeCourse}
          professorUid={professorUid}
          enrollments={enrollments}
          sessions={sessions}
          records={attendanceRecords}
          onOpenSettings={() => onNavigate('postavke')}
        />
      </div>
    );
  }

  // =========================================================================
  // VIEW: POSTAVKE PREDMETA (Course Settings)
  // =========================================================================
  if (activeNav === 'postavke' && activeCourse) {
    return (
      <div className="space-y-5">
        <ActiveCourseHeaderBar />
        <CourseSettingsView
          course={activeCourse}
          categories={categories}
          items={items}
          scores={scores}
        />
      </div>
    );
  }

  // =========================================================================
  // VIEW: STUDENTI (Student List, Search/Sort/Filter, Enroll, CSV Export & Finalize Grades)
  // =========================================================================
  const filteredAndSortedStudents = enrollments
    .filter((enr) => {
      const q = studentSearch.trim().toLowerCase();
      if (
        q &&
        !enr.studentName.toLowerCase().includes(q) &&
        !enr.studentIndex.toLowerCase().includes(q)
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

  // Partition categories into Assignments/Exercises vs Exams/Other for summary columns
  const isExamCategory = (catName: string) => {
    const low = catName.toLowerCase();
    return low.includes('ispit') || low.includes('parcijal') || low.includes('završ');
  };

  return (
    <div className="space-y-5">
      <ActiveCourseHeaderBar />

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

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
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
                  'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap',
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
                  const courseworkPts =
                    sum?.categories
                      .filter((c) => !isExamCategory(c.category.name))
                      .reduce((s, c) => s + c.earnedPoints, 0) ?? 0;
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
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold font-mono">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Ocjena {fg.finalGrade} (zaključena)
                          </span>
                        ) : fg?.status === FinalGradeStatus.DRAFT ? (
                          <span className="text-amber-700 font-medium font-mono">
                            Nacrt: {fg.finalGrade}
                          </span>
                        ) : sum?.suggestedGrade ? (
                          <span className="text-blue-700 font-mono">
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
        description="Unesite broj indeksa registrovanog studenta (npr. 18942, 19014 ili broj koji je student unio na svom profilu)."
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
    </div>
  );
}
