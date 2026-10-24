import React, { useEffect, useState } from 'react';
import {
  Ban,
  CalendarPlus,
  CheckCheck,
  CheckCircle2,
  Clock,
  Info,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { calculateAttendance, getTodayIsoLocal } from '../../lib/calculations';
import { cn, formatBosnianDate, formatPoints } from '../../lib/utils';
import {
  createAttendanceSessionWithInitialMarks,
  deleteAttendanceSession,
  markAllStudentsPresentInSession,
  setStudentAttendance,
  updateAttendanceSession,
} from '../../services/zamioService';
import {
  AttendanceRecord,
  AttendanceSession,
  Course,
  Enrollment,
} from '../../types/zamio';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Label } from '../ui/input';

interface AttendanceManagerViewProps {
  course: Course;
  professorUid: string;
  enrollments: Enrollment[];
  sessions: AttendanceSession[];
  records: AttendanceRecord[];
  onOpenSettings: () => void;
}

export function AttendanceManagerView({
  course,
  professorUid,
  enrollments,
  sessions,
  records,
  onOpenSettings,
}: AttendanceManagerViewProps) {
  const sortedSessions = [...sessions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)
  );
  const sortedStudents = [...enrollments].sort((a, b) =>
    a.studentName.localeCompare(b.studentName, 'bs')
  );

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [sesDate, setSesDate] = useState(getTodayIsoLocal());
  const [sesTime, setSesTime] = useState('09:00 - 11:00');
  const [sesTopic, setSesTopic] = useState('');
  const [markAllInitially, setMarkAllInitially] = useState(true);
  const [creating, setCreating] = useState(false);

  const [bulkBusy, setBulkBusy] = useState(false);
  const [togglingStudentId, setTogglingStudentId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttendanceSession | null>(null);

  useEffect(() => {
    if (sortedSessions.length === 0) {
      setSelectedSessionId('');
      return;
    }
    if (!selectedSessionId || !sortedSessions.some((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(sortedSessions[0].id);
    }
  }, [sortedSessions, selectedSessionId]);

  if (!course.attendanceEnabled) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-xl mx-auto">
        <Info className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h2 className="text-base font-semibold text-slate-900">
          Praćenje prisustva je isključeno za predmet {course.name}
        </h2>
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
          Možete uključiti praćenje prisustva i podesiti maksimalni broj bodova (podrazumijevano 10
          bodova) u postavkama predmeta.
        </p>
        <div className="mt-5">
          <Button onClick={onOpenSettings} size="sm">
            Otvori postavke predmeta
          </Button>
        </div>
      </div>
    );
  }

  const activeSession = sortedSessions.find((s) => s.id === selectedSessionId) || null;
  const todayIso = getTodayIsoLocal();

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const id = await createAttendanceSessionWithInitialMarks({
        course,
        date: sesDate,
        time: sesTime,
        topic: sesTopic,
        markAllPresent: markAllInitially,
        enrolledStudents: sortedStudents,
        professorUid,
      });
      setSelectedSessionId(id);
      setNewSessionOpen(false);
      setSesTopic('');
      toast.success('Novi termin nastave je kreiran.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri kreiranju termina.');
    } finally {
      setCreating(false);
    }
  };

  const handleMarkAllPresent = async () => {
    if (!activeSession) return;
    setBulkBusy(true);
    try {
      const sessionRecords = records.filter((r) => r.sessionId === activeSession.id);
      await markAllStudentsPresentInSession({
        course,
        sessionId: activeSession.id,
        enrolledStudents: sortedStudents,
        existingRecords: sessionRecords,
        professorUid,
      });
      toast.success('Svi upisani studenti su označeni kao prisutni.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri grupnom označavanju.');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleToggleCancelSession = async () => {
    if (!activeSession) return;
    setBulkBusy(true);
    try {
      await updateAttendanceSession(activeSession, {
        date: activeSession.date,
        time: activeSession.time,
        topic: activeSession.topic,
        isCancelled: !activeSession.isCancelled,
      });
      toast.success(
        !activeSession.isCancelled
          ? 'Termin je označen kao otkazan (ne ulazi u obračun bodova).'
          : 'Termin je ponovo aktiviran.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri izmjeni statusa termina.');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleSetPresence = async (studentId: string, present: boolean) => {
    if (!activeSession) return;
    setTogglingStudentId(studentId);
    try {
      const existingRecord = records.find(
        (r) => r.sessionId === activeSession.id && r.studentId === studentId
      );
      await setStudentAttendance({
        course,
        sessionId: activeSession.id,
        studentId,
        present,
        note: existingRecord?.note || '',
        professorUid,
        existingRecord,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri izmjeni prisustva.');
    } finally {
      setTogglingStudentId(null);
    }
  };

  const handleConfirmDeleteSession = async () => {
    if (!deleteTarget) return;
    setBulkBusy(true);
    try {
      const sessionRecords = records.filter((r) => r.sessionId === deleteTarget.id);
      await deleteAttendanceSession({
        course,
        sessionId: deleteTarget.id,
        sessionRecords,
      });
      setDeleteTarget(null);
      toast.success('Termin prisustva je obrisan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri brisanju termina.');
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Evidencija prisustva ({formatPoints(course.attendanceMaxPoints)} bodova maks.)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Automatski obračun: Maks. bodovi × Prisustvovao / Održani termini. Otkazani i budući
            termini ne umanjuju bodove.
          </p>
        </div>

        <Button onClick={() => setNewSessionOpen(true)} size="sm">
          <CalendarPlus className="w-4 h-4" />
          Novi termin nastave
        </Button>
      </div>

      {sortedSessions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-600 mb-4">
            Još nema kreiranih termina nastave za predmet {course.name}.
          </p>
          <Button onClick={() => setNewSessionOpen(true)} size="sm">
            <CalendarPlus className="w-4 h-4" />
            Kreiraj prvi termin
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left 4 Cols: Sessions List */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              Termini nastave ({sortedSessions.length})
            </div>
            <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
              {sortedSessions.map((ses) => {
                const isSel = ses.id === selectedSessionId;
                const isFuture = !ses.isCancelled && ses.date > todayIso;
                return (
                  <button
                    key={ses.id}
                    type="button"
                    onClick={() => setSelectedSessionId(ses.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 transition-colors cursor-pointer flex items-center justify-between gap-2',
                      isSel ? 'bg-blue-50' : 'hover:bg-slate-50'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-900">
                          {formatBosnianDate(ses.date)}
                        </span>
                        {ses.time && (
                          <span className="font-mono text-[11px] text-slate-500">
                            {ses.time}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 truncate mt-0.5">
                        {ses.topic || 'Redovni termin nastave'}
                      </div>
                    </div>

                    <div className="text-[11px] shrink-0 font-medium">
                      {ses.isCancelled ? (
                        <span className="text-red-700">Otkazan</span>
                      ) : isFuture ? (
                        <span className="text-blue-700">Budući</span>
                      ) : (
                        <span className="text-emerald-700">Održan</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right 8 Cols: Active Session Fast Attendance Roster */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {activeSession && (
              <>
                <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-800">
                        {formatBosnianDate(activeSession.date)}
                      </span>
                      {activeSession.time && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{activeSession.time}</span>
                        </>
                      )}
                      {activeSession.isCancelled && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-red-700 font-semibold">
                            Otkazan termin (isključen iz obračuna)
                          </span>
                        </>
                      )}
                      {!activeSession.isCancelled && activeSession.date > todayIso && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                            <Clock className="w-3 h-3" />
                            Budući termin
                          </span>
                        </>
                      )}
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                      {activeSession.topic || 'Redovni termin nastave'}
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {!activeSession.isCancelled && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleMarkAllPresent}
                        disabled={bulkBusy || sortedStudents.length === 0}
                      >
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-700" />
                        Označi sve prisutnim
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleCancelSession}
                      disabled={bulkBusy}
                    >
                      {activeSession.isCancelled ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          Aktiviraj termin
                        </>
                      ) : (
                        <>
                          <Ban className="w-3.5 h-3.5" />
                          Otkaži termin
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteTarget(activeSession)}
                      className="text-red-700 border-red-200 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {sortedStudents.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Nema upisanih studenata na ovom predmetu.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="text-left py-2.5 px-4">Student</th>
                          <th className="text-right py-2.5 px-4 whitespace-nowrap">
                            Ukupno prisustvo (bodovi)
                          </th>
                          <th className="text-right py-2.5 px-4">Status na terminu</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sortedStudents.map((stu) => {
                          const rec = records.find(
                            (r) =>
                              r.sessionId === activeSession.id &&
                              r.studentId === stu.studentId
                          );
                          const stuAtt = calculateAttendance({
                            attendanceEnabled: course.attendanceEnabled,
                            attendanceMaxPoints: course.attendanceMaxPoints,
                            sessions,
                            records,
                            studentId: stu.studentId,
                          });
                          const isBusy = togglingStudentId === stu.studentId;

                          return (
                            <tr key={stu.studentId} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-4">
                                <div className="font-medium text-slate-900">
                                  {stu.studentName}
                                </div>
                                <div className="text-xs font-mono text-slate-500">
                                  {stu.studentIndex}
                                </div>
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                                <span className="font-semibold text-slate-900">
                                  {formatPoints(stuAtt.earnedPoints)}/{formatPoints(stuAtt.maxPoints)} b
                                </span>{' '}
                                <span className="text-slate-500">
                                  ({stuAtt.attendedCount}/{stuAtt.heldCount} · {stuAtt.percentage ?? 0}%)
                                </span>
                              </td>
                              <td className="py-2.5 px-4 text-right">
                                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                                  <button
                                    type="button"
                                    disabled={isBusy || activeSession.isCancelled}
                                    onClick={() => handleSetPresence(stu.studentId, true)}
                                    className={cn(
                                      'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
                                      rec?.present === true
                                        ? 'bg-emerald-700 text-white shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                    )}
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Prisutan
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy || activeSession.isCancelled}
                                    onClick={() => handleSetPresence(stu.studentId, false)}
                                    className={cn(
                                      'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
                                      rec?.present === false
                                        ? 'bg-red-700 text-white shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                    )}
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    Odsutan
                                  </button>
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

      {/* Modal: Create Attendance Session */}
      <Dialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        title="Novi termin nastave"
        description="Kreirajte termin predavanja ili vježbi za evidenciju prisustva."
      >
        <form onSubmit={handleCreateSession} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ses-date">Datum održavanja</Label>
              <Input
                id="ses-date"
                type="date"
                value={sesDate}
                onChange={(e) => setSesDate(e.target.value)}
                className="font-mono"
                required
              />
            </div>
            <div>
              <Label htmlFor="ses-time">Vrijeme (opciono)</Label>
              <Input
                id="ses-time"
                value={sesTime}
                onChange={(e) => setSesTime(e.target.value)}
                placeholder="09:00 - 11:00"
                className="font-mono"
                maxLength={20}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="ses-topic">Tema / Naziv termina (opciono)</Label>
            <Input
              id="ses-topic"
              value={sesTopic}
              onChange={(e) => setSesTopic(e.target.value)}
              placeholder="npr. Predavanje 07 — Virtuelna memorija"
              maxLength={150}
            />
          </div>

          <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={markAllInitially}
              onChange={(e) => setMarkAllInitially(e.target.checked)}
              className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
            />
            <span>
              Označi sve upisane studente kao <strong>prisutne</strong> na početku (brži unos za
              velike grupe)
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setNewSessionOpen(false)}>
              Odustani
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? 'Kreiranje...' : 'Kreiraj termin'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal: Confirm Delete Session */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Brisanje termina prisustva"
        description={`Želite li trajno obrisati termin od ${deleteTarget ? formatBosnianDate(deleteTarget.date) : ''} i sve zapise prisustva sa tog termina?`}
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Odustani
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirmDeleteSession}
            disabled={bulkBusy}
          >
            Obriši termin
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
