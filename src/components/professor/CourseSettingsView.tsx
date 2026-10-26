import React, { useEffect, useState } from 'react';
import { Edit3, Link2, Plus, Save, Trash2, UserCheck, UserPlus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { isCourseActivityEnabled } from '../../lib/calculations';
import {
  getSemesterPresetsForProgram,
  STUDY_PROGRAM_GROUPS,
} from '../../lib/programs';
import {
  formatPoints,
  getCourseAssistants,
  getCourseProfessors,
} from '../../lib/utils';
import {
  createGradingCategory,
  deleteGradingCategory,
  linkCourseCoProfessorByUid,
  unlinkCourseCoProfessorUid,
  updateCourseSettings,
  updateCourseTeachingStaff,
  updateGradingCategory,
} from '../../services/zamioService';
import {
  Course,
  Enrollment,
  GradingCategory,
  GradingItem,
  Score,
} from '../../types/zamio';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Label } from '../ui/input';

interface CourseSettingsViewProps {
  course: Course;
  categories: GradingCategory[];
  items: GradingItem[];
  scores: Score[];
  enrollments?: Enrollment[];
}

export function CourseSettingsView({
  course,
  categories,
  items,
  scores,
  enrollments = [],
}: CourseSettingsViewProps) {
  const { profile, isAdminUser } = useAuth();
  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);

  const [name, setName] = useState(course.name);
  const [studyProgram, setStudyProgram] = useState(
    course.studyProgram || 'Bachelor · Računarstvo i informatika'
  );
  const [semester, setSemester] = useState(course.semester);
  const [academicYear, setAcademicYear] = useState(course.academicYear);
  const [ects, setEcts] = useState(String(course.ects));
  const [leadProfName, setLeadProfName] = useState(course.leadProfessorName);
  const [attendanceEnabled, setAttendanceEnabled] = useState(course.attendanceEnabled);
  const [attendanceMaxPoints, setAttendanceMaxPoints] = useState(
    String(course.attendanceMaxPoints)
  );
  const [allowBonusPoints, setAllowBonusPoints] = useState(course.allowBonusPoints);
  const [activityMarksEnabled, setActivityMarksEnabled] = useState(() =>
    isCourseActivityEnabled(course)
  );
  const [g6, setG6] = useState(String(course.grade6Threshold));
  const [g7, setG7] = useState(String(course.grade7Threshold));
  const [g8, setG8] = useState(String(course.grade8Threshold));
  const [g9, setG9] = useState(String(course.grade9Threshold));
  const [g10, setG10] = useState(String(course.grade10Threshold));
  const [savingSettings, setSavingSettings] = useState(false);

  // Teaching Staff State (1 or more Professors + Teaching Assistants)
  const [professorNames, setProfessorNames] = useState<string[]>(() =>
    getCourseProfessors(course)
  );
  const [assistantNames, setAssistantNames] = useState<string[]>(() =>
    getCourseAssistants(course)
  );
  const [newProfessorInput, setNewProfessorInput] = useState('');
  const [newAssistantInput, setNewAssistantInput] = useState('');
  const [coProfessorUidInput, setCoProfessorUidInput] = useState('');
  const [staffBusy, setStaffBusy] = useState(false);

  // Category Modal
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<GradingCategory | null>(null);
  const [catName, setCatName] = useState('');
  const [catMaxPoints, setCatMaxPoints] = useState('20');
  const [catOrder, setCatOrder] = useState('1');
  const [savingCat, setSavingCat] = useState(false);

  const [deleteCatTarget, setDeleteCatTarget] = useState<GradingCategory | null>(null);

  useEffect(() => {
    setName(course.name);
    setStudyProgram(course.studyProgram || 'Bachelor · Računarstvo i informatika');
    setSemester(course.semester);
    setAcademicYear(course.academicYear);
    setEcts(String(course.ects));
    setLeadProfName(course.leadProfessorName);
    setProfessorNames(getCourseProfessors(course));
    setAssistantNames(getCourseAssistants(course));
    setAttendanceEnabled(course.attendanceEnabled);
    setAttendanceMaxPoints(String(course.attendanceMaxPoints));
    setAllowBonusPoints(course.allowBonusPoints);
    setActivityMarksEnabled(isCourseActivityEnabled(course));
    setG6(String(course.grade6Threshold));
    setG7(String(course.grade7Threshold));
    setG8(String(course.grade8Threshold));
    setG9(String(course.grade9Threshold));
    setG10(String(course.grade10Threshold));
  }, [course]);

  const canManageLinkedProfessorAccounts =
    isAdminUser || (Boolean(profile?.uid) && course.leadProfessorId === profile?.uid);

  const linkedCoProfessorIds = course.professorIds.filter(
    (uid) => uid !== course.leadProfessorId
  );

  const categoriesTotalMax = sortedCategories.reduce((acc, c) => acc + c.maxPoints, 0);
  const configuredCourseMax =
    (attendanceEnabled ? Number(attendanceMaxPoints || 0) : 0) + categoriesTotalMax;

  const persistStaffChanges = async (
    nextProfs: string[],
    nextAssistants: string[],
    successMsg: string
  ) => {
    setStaffBusy(true);
    try {
      await updateCourseTeachingStaff({
        course,
        professorNames: nextProfs,
        assistantNames: nextAssistants,
        enrollments,
      });
      setProfessorNames(nextProfs);
      setAssistantNames(nextAssistants);
      setLeadProfName(nextProfs[0] || course.leadProfessorName);
      toast.success(successMsg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri ažuriranju nastavnog osoblja.');
    } finally {
      setStaffBusy(false);
    }
  };

  const handleAddProfessorName = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newProfessorInput.trim();
    if (!clean) return;
    if (professorNames.some((p) => p.toLowerCase() === clean.toLowerCase())) {
      toast.error('Navedeni profesor je već dodan na ovaj predmet.');
      return;
    }
    const nextProfs = [...professorNames, clean];
    setNewProfessorInput('');
    await persistStaffChanges(
      nextProfs,
      assistantNames,
      `Profesor "${clean}" je dodan na predmet ${course.code}.`
    );
  };

  const handleRemoveProfessorName = async (idx: number) => {
    if (professorNames.length <= 1) {
      toast.error('Predmet mora imati najmanje jednog profesora.');
      return;
    }
    const removed = professorNames[idx];
    const nextProfs = professorNames.filter((_, i) => i !== idx);
    await persistStaffChanges(
      nextProfs,
      assistantNames,
      `Uklonjen profesor "${removed}" sa predmeta.`
    );
  };

  const handleAddAssistantName = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newAssistantInput.trim();
    if (!clean) return;
    if (assistantNames.some((a) => a.toLowerCase() === clean.toLowerCase())) {
      toast.error('Navedeni asistent je već evidentiran na ovom predmetu.');
      return;
    }
    const nextAssistants = [...assistantNames, clean];
    setNewAssistantInput('');
    await persistStaffChanges(
      professorNames,
      nextAssistants,
      `Asistent "${clean}" je dodan na predmet ${course.code}.`
    );
  };

  const handleRemoveAssistantName = async (idx: number) => {
    const removed = assistantNames[idx];
    const nextAssistants = assistantNames.filter((_, i) => i !== idx);
    await persistStaffChanges(
      professorNames,
      nextAssistants,
      `Asistent "${removed}" je uklonjen sa predmeta.`
    );
  };

  const handleLinkCoProfessorUid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid || !coProfessorUidInput.trim()) return;
    setStaffBusy(true);
    try {
      const addedName = await linkCourseCoProfessorByUid({
        course,
        coProfessorUid: coProfessorUidInput.trim(),
        actorUid: profile.uid,
        isAdminUser,
      });
      setCoProfessorUidInput('');
      toast.success(`Nalog ko-profesora (${addedName}) sada ima pristup uređivanju predmeta.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Neuspješno povezivanje ko-profesora.');
    } finally {
      setStaffBusy(false);
    }
  };

  const handleUnlinkCoProfessorUid = async (targetUid: string) => {
    if (!profile?.uid) return;
    setStaffBusy(true);
    try {
      await unlinkCourseCoProfessorUid({
        course,
        coProfessorUid: targetUid,
        actorUid: profile.uid,
        isAdminUser,
      });
      toast.success('Pristup ko-profesorskog naloga je uklonjen.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri uklanjanju pristupa.');
    } finally {
      setStaffBusy(false);
    }
  };

  const handleSaveCourseSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const syncedProfessors = [
        leadProfName.trim() || professorNames[0] || course.leadProfessorName,
        ...professorNames.slice(1),
      ];
      await updateCourseSettings(course.id, {
        name,
        studyProgram,
        semester,
        academicYear,
        ects: Number(ects),
        leadProfessorName: leadProfName,
        professorNames: syncedProfessors,
        assistantNames,
        attendanceEnabled,
        attendanceMaxPoints: attendanceEnabled ? Number(attendanceMaxPoints) : 0,
        allowBonusPoints,
        activityMarksEnabled,
        grade6Threshold: Number(g6),
        grade7Threshold: Number(g7),
        grade8Threshold: Number(g8),
        grade9Threshold: Number(g9),
        grade10Threshold: Number(g10),
      });
      toast.success('Postavke predmeta i pragovi ocjena su sačuvani.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju postavki.');
    } finally {
      setSavingSettings(false);
    }
  };

  const openNewCat = () => {
    setEditingCat(null);
    setCatName('');
    setCatMaxPoints('20');
    setCatOrder(String(sortedCategories.length + 1));
    setCatDialogOpen(true);
  };

  const openEditCat = (cat: GradingCategory) => {
    setEditingCat(cat);
    setCatName(cat.name);
    setCatMaxPoints(String(cat.maxPoints));
    setCatOrder(String(cat.order));
    setCatDialogOpen(true);
  };

  const handleSaveCat = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCat(true);
    try {
      if (editingCat) {
        await updateGradingCategory(editingCat.id, course.professorIds, {
          name: catName,
          maxPoints: Number(catMaxPoints),
          order: Number(catOrder),
        });
        toast.success('Kategorija je ažurirana.');
      } else {
        await createGradingCategory({
          course,
          name: catName,
          maxPoints: Number(catMaxPoints),
          order: Number(catOrder),
        });
        toast.success('Nova kategorija ocjenjivanja je dodana.');
      }
      setCatDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju kategorije.');
    } finally {
      setSavingCat(false);
    }
  };

  const handleConfirmDeleteCat = async () => {
    if (!deleteCatTarget) return;
    setSavingCat(true);
    try {
      const itemsInCategory = items.filter((i) => i.categoryId === deleteCatTarget.id);
      const itemIdSet = new Set(itemsInCategory.map((i) => i.id));
      const scoresInCategory = scores.filter((s) => itemIdSet.has(s.itemId));

      await deleteGradingCategory({
        course,
        categoryId: deleteCatTarget.id,
        itemsInCategory,
        scoresInCategory,
      });
      setDeleteCatTarget(null);
      toast.success('Kategorija ocjenjivanja je obrisana.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri brisanju kategorije.');
    } finally {
      setSavingCat(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Full-Width Panel: Multiple Professors & Teaching Assistants Management */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Nastavno osoblje na predmetu — Profesori i asistenti
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Svaki predmet može imati jednog ili više profesora te listu asistenata vidljivu
              studentima i nastavnicima.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            Profesori: {professorNames.length} · Asistenti: {assistantNames.length}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          {/* Left Half: Course Professors (1 or more) */}
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Profesori na predmetu ({professorNames.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Prvi profesor na listi vodi se kao odgovorni nastavnik predmeta.
              </p>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {professorNames.map((profName, idx) => (
                <div
                  key={`${profName}-${idx}`}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{profName}</div>
                    <div className="text-[11px] text-slate-500">
                      {idx === 0 ? 'Odgovorni nastavnik' : 'Ko-profesor na predmetu'}
                    </div>
                  </div>
                  {professorNames.length > 1 && (
                    <button
                      type="button"
                      disabled={staffBusy}
                      onClick={() => handleRemoveProfessorName(idx)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                      aria-label={`Ukloni profesora ${profName}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <form onSubmit={handleAddProfessorName} className="flex flex-col sm:flex-row gap-2">
              <Input
                value={newProfessorInput}
                onChange={(e) => setNewProfessorInput(e.target.value)}
                placeholder="npr. vanr. prof. dr. Dženana Đonko"
                maxLength={100}
                disabled={staffBusy}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={staffBusy || !newProfessorInput.trim()}
                className="shrink-0 h-9"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Dodaj profesora
              </Button>
            </form>

            {/* Optional Co-Professor Account UID Access Linking */}
            {canManageLinkedProfessorAccounts && (
              <div className="pt-3 border-t border-slate-100 space-y-2.5">
                <div className="text-xs text-slate-600">
                  <span className="font-medium text-slate-800">
                    Pristup drugom profesorskom nalogu (opciono):
                  </span>{' '}
                  Unesite Nastavnički ID kolege sa njegovog profila kako bi mogao unositi bodove i
                  ispitne rokove.
                </div>
                <form
                  onSubmit={handleLinkCoProfessorUid}
                  className="flex flex-col sm:flex-row gap-2"
                >
                  <Input
                    value={coProfessorUidInput}
                    onChange={(e) => setCoProfessorUidInput(e.target.value)}
                    placeholder="Nastavnički ID ko-profesora..."
                    className="font-mono text-xs h-8"
                    maxLength={128}
                    disabled={staffBusy}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={staffBusy || !coProfessorUidInput.trim()}
                    className="shrink-0 h-8"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    Poveži nalog
                  </Button>
                </form>

                {linkedCoProfessorIds.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {linkedCoProfessorIds.map((coUid) => (
                      <div
                        key={coUid}
                        className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-md"
                      >
                        <span className="inline-flex items-center gap-1.5 font-mono truncate">
                          <UserCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          Povezani ID: {coUid}
                        </span>
                        <button
                          type="button"
                          disabled={staffBusy}
                          onClick={() => handleUnlinkCoProfessorUid(coUid)}
                          className="text-red-700 hover:underline ml-2 shrink-0 cursor-pointer"
                        >
                          Ukloni pristup
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Half: Teaching Assistants */}
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Asistenti i saradnici na predmetu ({assistantNames.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Evidentirajte asistente koji vode tutorijale i laboratorijske vježbe na ovom
                predmetu.
              </p>
            </div>

            {assistantNames.length === 0 ? (
              <div className="py-6 px-4 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                Na ovom predmetu još nisu upisani asistenti. Dodajte ime i zvanje asistenta ispod.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {assistantNames.map((asstName, idx) => (
                  <div
                    key={`${asstName}-${idx}`}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{asstName}</div>
                      <div className="text-[11px] text-slate-500">
                        Asistent / Saradnik u nastavi
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={staffBusy}
                      onClick={() => handleRemoveAssistantName(idx)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                      aria-label={`Ukloni asistenta ${asstName}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleAddAssistantName} className="flex flex-col sm:flex-row gap-2">
              <Input
                value={newAssistantInput}
                onChange={(e) => setNewAssistantInput(e.target.value)}
                placeholder="npr. mr. Haris Šupić, dipl. el. ing."
                maxLength={100}
                disabled={staffBusy}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={staffBusy || !newAssistantInput.trim()}
                className="shrink-0 h-9"
              >
                <Plus className="w-3.5 h-3.5" />
                Dodaj asistenta
              </Button>
            </form>
          </div>
        </div>
      </section>

      {/* Bottom 12-Col Grid: Course Parameters + Grading Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Attendance, Thresholds & Course Parameters */}
        <form
          onSubmit={handleSaveCourseSettings}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6"
        >
          <div className="pb-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Pravila bodovanja i pragovi ocjena
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Ukupni konfigurisani maksimum predmeta:{' '}
                <strong className="font-mono text-slate-900 tabular-nums">
                  {formatPoints(configuredCourseMax)} bodova
                </strong>
              </p>
            </div>
            <span className="font-mono text-xs text-blue-700 font-semibold">{course.code}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label htmlFor="crs-name">Naziv predmeta</Label>
              <Input
                id="crs-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="crs-prog">Studijski program / Smjer predmeta</Label>
              <select
                id="crs-prog"
                value={studyProgram}
                onChange={(e) => {
                  const nextProg = e.target.value;
                  setStudyProgram(nextProg);
                  const presets = getSemesterPresetsForProgram(nextProg);
                  if (presets.length > 0) {
                    setSemester(presets[0].value);
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

            <div className="sm:col-span-2">
              <Label htmlFor="crs-sem">Semestar i godina studija</Label>
              <Input
                id="crs-sem"
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                maxLength={80}
                required
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {getSemesterPresetsForProgram(studyProgram).map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setSemester(preset.value)}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      semester === preset.value
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                    }`}
                  >
                    {preset.short}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="crs-ects">ECTS krediti</Label>
              <Input
                id="crs-ects"
                type="number"
                min="1"
                max="30"
                value={ects}
                onChange={(e) => setEcts(e.target.value)}
                className="font-mono tabular-nums"
                required
              />
            </div>

            <div>
              <Label htmlFor="crs-prof">Odgovorni nastavnik (prvi na listi)</Label>
              <Input
                id="crs-prof"
                value={leadProfName}
                onChange={(e) => setLeadProfName(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="crs-year">Akademska godina</Label>
              <Input
                id="crs-year"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="font-mono tabular-nums"
                required
              />
            </div>
          </div>

          {/* Attendance, Activity (+) & Bonus Configuration */}
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Prisustvo, tačke za aktivnost (+) i bonus bodovi
            </h3>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
              <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attendanceEnabled}
                  onChange={(e) => {
                    setAttendanceEnabled(e.target.checked);
                    if (e.target.checked && Number(attendanceMaxPoints) === 0) {
                      setAttendanceMaxPoints('10');
                    }
                  }}
                  className="rounded border-slate-300 text-blue-700"
                />
                <span>Uključi automatsko bodovanje prisustva</span>
              </label>

              {attendanceEnabled && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 whitespace-nowrap">Maks. bodova:</span>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={attendanceMaxPoints}
                    onChange={(e) => setAttendanceMaxPoints(e.target.value)}
                    className="w-20 h-8 font-mono text-right tabular-nums"
                  />
                </div>
              )}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1">
              <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activityMarksEnabled}
                  onChange={(e) => setActivityMarksEnabled(e.target.checked)}
                  className="rounded border-slate-300 text-blue-700"
                />
                <span className="font-medium">
                  Koristi tačke / pluseve za aktivnost na predmetu (+)
                </span>
              </label>
              <p className="text-xs text-slate-500 pl-6 leading-relaxed">
                Omogućava brzu evidenciju pluseva (+) svim izlistanim studentima za urađene vježbe
                bez obaveznog unosa bodova. Ako je isključeno, predmet nema sekciju za tačke
                aktivnosti.
              </p>
            </div>

            <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={allowBonusPoints}
                onChange={(e) => setAllowBonusPoints(e.target.checked)}
                className="rounded border-slate-300 text-blue-700"
              />
              <span>
                Dozvoli bonus bodove iznad maksimuma pojedinačnih stavki i kategorija
              </span>
            </label>
          </div>

          {/* Configurable Final Grade Thresholds */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Pragovi za zaključivanje konačne ocjene (6–10)
              </h3>
              <p className="text-xs text-slate-500">
                Minimalan broj ukupno ostvarenih bodova za svaku prolaznu ocjenu.
              </p>
            </div>

            <div className="grid grid-cols-5 gap-2.5">
              {[
                { label: 'Ocjena 6', val: g6, set: setG6 },
                { label: 'Ocjena 7', val: g7, set: setG7 },
                { label: 'Ocjena 8', val: g8, set: setG8 },
                { label: 'Ocjena 9', val: g9, set: setG9 },
                { label: 'Ocjena 10', val: g10, set: setG10 },
              ].map((item) => (
                <div key={item.label}>
                  <Label className="text-[11px]">{item.label}</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={item.val}
                    onChange={(e) => item.set(e.target.value)}
                    className="font-mono text-center px-2 tabular-nums"
                    required
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" disabled={savingSettings}>
              <Save className="w-4 h-4" />
              {savingSettings ? 'Čuvanje...' : 'Sačuvaj postavke predmeta'}
            </Button>
          </div>
        </form>

        {/* Right 5 Cols: Grading Categories Manager */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Kategorije ocjenjivanja</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Zbir kategorija:{' '}
                <span className="font-mono font-semibold tabular-nums">
                  {categoriesTotalMax} b
                </span>
                {attendanceEnabled && (
                  <>
                    {' '}
                    + Prisustvo{' '}
                    <span className="font-mono tabular-nums">{attendanceMaxPoints} b</span>
                  </>
                )}
              </p>
            </div>
            <Button size="sm" onClick={openNewCat}>
              <Plus className="w-3.5 h-3.5" />
              Dodaj
            </Button>
          </div>

          <div className="divide-y divide-slate-100">
            {attendanceEnabled && (
              <div className="px-5 py-3 bg-slate-50/70 flex items-center justify-between text-xs text-slate-600">
                <span>1. Prisustvo (automatska kategorija)</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatPoints(Number(attendanceMaxPoints))} b
                </span>
              </div>
            )}

            {sortedCategories.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Nema definisanih kategorija ocjenjivanja.
              </div>
            ) : (
              sortedCategories.map((cat) => {
                const catItems = items.filter((i) => i.categoryId === cat.id);
                const itemsSum = catItems.reduce((s, i) => s + i.maxPoints, 0);
                return (
                  <div
                    key={cat.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/60"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {cat.name}
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        Maks. {formatPoints(cat.maxPoints)} b · Stavki: {catItems.length} (zbir
                        stavki: {formatPoints(itemsSum)} b)
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditCat(cat)}
                        className="h-8 w-8"
                        aria-label="Uredi kategoriju"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteCatTarget(cat)}
                        className="h-8 w-8 text-red-700 hover:bg-red-50 hover:text-red-800"
                        aria-label="Obriši kategoriju"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Category Modal */}
          <Dialog
            open={catDialogOpen}
            onOpenChange={setCatDialogOpen}
            title={editingCat ? 'Uredi kategoriju' : 'Nova kategorija ocjenjivanja'}
          >
            <form onSubmit={handleSaveCat} className="space-y-4">
              <div>
                <Label htmlFor="cat-name">Naziv kategorije</Label>
                <Input
                  id="cat-name"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="npr. Zadaci, Vježbe, I parcijalni ispit"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="cat-max">Maksimalno bodova</Label>
                  <Input
                    id="cat-max"
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={catMaxPoints}
                    onChange={(e) => setCatMaxPoints(e.target.value)}
                    className="font-mono tabular-nums"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="cat-ord">Redoslijed prikaza</Label>
                  <Input
                    id="cat-ord"
                    type="number"
                    min="1"
                    max="50"
                    value={catOrder}
                    onChange={(e) => setCatOrder(e.target.value)}
                    className="font-mono tabular-nums"
                    required
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setCatDialogOpen(false)}>
                  Odustani
                </Button>
                <Button type="submit" disabled={savingCat}>
                  Sačuvaj
                </Button>
              </div>
            </form>
          </Dialog>

          {/* Confirm Delete Category */}
          <Dialog
            open={Boolean(deleteCatTarget)}
            onOpenChange={(o) => !o && setDeleteCatTarget(null)}
            title="Potvrda brisanja kategorije"
            description={`Brisanjem kategorije "${deleteCatTarget?.name}" obrisaćete i sve njene stavke ocjenjivanja te upisane bodove studenata u toj kategoriji.`}
          >
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeleteCatTarget(null)}>
                Odustani
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDeleteCat}
                disabled={savingCat}
              >
                Obriši kategoriju
              </Button>
            </div>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
