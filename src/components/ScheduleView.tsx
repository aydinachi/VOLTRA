import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarClock,
  Clock,
  Edit3,
  MapPin,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { getTodayIsoLocal } from '../lib/calculations';
import { cn, formatBosnianDate } from '../lib/utils';
import {
  createScheduleEvent,
  deleteScheduleEvent,
  updateScheduleEvent,
} from '../services/zamioService';
import {
  Course,
  ExamTerm,
  GradingItem,
  ScheduleEvent,
  ScheduleEventType,
} from '../types/zamio';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input, Label } from './ui/input';

const DAY_NAMES_BS: Record<number, string> = {
  1: 'Ponedjeljak',
  2: 'Utorak',
  3: 'Srijeda',
  4: 'Četvrtak',
  5: 'Petak',
  6: 'Subota',
  7: 'Nedjelja',
};

const TYPE_LABELS_BS: Record<ScheduleEventType, string> = {
  [ScheduleEventType.LECTURE]: 'Predavanje',
  [ScheduleEventType.LAB]: 'Laboratorijska vježba',
  [ScheduleEventType.EXAM]: 'Ispitni rok',
  [ScheduleEventType.PROJECT_DEADLINE]: 'Rok za projekat / zadaću',
};

function getIsoDayOfWeek(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const jsDay = dt.getDay(); // 0 = Sun ... 6 = Sat
  return jsDay === 0 ? 7 : jsDay;
}

function addDaysLocal(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + delta);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getCurrentWeekDates(todayIso: string): Array<{ dow: number; isoDate: string }> {
  const todayDow = getIsoDayOfWeek(todayIso); // 1..7
  const mondayIso = addDaysLocal(todayIso, -(todayDow - 1));
  return [1, 2, 3, 4, 5, 6, 7].map((dow) => ({
    dow,
    isoDate: addDaysLocal(mondayIso, dow - 1),
  }));
}

interface UnifiedScheduleEntry {
  key: string;
  source: 'scheduleEvent' | 'examTerm' | 'gradingItem';
  rawScheduleEvent?: ScheduleEvent;
  courseId: string;
  courseCode: string;
  courseName: string;
  eventType: ScheduleEventType;
  title: string;
  isRecurringWeekly: boolean;
  dayOfWeek: number;
  date: string; // Effective date for sorting/display
  startTime: string;
  endTime: string;
  location: string;
  description: string;
}

interface ScheduleViewProps {
  courses: Course[];
  scheduleEvents: ScheduleEvent[];
  examTerms?: ExamTerm[];
  gradingItems?: GradingItem[];
  canEdit?: boolean;
}

