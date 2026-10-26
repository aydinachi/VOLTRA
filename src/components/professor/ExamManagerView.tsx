import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  FileSpreadsheet,
  Lock,
  LockOpen,
  MapPin,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { addDaysIso, getExamWindowState, getTodayIsoLocal } from '../../lib/calculations';
import { cn, downloadCsv, formatBosnianDate } from '../../lib/utils';
import {
  createExamTerm,
  deleteExamTerm,
  setExamRegistrationByProfessor,
  toggleExamTermOpen,
  updateExamTerm,
} from '../../services/zamioService';
import {
  Course,
  Enrollment,
  ExamRegistration,
  ExamRegistrationStatus,
  ExamTerm,
} from '../../types/zamio';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Label, Textarea } from '../ui/input';

interface ExamManagerViewProps {
  course: Course;
  professorUid: string;
  enrollments: Enrollment[];
  examTerms: ExamTerm[];
  examRegistrations: ExamRegistration[];
}

const EXAM_TITLE_PRESETS = [
  'I parcijalni ispit',
  'II parcijalni ispit',
  'Završni ispit — I ispitni rok',
  'Završni ispit — II ispitni rok',
  'Popravni završni ispit',
];

export function ExamManagerView({
  course,
  professorUid,
  enrollments,
  examTerms,
  examRegistrations,
}: ExamManagerViewProps) {
  const courseTerms = useMemo(
    () =>
      examTerms
        .filter((t) => t.courseId === course.id)
        .sort(
          (a, b) =>
            a.examDate.localeCompare(b.examDate) || a.examTime.localeCompare(b.examTime)
        ),
    [examTerms, course.id]
  );

  const [selectedTermId, setSelectedTermId] = useState<string>('');
  const [rosterFilter, setRosterFilter] = useState<
    'all' | 'registered' | 'cancelled' | 'unanswered'
  >('all');
  const [studentSearch, setStudentSearch] = useState('');
  const [togglingLock, setTogglingLock] = useState(false);
  const [updatingStudentId, setUpdatingStudentId] = useState<string | null>(null);

  // Create / Edit Modal state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<ExamTerm | null>(null);
  const [title, setTitle] = useState('');
  const [examDate, setExamDate] = useState(() => addDaysIso(getTodayIsoLocal(), 10));
  const [examTime, setExamTime] = useState('10:00');
  const [classroom, setClassroom] = useState('Amfiteatar A1');
  const [regOpenDate, setRegOpenDate] = useState(() => getTodayIsoLocal());
  const [regCloseDate, setRegCloseDate] = useState(() => addDaysIso(getTodayIsoLocal(), 7));
  const [notes, setNotes] = useState('');
  const [savingTerm, setSavingTerm] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ExamTerm | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (courseTerms.length === 0) {
      setSelectedTermId('');
      return;
    }
    if (!selectedTermId || !courseTerms.some((t) => t.id === selectedTermId)) {
      // Prefer the nearest upcoming or open term
      const today = getTodayIsoLocal();
      const upcoming = courseTerms.find((t) => t.examDate >= today) || courseTerms[0];
      setSelectedTermId(upcoming.id);
    }
  }, [courseTerms, selectedTermId]);

  const activeTerm = courseTerms.find((t) => t.id === selectedTermId) || null;

  const activeTermRegistrations = useMemo(() => {
    if (!activeTerm) return [];
    return examRegistrations.filter((r) => r.termId === activeTerm.id);
  }, [examRegistrations, activeTerm]);

  const regByStudentId = useMemo(() => {
    const map = new Map<string, ExamRegistration>();
    for (const r of activeTermRegistrations) {
      map.set(r.studentId, r);
    }
    return map;
  }, [activeTermRegistrations]);

  // Turnout calculations aligned with enrolled students
  const rosterRows = useMemo(() => {
    return enrollments
      .map((enr) => {
        const reg = regByStudentId.get(enr.studentId);
        const state: 'registered' | 'cancelled' | 'unanswered' =
          reg?.status === ExamRegistrationStatus.REGISTERED
            ? 'registered'
            : reg?.status === ExamRegistrationStatus.CANCELLED
              ? 'cancelled'
              : 'unanswered';
        return { enrollment: enr, registration: reg, state };
      })
      .sort((a, b) => {
        const rank = { registered: 0, cancelled: 1, unanswered: 2 };
        if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
        return a.enrollment.studentName.localeCompare(b.enrollment.studentName, 'bs');
      });
  }, [enrollments, regByStudentId]);

  const registeredCount = rosterRows.filter((r) => r.state === 'registered').length;
  const cancelledCount = rosterRows.filter((r) => r.state === 'cancelled').length;
  const unansweredCount = rosterRows.filter((r) => r.state === 'unanswered').length;
  const turnoutPct =
    enrollments.length > 0 ? Math.round((registeredCount / enrollments.length) * 100) : 0;

  const filteredRoster = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return rosterRows.filter((row) => {
      if (rosterFilter !== 'all' && row.state !== rosterFilter) return false;
      if (!q) return true;
      return (
        row.enrollment.studentName.toLowerCase().includes(q) ||
        row.enrollment.studentIndex.toLowerCase().includes(q)
      );
    });
  }, [rosterRows, rosterFilter, studentSearch]);

  const openCreateModal = () => {
    const today = getTodayIsoLocal();
    setEditingTerm(null);
    setTitle('II parcijalni ispit');
    setRegOpenDate(today);
    setRegCloseDate(addDaysIso(today, 7));
    setExamDate(addDaysIso(today, 10));
    setExamTime('10:00');
    setClassroom('Amfiteatar A1');
    setNotes('');
    setDialogOpen(true);
  };

  const openEditModal = (term: ExamTerm) => {
    setEditingTerm(term);
    setTitle(term.title);
    setRegOpenDate(term.registrationOpenDate);
    setRegCloseDate(term.registrationCloseDate);
    setExamDate(term.examDate);
    setExamTime(term.examTime);
    setClassroom(term.classroom);
    setNotes(term.notes);
    setDialogOpen(true);
  };

  const handleSaveTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTerm(true);
    try {
      if (editingTerm) {
        await updateExamTerm(editingTerm, course, {
          title,
          examDate,
          examTime,
          classroom,
          registrationOpenDate: regOpenDate,
          registrationCloseDate: regCloseDate,
          notes,
          isOpen: editingTerm.isOpen,
        });
        toast.success('Termin ispita je ažuriran.');
      } else {
        const newId = await createExamTerm({
          course,
          professorUid,
          title,
          examDate,
          examTime,
          classroom,
          registrationOpenDate: regOpenDate,
          registrationCloseDate: regCloseDate,
          notes,
        });
        setSelectedTermId(newId);
        toast.success('Novi ispitni rok je objavljen studentima.');
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju termina ispita.');
    } finally {
      setSavingTerm(false);
    }
  };

  const handleToggleLock = async () => {
    if (!activeTerm) return;
    setTogglingLock(true);
    try {
      await toggleExamTermOpen(activeTerm.id, !activeTerm.isOpen);
      toast.success(
        !activeTerm.isOpen
          ? 'Prijave za ovaj ispitni rok su ponovo otvorene.'
          : 'Prijave za ovaj ispitni rok su zaključane.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri promjeni statusa prijave.');
    } finally {
      setTogglingLock(false);
    }
  };

  const handleProfessorSetStudentStatus = async (
    enrollment: Enrollment,
    status: ExamRegistrationStatus,
    existingReg?: ExamRegistration
  ) => {
    if (!activeTerm) return;
    setUpdatingStudentId(enrollment.studentId);
    try {
      await setExamRegistrationByProfessor({
        term: activeTerm,
        course,
        enrollment,
        status,
        existingRegistration: existingReg,
      });
      toast.success(
        status === ExamRegistrationStatus.REGISTERED
          ? `Student ${enrollment.studentName} je prijavljen na ispit.`
          : `Prijava studenta ${enrollment.studentName} je odjavljena.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri ažuriranju prijave studenta.');
    } finally {
      setUpdatingStudentId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const regs = examRegistrations.filter((r) => r.termId === deleteTarget.id);
      await deleteExamTerm({
        course,
        termId: deleteTarget.id,
        termRegistrations: regs,
      });
      setDeleteTarget(null);
      toast.success('Ispitni rok i pripadajuće prijave su obrisani.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri brisanju ispitnog roka.');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportExamRosterCsv = () => {
    if (!activeTerm) return;
    const headers = [
      'Redni broj',
      'Broj indeksa',
      'Ime i prezime',
      'Odsjek',
      'Status prijave',
      'Termin ispita',
      'Sala',
      'Potpis studenta',
    ];

    const registeredOnly = rosterRows.filter((r) => r.state === 'registered');
    const sourceRows = registeredOnly.length > 0 ? registeredOnly : rosterRows;

    const csvRows = sourceRows.map((row, idx) => [
      idx + 1,
      row.enrollment.studentIndex,
      row.enrollment.studentName,
      row.enrollment.studentDepartment,
      row.state === 'registered'
        ? 'Prijavljen (izlazi)'
        : row.state === 'cancelled'
          ? 'Odjavio izlazak'
          : 'Bez prijave',
      `${formatBosnianDate(activeTerm.examDate)}${activeTerm.examTime ? ` ${activeTerm.examTime}` : ''}`,
      activeTerm.classroom || '—',
      '',
    ]);

    const cleanSlug = activeTerm.title
      .replace(/[^a-zA-Z0-9čćžšđČĆŽŠĐ_-]+/g, '_')
      .slice(0, 30);
    downloadCsv(`VOLTRA_${course.code}_${cleanSlug}_Prijava_ispita.csv`, headers, csvRows);
    toast.success('Spisak studenata za ispitnu salu je preuzet u CSV formatu.');
  };

  const activeWindow = activeTerm ? getExamWindowState(activeTerm) : null;

  return (
    <div className="space-y-5">
      {/* Top Action Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Ispitni rokovi i evidencija izlaska na ispit
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Objavite termin ispita sa rokom za prijavu i pratite uživo koliko će studenata izaći u
            salu.
          </p>
        </div>

        <Button onClick={openCreateModal} size="sm" className="shrink-0">
          <CalendarPlus className="w-4 h-4" />
          Objavi termin ispita
        </Button>
      </div>

      {courseTerms.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-900">
            Nema objavljenih termina ispita za predmet {course.name}
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
            Kada objavite termin parcijalnog ili završnog ispita sa datumom početka i isteka
            prijave, upisani studenti odmah dobijaju mogućnost prijave izlaska.
          </p>
          <div className="mt-5">
            <Button onClick={openCreateModal} size="sm">
              <CalendarPlus className="w-4 h-4" />
              Objavi prvi termin ispita
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left 4 Cols: Published Exam Terms List */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-600">
              <span>Objavljeni rokovi ({courseTerms.length})</span>
              <span className="text-slate-400 font-normal">Izlaze</span>
            </div>

            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {courseTerms.map((term) => {
                const isSel = term.id === selectedTermId;
                const win = getExamWindowState(term);
                const regCnt = examRegistrations.filter(
                  (r) =>
                    r.termId === term.id &&
                    r.status === ExamRegistrationStatus.REGISTERED
                ).length;

                return (
                  <button
                    key={term.id}
                    type="button"
                    onClick={() => setSelectedTermId(term.id)}
                    className={cn(
                      'w-full text-left px-4 py-3.5 transition-colors cursor-pointer flex items-start justify-between gap-3',
                      isSel ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-slate-900 truncate">
                        {term.title}
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        {formatBosnianDate(term.examDate)}
                        {term.examTime ? ` · ${term.examTime}` : ''}
                      </div>
                      <div className="text-[11px] mt-1">
                        {win.state === 'open' && (
                          <span className="text-emerald-700 font-medium">
                            Otvoreno do {formatBosnianDate(term.registrationCloseDate)}
                          </span>
                        )}
                        {win.state === 'upcoming' && (
                          <span className="text-blue-700 font-medium">
                            Otvara se {formatBosnianDate(term.registrationOpenDate)}
                          </span>
                        )}
                        {win.state === 'locked' && (
                          <span className="text-amber-700 font-medium">Zaključano</span>
                        )}
                        {win.state === 'closed' && (
                          <span className="text-slate-500">Prijava istekla</span>
                        )}
                        {win.state === 'held' && (
                          <span className="text-slate-400">Održan ispit</span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                        {regCnt}/{enrollments.length}
                      </div>
                      <div className="text-[11px] text-slate-500">prijavljeno</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right 8 Cols: Selected Term Turnout & Student Roster */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {activeTerm && activeWindow && (
              <>
                {/* Term Header & Actions */}
                <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-blue-700">
                        {course.code}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-700 tabular-nums">
                        Ispit: {formatBosnianDate(activeTerm.examDate)}
                        {activeTerm.examTime ? ` u ${activeTerm.examTime}` : ''}
                      </span>
                      {activeTerm.classroom && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-slate-700">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            {activeTerm.classroom}
                          </span>
                        </>
                      )}
                    </div>

                    <h3 className="text-lg font-bold text-slate-900">{activeTerm.title}</h3>

                    <div className="text-xs text-slate-500 font-mono tabular-nums">
                      Period prijave: {formatBosnianDate(activeTerm.registrationOpenDate)} —{' '}
                      {formatBosnianDate(activeTerm.registrationCloseDate)}
                    </div>

                    {activeTerm.notes && (
                      <p className="text-xs text-slate-600 pt-1">{activeTerm.notes}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleLock}
                      disabled={togglingLock}
                    >
                      {activeTerm.isOpen ? (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          Zaključaj prijave
                        </>
                      ) : (
                        <>
                          <LockOpen className="w-3.5 h-3.5 text-emerald-700" />
                          Otvori prijave
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportExamRosterCsv}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Spisak (CSV)
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditModal(activeTerm)}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Uredi
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteTarget(activeTerm)}
                      className="text-red-700 border-red-200 hover:bg-red-50"
                      aria-label="Obriši termin ispita"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Single-Elevation Hairline Turnout Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/50">
                  <div className="p-4">
                    <div className="text-xs text-slate-500">Izlaze na ispit</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                        {registeredCount}
                      </span>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">
                        / {enrollments.length} ({turnoutPct}%)
                      </span>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="text-xs text-slate-500">Odjavili izlazak</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-slate-800 tabular-nums">
                      {cancelledCount}
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="text-xs text-slate-500">Bez odgovora</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-slate-600 tabular-nums">
                      {unansweredCount}
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="text-xs text-slate-500">Status roka prijave</div>
                    <div className="mt-1.5 text-xs font-semibold">
                      {activeWindow.state === 'open' && (
                        <span className="text-emerald-700">{activeWindow.label}</span>
                      )}
                      {activeWindow.state === 'upcoming' && (
                        <span className="text-blue-700">{activeWindow.label}</span>
                      )}
                      {activeWindow.state === 'locked' && (
                        <span className="text-amber-700">{activeWindow.label}</span>
                      )}
                      {(activeWindow.state === 'closed' || activeWindow.state === 'held') && (
                        <span className="text-slate-600">{activeWindow.label}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Roster Filter & Search Bar */}
                <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
                    {[
                      { key: 'all', label: `Svi (${enrollments.length})` },
                      { key: 'registered', label: `Izlaze (${registeredCount})` },
                      { key: 'cancelled', label: `Odjavili (${cancelledCount})` },
                      { key: 'unanswered', label: `Bez odgovora (${unansweredCount})` },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setRosterFilter(tab.key as typeof rosterFilter)}
                        className={cn(
                          'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap',
                          rosterFilter === tab.key
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-56">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      placeholder="Pretraži ime ili indeks..."
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                </div>

                {/* Student Registration Table */}
                {filteredRoster.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Nema studenata za odabrani filter prijave.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="text-left py-2.5 px-4">Student</th>
                          <th className="text-left py-2.5 px-4 whitespace-nowrap">Broj indeksa</th>
                          <th className="text-left py-2.5 px-4">Odsjek</th>
                          <th className="text-left py-2.5 px-4 whitespace-nowrap">
                            Status izlaska na ispit
                          </th>
                          <th className="text-right py-2.5 px-4 whitespace-nowrap">
                            Evidencija profesora
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredRoster.map(({ enrollment, registration, state }) => {
                          const isRowBusy = updatingStudentId === enrollment.studentId;
                          return (
                            <tr key={enrollment.id} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-4 font-medium text-slate-900">
                                {enrollment.studentName}
                              </td>
                              <td className="py-2.5 px-4 font-mono text-xs text-slate-700 tabular-nums">
                                {enrollment.studentIndex}
                              </td>
                              <td className="py-2.5 px-4 text-xs text-slate-500">
                                {enrollment.studentDepartment}
                              </td>
                              <td className="py-2.5 px-4 text-xs font-medium whitespace-nowrap">
                                {state === 'registered' && (
                                  <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                    Prijavljen · izlazi na ispit
                                  </span>
                                )}
                                {state === 'cancelled' && (
                                  <span className="inline-flex items-center gap-1.5 text-red-700">
                                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                                    Odjavio izlazak
                                  </span>
                                )}
                                {state === 'unanswered' && (
                                  <span className="inline-flex items-center gap-1.5 text-slate-400">
                                    <Clock className="w-3.5 h-3.5 shrink-0" />
                                    Nije prijavio
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  {state !== 'registered' && (
                                    <button
                                      type="button"
                                      disabled={isRowBusy}
                                      onClick={() =>
                                        handleProfessorSetStudentStatus(
                                          enrollment,
                                          ExamRegistrationStatus.REGISTERED,
                                          registration
                                        )
                                      }
                                      className="px-2.5 py-1 rounded-md text-xs font-medium border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                      Prijavi
                                    </button>
                                  )}
                                  {state !== 'cancelled' && (
                                    <button
                                      type="button"
                                      disabled={isRowBusy}
                                      onClick={() =>
                                        handleProfessorSetStudentStatus(
                                          enrollment,
                                          ExamRegistrationStatus.CANCELLED,
                                          registration
                                        )
                                      }
                                      className="px-2.5 py-1 rounded-md text-xs font-medium border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                      Odjavi
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Exam Term Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editingTerm ? 'Uredi termin ispita' : 'Objavi novi termin ispita'}
        description="Definišite datum održavanja ispita te datum početka i isteka prijave za studente."
      >
        <form onSubmit={handleSaveTerm} className="space-y-4">
          {!editingTerm && (
            <div>
              <span className="block text-xs font-medium text-slate-600 mb-1.5">
                Brzi odabir vrste ispita:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {EXAM_TITLE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTitle(preset)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer',
                      title === preset
                        ? 'bg-blue-50 border-blue-600 text-blue-800'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="ext-title">Naziv ispita / ispitnog roka</Label>
            <Input
              id="ext-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="npr. II parcijalni ispit"
              maxLength={120}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="ext-date">Datum ispita</Label>
              <Input
                id="ext-date"
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="font-mono"
                required
              />
            </div>

            <div>
              <Label htmlFor="ext-time">Vrijeme (opciono)</Label>
              <Input
                id="ext-time"
                value={examTime}
                onChange={(e) => setExamTime(e.target.value)}
                placeholder="10:00"
                maxLength={20}
                className="font-mono"
              />
            </div>

            <div>
              <Label htmlFor="ext-room">Sala / Amfiteatar</Label>
              <Input
                id="ext-room"
                value={classroom}
                onChange={(e) => setClassroom(e.target.value)}
                placeholder="Amfiteatar A1"
                maxLength={60}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <Label htmlFor="ext-open">Datum početka prijave</Label>
              <Input
                id="ext-open"
                type="date"
                value={regOpenDate}
                onChange={(e) => setRegOpenDate(e.target.value)}
                className="font-mono"
                required
              />
            </div>

            <div>
              <Label htmlFor="ext-close">Datum isteka prijave</Label>
              <Input
                id="ext-close"
                type="date"
                value={regCloseDate}
                onChange={(e) => setRegCloseDate(e.target.value)}
                className="font-mono"
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="ext-notes">Napomena za studente (opciono)</Label>
            <Textarea
              id="ext-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="npr. Obavezno ponijeti indeks. Dozvoljen obični kalkulator."
              maxLength={300}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Odustani
            </Button>
            <Button type="submit" disabled={savingTerm}>
              {savingTerm
                ? 'Čuvanje...'
                : editingTerm
                  ? 'Sačuvaj izmjene'
                  : 'Objavi termin ispita'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Confirm Delete Term Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Brisanje termina ispita"
        description={`Želite li obrisati ispitni rok "${deleteTarget?.title}" (${deleteTarget ? formatBosnianDate(deleteTarget.examDate) : ''}) i sve evidentirane prijave studenata za ovaj rok?`}
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Odustani
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirmDelete}
            disabled={deleting}
          >
            {deleting ? 'Brisanje...' : 'Obriši ispitni rok'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
