import React, { useMemo, useState } from 'react';
import {
  CalendarCheck2,
  CheckCircle2,
  Clock,
  Lock,
  MapPin,
  Search,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { getExamWindowState, getTodayIsoLocal } from '../../lib/calculations';
import {
  cn,
  formatBosnianDate,
  formatCourseAssistants,
  formatCourseProfessors,
  getCourseAssistants,
  getCourseProfessors,
} from '../../lib/utils';
import { setStudentExamRegistration } from '../../services/zamioService';
import {
  Course,
  ExamRegistration,
  ExamRegistrationStatus,
  ExamTerm,
  UserProfile,
} from '../../types/zamio';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface StudentExamsViewProps {
  studentProfile: UserProfile;
  examTerms: ExamTerm[];
  examRegistrations: ExamRegistration[];
  coursesById?: Record<string, Course>;
}

export function StudentExamsView({
  studentProfile,
  examTerms,
  examRegistrations,
  coursesById = {},
}: StudentExamsViewProps) {
  const [filterMode, setFilterMode] = useState<'all' | 'open' | 'registered'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyTermId, setBusyTermId] = useState<string | null>(null);

  const todayIso = getTodayIsoLocal();

  const regByTermId = useMemo(() => {
    const map = new Map<string, ExamRegistration>();
    for (const reg of examRegistrations) {
      map.set(reg.termId, reg);
    }
    return map;
  }, [examRegistrations]);

  const sortedTerms = useMemo(() => {
    return [...examTerms].sort((a, b) => {
      const aWin = getExamWindowState(a, todayIso);
      const bWin = getExamWindowState(b, todayIso);
      // Show open windows first, then upcoming, then others sorted by exam date
      const priority = { open: 0, upcoming: 1, locked: 2, closed: 3, held: 4 };
      if (priority[aWin.state] !== priority[bWin.state]) {
        return priority[aWin.state] - priority[bWin.state];
      }
      return a.examDate.localeCompare(b.examDate);
    });
  }, [examTerms, todayIso]);

  const openTermsCount = useMemo(
    () => sortedTerms.filter((t) => getExamWindowState(t, todayIso).state === 'open').length,
    [sortedTerms, todayIso]
  );

  const registeredActiveCount = useMemo(
    () =>
      sortedTerms.filter((t) => {
        const reg = regByTermId.get(t.id);
        return reg?.status === ExamRegistrationStatus.REGISTERED && t.examDate >= todayIso;
      }).length,
    [sortedTerms, regByTermId, todayIso]
  );

  const filteredTerms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedTerms.filter((term) => {
      const win = getExamWindowState(term, todayIso);
      const reg = regByTermId.get(term.id);

      if (filterMode === 'open' && win.state !== 'open') return false;
      if (
        filterMode === 'registered' &&
        reg?.status !== ExamRegistrationStatus.REGISTERED
      ) {
        return false;
      }

      if (!q) return true;
      return (
        term.title.toLowerCase().includes(q) ||
        term.courseName.toLowerCase().includes(q) ||
        term.courseCode.toLowerCase().includes(q) ||
        term.classroom.toLowerCase().includes(q)
      );
    });
  }, [sortedTerms, filterMode, searchQuery, regByTermId, todayIso]);

  const handleSelectStatus = async (term: ExamTerm, status: ExamRegistrationStatus) => {
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
          ? `Uspješno ste prijavili ispit: ${term.title} (${term.courseCode}).`
          : `Odjavili ste izlazak na ispit: ${term.title} (${term.courseCode}).`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri slanju prijave ispita.');
    } finally {
      setBusyTermId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Single-Elevation Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Otvorene prijave ispita</div>
            <div className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums">
              {openTermsCount}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Aktivni rokovi na vašim predmetima
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Prijavljeni predstojeći ispiti</div>
            <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
              {registeredActiveCount}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Potvrđen izlazak u evidenciji profesora
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Ukupno objavljenih rokova</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {sortedTerms.length}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Svi parcijalni i završni ispiti
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
          {[
            { key: 'all', label: `Svi rokovi (${sortedTerms.length})` },
            { key: 'open', label: `Otvorene prijave (${openTermsCount})` },
            { key: 'registered', label: `Moje prijave (${registeredActiveCount})` },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilterMode(tab.key as typeof filterMode)}
              className={cn(
                'px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap',
                filterMode === tab.key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pretraži predmet ili ispit..."
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Exam Terms List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredTerms.length === 0 ? (
          <div className="p-10 text-center">
            <CalendarCheck2 className="w-8 h-8 text-slate-400 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-slate-900">
              {sortedTerms.length === 0
                ? 'Trenutno nema objavljenih termina ispita'
                : 'Nema ispitnih rokova za odabrani filter'}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              {sortedTerms.length === 0
                ? 'Kada predmetni profesor objavi termin parcijalnog ili završnog ispita, ovdje ćete moći jednim klikom prijaviti izlazak.'
                : 'Promijenite filter prikaza kako biste vidjeli sve objavljene ispitne rokove.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredTerms.map((term) => {
              const win = getExamWindowState(term, todayIso);
              const reg = regByTermId.get(term.id);
              const isRegistered = reg?.status === ExamRegistrationStatus.REGISTERED;
              const isCancelled = reg?.status === ExamRegistrationStatus.CANCELLED;
              const isBusy = busyTermId === term.id;
              const courseObj = coursesById[term.courseId];

              return (
                <div
                  key={term.id}
                  className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5 hover:bg-slate-50/60 transition-colors"
                >
                  {/* Left Info Block */}
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-blue-700">
                        {term.courseCode}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-slate-700">{term.courseName}</span>
                      {term.classroom && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-slate-600">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            {term.classroom}
                          </span>
                        </>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-slate-900">{term.title}</h3>

                    {courseObj && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                        <span>
                          {getCourseProfessors(courseObj).length > 1 ? 'Profesori: ' : 'Profesor: '}
                          <span className="text-slate-700 font-medium">
                            {formatCourseProfessors(courseObj)}
                          </span>
                        </span>
                        {getCourseAssistants(courseObj).length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              Asistenti:{' '}
                              <span className="text-slate-700">
                                {formatCourseAssistants(courseObj)}
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                    )}

                    {/* Key Dates Row (Unboxed clean metadata) */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600 pt-0.5">
                      <div>
                        <span className="text-slate-500">Termin ispita: </span>
                        <strong className="font-mono text-slate-900 tabular-nums">
                          {formatBosnianDate(term.examDate)}
                          {term.examTime ? ` u ${term.examTime}` : ''}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Prijava od: </span>
                        <span className="font-mono text-slate-800 tabular-nums">
                          {formatBosnianDate(term.registrationOpenDate)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Istek prijave: </span>
                        <strong
                          className={cn(
                            'font-mono tabular-nums',
                            win.state === 'open' ? 'text-blue-700' : 'text-slate-800'
                          )}
                        >
                          {formatBosnianDate(term.registrationCloseDate)}
                        </strong>
                      </div>
                    </div>

                    {term.notes && (
                      <p className="text-xs text-slate-500 leading-relaxed">{term.notes}</p>
                    )}
                  </div>

                  {/* Right Status & 1-Click Registration Action */}
                  <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end justify-between gap-3 shrink-0 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                    {/* Current Personal Registration Status */}
                    <div className="text-xs font-medium">
                      {isRegistered ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          Prijavljen izlazak na ispit
                        </span>
                      ) : isCancelled ? (
                        <span className="inline-flex items-center gap-1.5 text-slate-600">
                          <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                          Odjavili ste izlazak
                        </span>
                      ) : (
                        <span className="text-slate-500">Niste prijavili ovaj rok</span>
                      )}
                    </div>

                    {/* Action Controls depending on Window */}
                    {win.canRegisterOrCancel ? (
                      <div className="flex items-center gap-2">
                        {!isRegistered ? (
                          <>
                            <Button
                              size="sm"
                              disabled={isBusy}
                              onClick={() =>
                                handleSelectStatus(term, ExamRegistrationStatus.REGISTERED)
                              }
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {isBusy ? 'Slanje...' : 'Prijavi ispit'}
                            </Button>
                            {!isCancelled && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isBusy}
                                onClick={() =>
                                  handleSelectStatus(term, ExamRegistrationStatus.CANCELLED)
                                }
                              >
                                Ne izlazim
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() =>
                              handleSelectStatus(term, ExamRegistrationStatus.CANCELLED)
                            }
                            className="text-red-700 border-red-200 hover:bg-red-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            {isBusy ? 'Odjava...' : 'Odjavi prijavu'}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 flex items-center gap-1.5">
                        {win.state === 'locked' ? (
                          <>
                            <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span className="text-amber-700 font-medium">
                              Profesor je zaključao prijave
                            </span>
                          </>
                        ) : win.state === 'upcoming' ? (
                          <>
                            <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <span className="text-blue-700">
                              Prijava počinje {formatBosnianDate(term.registrationOpenDate)}
                            </span>
                          </>
                        ) : (
                          <span>{win.label}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