export function ScheduleView({
  courses,
  scheduleEvents,
  examTerms = [],
  gradingItems = [],
  canEdit = false,
}: ScheduleViewProps) {
  const { profile } = useAuth();
  const todayIso = getTodayIsoLocal();
  const todayDow = getIsoDayOfWeek(todayIso);
  const weekDays = useMemo(() => getCurrentWeekDates(todayIso), [todayIso]);
  const weekStartIso = weekDays[0].isoDate;
  const weekEndIso = weekDays[6].isoDate;

  const [horizon, setHorizon] = useState<'danas' | 'sedmica' | 'sve'>('sedmica');
  const [typeFilter, setTypeFilter] = useState<'all' | ScheduleEventType>('all');
  const [courseFilter, setCourseFilter] = useState<string>('all');

  // Add / Edit Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [formCourseId, setFormCourseId] = useState(courses[0]?.id || '');
  const [formType, setFormType] = useState<ScheduleEventType>(ScheduleEventType.LECTURE);
  const [formTitle, setFormTitle] = useState('');
  const [formRecurring, setFormRecurring] = useState(true);
  const [formDow, setFormDow] = useState<number>(todayDow <= 5 ? todayDow : 1);
  const [formDate, setFormDate] = useState(todayIso);
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('11:00');
  const [formLocation, setFormLocation] = useState('Amfiteatar A1');
  const [formDesc, setFormDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ScheduleEvent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const coursesMap = useMemo(() => {
    const map: Record<string, Course> = {};
    for (const c of courses) {
      map[c.id] = c;
    }
    return map;
  }, [courses]);

  // Build unified entries combining scheduleEvents + examTerms + dated project/homework items
  const allBaseEntries = useMemo<UnifiedScheduleEntry[]>(() => {
    const list: UnifiedScheduleEntry[] = [];

    for (const ev of scheduleEvents) {
      if (coursesMap[ev.courseId]?.isArchived) continue;
      list.push({
        key: `sch_${ev.id}`,
        source: 'scheduleEvent',
        rawScheduleEvent: ev,
        courseId: ev.courseId,
        courseCode: ev.courseCode,
        courseName: ev.courseName,
        eventType: ev.eventType,
        title: ev.title,
        isRecurringWeekly: ev.isRecurringWeekly,
        dayOfWeek: ev.dayOfWeek,
        date: ev.date,
        startTime: ev.startTime,
        endTime: ev.endTime,
        location: ev.location,
        description: ev.description,
      });
    }

    for (const term of examTerms) {
      if (coursesMap[term.courseId]?.isArchived) continue;
      list.push({
        key: `ext_${term.id}`,
        source: 'examTerm',
        courseId: term.courseId,
        courseCode: term.courseCode,
        courseName: term.courseName,
        eventType: ScheduleEventType.EXAM,
        title: term.title,
        isRecurringWeekly: false,
        dayOfWeek: getIsoDayOfWeek(term.examDate),
        date: term.examDate,
        startTime: term.examTime || '09:00',
        endTime: '',
        location: term.classroom || 'Sala po rasporedu',
        description: term.notes || `Prijava ispita do ${formatBosnianDate(term.registrationCloseDate)}`,
      });
    }

    for (const item of gradingItems) {
      const crs = coursesMap[item.courseId];
      if (!crs || crs.isArchived || !item.date) continue;
      const lower = item.name.toLowerCase();
      const isExamLike = lower.includes('parcijal') || lower.includes('završni');
      if (isExamLike) continue;
      list.push({
        key: `itm_${item.id}`,
        source: 'gradingItem',
        courseId: item.courseId,
        courseCode: crs.code,
        courseName: crs.name,
        eventType: ScheduleEventType.PROJECT_DEADLINE,
        title: `Rok: ${item.name}`,
        isRecurringWeekly: false,
        dayOfWeek: getIsoDayOfWeek(item.date),
        date: item.date,
        startTime: '23:59',
        endTime: '',
        location: 'Online predaja / VOLTRA',
        description: item.description || `Maksimalno ${item.maxPoints} bodova`,
      });
    }

    return list;
  }, [scheduleEvents, examTerms, gradingItems, coursesMap]);

  const filteredBase = useMemo(() => {
    return allBaseEntries.filter((e) => {
      if (typeFilter !== 'all' && e.eventType !== typeFilter) return false;
      if (courseFilter !== 'all' && e.courseId !== courseFilter) return false;
      return true;
    });
  }, [allBaseEntries, typeFilter, courseFilter]);

  // "Danas" items
  const todayEntries = useMemo(() => {
    return filteredBase
      .filter((e) =>
        e.isRecurringWeekly ? e.dayOfWeek === todayDow : e.date === todayIso
      )
      .map((e) => ({
        ...e,
        date: todayIso,
      }))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [filteredBase, todayDow, todayIso]);

  // "Ove sedmice" grouped by day 1..7
  const weekGroups = useMemo(() => {
    return weekDays.map(({ dow, isoDate }) => {
      const dayItems = filteredBase
        .filter((e) =>
          e.isRecurringWeekly ? e.dayOfWeek === dow : e.date === isoDate
        )
        .map((e) => ({ ...e, date: isoDate }))
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      return {
        dow,
        dayLabel: DAY_NAMES_BS[dow],
        isoDate,
        isToday: isoDate === todayIso,
        items: dayItems,
      };
    });
  }, [weekDays, filteredBase, todayIso]);

  const totalWeekItems = useMemo(
    () => weekGroups.reduce((sum, g) => sum + g.items.length, 0),
    [weekGroups]
  );

  // "Svi rokovi i sedmični raspored"
  const recurringAll = useMemo(
    () =>
      filteredBase
        .filter((e) => e.isRecurringWeekly)
        .sort((a, b) =>
          a.dayOfWeek !== b.dayOfWeek
            ? a.dayOfWeek - b.dayOfWeek
            : a.startTime.localeCompare(b.startTime)
        ),
    [filteredBase]
  );

  const datedUpcomingAndRecent = useMemo(
    () =>
      filteredBase
        .filter((e) => !e.isRecurringWeekly)
        .sort((a, b) =>
          a.date !== b.date
            ? a.date.localeCompare(b.date)
            : a.startTime.localeCompare(b.startTime)
        ),
    [filteredBase]
  );

  const openCreateModal = () => {
    const firstActive = courses.find((c) => !c.isArchived) || courses[0];
    setEditingEvent(null);
    setFormCourseId(firstActive?.id || '');
    setFormType(ScheduleEventType.LECTURE);
    setFormTitle('');
    setFormRecurring(true);
    setFormDow(todayDow <= 5 ? todayDow : 1);
    setFormDate(todayIso);
    setFormStart('09:00');
    setFormEnd('11:00');
    setFormLocation('Amfiteatar A1');
    setFormDesc('');
    setModalOpen(true);
  };

  const openEditModal = (ev: ScheduleEvent) => {
    setEditingEvent(ev);
    setFormCourseId(ev.courseId);
    setFormType(ev.eventType);
    setFormTitle(ev.title);
    setFormRecurring(ev.isRecurringWeekly);
    setFormDow(ev.dayOfWeek);
    setFormDate(ev.date);
    setFormStart(ev.startTime);
    setFormEnd(ev.endTime);
    setFormLocation(ev.location);
    setFormDesc(ev.description);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const course = coursesMap[formCourseId];
    if (!course) {
      toast.error('Odaberite predmet za stavku rasporeda.');
      return;
    }

    setSaving(true);
    try {
      const effectiveDow = formRecurring ? formDow : getIsoDayOfWeek(formDate);
      if (editingEvent) {
        await updateScheduleEvent(editingEvent, course, {
          eventType: formType,
          title: formTitle,
          isRecurringWeekly: formRecurring,
          dayOfWeek: effectiveDow,
          date: formDate,
          startTime: formStart,
          endTime: formEnd,
          location: formLocation,
          description: formDesc,
        });
        toast.success('Stavka rasporeda je ažurirana.');
      } else {
        await createScheduleEvent({
          course,
          actorUid: profile.uid,
          eventType: formType,
          title: formTitle,
          isRecurringWeekly: formRecurring,
          dayOfWeek: effectiveDow,
          date: formDate,
          startTime: formStart,
          endTime: formEnd,
          location: formLocation,
          description: formDesc,
        });
        toast.success('Nova stavka je dodana u raspored.');
      }
      setModalOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju rasporeda.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const course = coursesMap[deleteTarget.courseId];
    if (!course) return;
    setDeleting(true);
    try {
      await deleteScheduleEvent({
        course,
        eventId: deleteTarget.id,
      });
      setDeleteTarget(null);
      toast.success('Stavka je uklonjena iz rasporeda.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri brisanju stavke.');
    } finally {
      setDeleting(false);
    }
  };

  const renderEntryRow = (entry: UnifiedScheduleEntry, showDateLabel = false) => {
    const typeAccentClass =
      entry.eventType === ScheduleEventType.EXAM
        ? 'text-red-700 font-semibold'
        : entry.eventType === ScheduleEventType.PROJECT_DEADLINE
          ? 'text-amber-700 font-semibold'
          : entry.eventType === ScheduleEventType.LAB
            ? 'text-emerald-700 font-medium'
            : 'text-blue-700 font-medium';

    return (
      <div
        key={`${entry.key}_${entry.date}`}
        className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
      >
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-24 shrink-0 font-mono text-xs tabular-nums pt-0.5">
            <div className="font-bold text-slate-900">
              {entry.startTime}
              {entry.endTime ? `–${entry.endTime}` : ''}
            </div>
            {showDateLabel && (
              <div className="text-[11px] text-slate-500 mt-0.5">
                {entry.isRecurringWeekly
                  ? DAY_NAMES_BS[entry.dayOfWeek]
                  : formatBosnianDate(entry.date)}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-mono font-semibold text-slate-900">{entry.courseCode}</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className={typeAccentClass}>{TYPE_LABELS_BS[entry.eventType]}</span>
              {entry.location && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                    {entry.location}
                  </span>
                </>
              )}
            </div>

            <div className="text-sm font-semibold text-slate-900">
              {entry.title}{' '}
              <span className="font-normal text-slate-500">— {entry.courseName}</span>
            </div>

            {entry.description && (
              <p className="text-xs text-slate-500 leading-relaxed">{entry.description}</p>
            )}
          </div>
        </div>

        {canEdit && entry.rawScheduleEvent && (
          <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openEditModal(entry.rawScheduleEvent!)}
              className="h-8 px-2.5 text-xs text-slate-600"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Uredi
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDeleteTarget(entry.rawScheduleEvent!)}
              className="h-8 w-8 text-slate-400 hover:text-red-700 hover:bg-red-50"
              aria-label="Ukloni iz rasporeda"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  const activeCourses = courses.filter((c) => !c.isArchived);

  return (
    <div className="space-y-5">
      {/* Top Control & Horizon Switcher Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Raspored predavanja, laboratorijskih vježbi, ispita i rokova za projekte
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              Danas: {DAY_NAMES_BS[todayDow]}, {formatBosnianDate(todayIso)} · Tekuća sedmica:{' '}
              {formatBosnianDate(weekStartIso)} – {formatBosnianDate(weekEndIso)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Primary Horizon Segmented Control: Danas | Ove sedmice | Svi rokovi */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setHorizon('danas')}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap tabular-nums',
                  horizon === 'danas'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:text-slate-900'
                )}
              >
                Danas ({todayEntries.length})
              </button>
              <button
                type="button"
                onClick={() => setHorizon('sedmica')}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap tabular-nums',
                  horizon === 'sedmica'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:text-slate-900'
                )}
              >
                Ove sedmice ({totalWeekItems})
              </button>
              <button
                type="button"
                onClick={() => setHorizon('sve')}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap',
                  horizon === 'sve'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:text-slate-900'
                )}
              >
                Cijeli semestar
              </button>
            </div>

            {canEdit && activeCourses.length > 0 && (
              <Button size="sm" onClick={openCreateModal} className="whitespace-nowrap">
                <Plus className="w-4 h-4" />
                Dodaj termin / rok
              </Button>
            )}
          </div>
        </div>

        {/* Type & Course Filters */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
            {(
              [
                { key: 'all', label: 'Sve obaveze' },
                { key: ScheduleEventType.LECTURE, label: 'Predavanja' },
                { key: ScheduleEventType.LAB, label: 'Lab. vježbe' },
                { key: ScheduleEventType.EXAM, label: 'Ispiti' },
                { key: ScheduleEventType.PROJECT_DEADLINE, label: 'Rokovi projekata' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTypeFilter(t.key)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  typeFilter === t.key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeCourses.length > 1 && (
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 max-w-xs"
            >
              <option value="all">Svi aktivni predmeti ({activeCourses.length})</option>
              {activeCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* VIEW 1: DANAS */}
      {horizon === 'danas' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-700" />
              <h3 className="text-sm font-semibold text-slate-900">
                Obaveze za danas — {DAY_NAMES_BS[todayDow]}, {formatBosnianDate(todayIso)}
              </h3>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              Ukupno: {todayEntries.length}
            </span>
          </div>

          {todayEntries.length === 0 ? (
            <div className="p-8 text-center">
              <CalendarClock className="w-7 h-7 text-slate-400 mx-auto mb-2" />
              <h4 className="text-sm font-semibold text-slate-900">
                Za danas nema zakazanih predavanja, vježbi niti rokova
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                Prebacite prikaz na „Ove sedmice“ kako biste vidjeli ostale termine u sedmici.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {todayEntries.map((entry) => renderEntryRow(entry, false))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: OVE SEDMICE */}
      {horizon === 'sedmica' && (
        <div className="space-y-4">
          {weekGroups.map((grp) => (
            <div
              key={grp.isoDate}
              className={cn(
                'bg-white border rounded-xl overflow-hidden',
                grp.isToday ? 'border-blue-600' : 'border-slate-200'
              )}
            >
              <div
                className={cn(
                  'px-5 py-3 border-b flex items-center justify-between gap-2',
                  grp.isToday
                    ? 'bg-blue-50/70 border-blue-200'
                    : 'bg-slate-50/70 border-slate-200'
                )}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-slate-900">{grp.dayLabel}</span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="font-mono text-xs text-slate-600 tabular-nums">
                    {formatBosnianDate(grp.isoDate)}
                  </span>
                  {grp.isToday && (
                    <>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="text-xs font-semibold text-blue-700">Danas</span>
                    </>
                  )}
                </div>

                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {grp.items.length === 0
                    ? 'Slobodan dan'
                    : `${grp.items.length} ${grp.items.length === 1 ? 'stavka' : 'stavke'}`}
                </span>
              </div>

              {grp.items.length > 0 && (
                <div className="divide-y divide-slate-100">
                  {grp.items.map((entry) => renderEntryRow(entry, false))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* VIEW 3: CIJELI SEMESTAR (Sedmična nastava + Svi ispitni i projektni rokovi) */}
      {horizon === 'sve' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Stalni sedmični raspored nastave i vježbi
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Redovna sedmična predavanja i laboratorijske vježbe
                </p>
              </div>
              <Calendar className="w-4 h-4 text-slate-400" />
            </div>

            {recurringAll.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Nema unesenih stalnih sedmičnih termina.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recurringAll.map((entry) => renderEntryRow(entry, true))}
              </div>
            )}
          </div>

          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Ispitni rokovi i rokovi za projekte / zadaće
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                   Hronološki prikaz svih zakazanih datuma u semestru
                </p>
              </div>
              <CalendarClock className="w-4 h-4 text-slate-400" />
            </div>

            {datedUpcomingAndRecent.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Nema zakazanih ispitnih ili projektnih rokova.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {datedUpcomingAndRecent.map((entry) => renderEntryRow(entry, true))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Create / Edit Schedule Event */}
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingEvent ? 'Uredi stavku rasporeda' : 'Dodaj u raspored predmeta'}
        description="Unesite sedmični termin predavanja/laboratorijskih vježbi ili tačan datum ispita / roka za projekat."
      >
        <form onSubmit={handleSave} className="space-y-4 text-left">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sch-crs">Predmet</Label>
              <select
                id="sch-crs"
                value={formCourseId}
                onChange={(e) => setFormCourseId(e.target.value)}
                disabled={Boolean(editingEvent)}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                {activeCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="sch-type">Vrsta obaveze</Label>
              <select
                id="sch-type"
                value={formType}
                onChange={(e) => {
                  const next = e.target.value as ScheduleEventType;
                  setFormType(next);
                  if (
                    next === ScheduleEventType.EXAM ||
                    next === ScheduleEventType.PROJECT_DEADLINE
                  ) {
                    setFormRecurring(false);
                  } else {
                    setFormRecurring(true);
                  }
                }}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value={ScheduleEventType.LECTURE}>Predavanje</option>
                <option value={ScheduleEventType.LAB}>Laboratorijska vježba</option>
                <option value={ScheduleEventType.PROJECT_DEADLINE}>Rok za projekat / zadaću</option>
                <option value={ScheduleEventType.EXAM}>Ispit / Kolokvij</option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="sch-title">Naziv termina ili roka</Label>
            <Input
              id="sch-title"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="npr. Predavanje (Grupa A) ili Predaja I faze projekta"
              maxLength={140}
              required
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={formRecurring}
              onChange={(e) => setFormRecurring(e.target.checked)}
            />
            <span>Ponavlja se svake sedmice u istom terminu</span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {formRecurring ? (
              <div>
                <Label htmlFor="sch-dow">Dan u sedmici</Label>
                <select
                  id="sch-dow"
                  value={formDow}
                  onChange={(e) => setFormDow(Number(e.target.value))}
                  className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {[1, 2, 3, 4, 5, 6].map((d) => (
                    <option key={d} value={d}>
                      {DAY_NAMES_BS[d]}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <Label htmlFor="sch-date">Datum održavanja / roka</Label>
                <Input
                  id="sch-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="font-mono tabular-nums"
                  required
                />
              </div>
            )}

            <div>
              <Label htmlFor="sch-start">Početak (HH:MM)</Label>
              <Input
                id="sch-start"
                type="time"
                value={formStart}
                onChange={(e) => setFormStart(e.target.value)}
                className="font-mono tabular-nums"
                required
              />
            </div>

            <div>
              <Label htmlFor="sch-end">Kraj (opciono)</Label>
              <Input
                id="sch-end"
                type="time"
                value={formEnd}
                onChange={(e) => setFormEnd(e.target.value)}
                className="font-mono tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sch-loc">Sala / Laboratorija</Label>
              <Input
                id="sch-loc"
                value={formLocation}
                onChange={(e) => setFormLocation(e.target.value)}
                placeholder="npr. Amfiteatar A2 ili Lab 2-04"
                maxLength={80}
              />
            </div>

            <div>
              <Label htmlFor="sch-desc">Kratka napomena (opciono)</Label>
              <Input
                id="sch-desc"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="npr. Obavezna priprema za vježbu"
                maxLength={300}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Odustani
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Čuvanje...' : editingEvent ? 'Sačuvaj izmjene' : 'Dodaj u raspored'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Uklanjanje stavke rasporeda"
        description={`Želite li obrisati stavku „${deleteTarget?.title}“ (${deleteTarget?.courseCode})?`}
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Odustani
          </Button>
          <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleting}>
            {deleting ? 'Brisanje...' : 'Ukloni stavku'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
