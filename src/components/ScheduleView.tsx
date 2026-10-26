import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  ExternalLink,
  FileCheck2,
  FlaskConical,
  FolderKanban,
  ListTodo,
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

export const DAY_NAMES_BS: Record<number, string> = {
  1: 'Ponedjeljak',
  2: 'Utorak',
  3: 'Srijeda',
  4: 'Četvrtak',
  5: 'Petak',
  6: 'Subota',
  7: 'Nedjelja',
};

const DAY_NAMES_SHORT_BS: Record<number, string> = {
  1: 'Pon',
  2: 'Uto',
  3: 'Sri',
  4: 'Čet',
  5: 'Pet',
  6: 'Sub',
  7: 'Ned',
};

const MONTH_NAMES_BS = [
  'Januar',
  'Februar',
  'Mart',
  'April',
  'Maj',
  'Juni',
  'Juli',
  'August',
  'Septembar',
  'Oktobar',
  'Novembar',
  'Decembar',
];

export const SCHEDULE_TYPE_LABELS_BS: Record<ScheduleEventType, string> = {
  [ScheduleEventType.LECTURE]: 'Predavanje',
  [ScheduleEventType.LAB]: 'Laboratorijska vježba',
  [ScheduleEventType.EXAM]: 'Ispitni rok',
  [ScheduleEventType.PROJECT_DEADLINE]: 'Rok za projekat / zadaću',
};

const SCHEDULE_TYPE_SHORT_BS: Record<ScheduleEventType, string> = {
  [ScheduleEventType.LECTURE]: 'Predavanje',
  [ScheduleEventType.LAB]: 'Lab. vježba',
  [ScheduleEventType.EXAM]: 'Ispit',
  [ScheduleEventType.PROJECT_DEADLINE]: 'Rok',
};

export function getIsoDayOfWeek(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const jsDay = dt.getDay(); // 0 = Sun ... 6 = Sat
  return jsDay === 0 ? 7 : jsDay;
}

export function addDaysLocal(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + delta);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addMonthsLocal(isoDate: string, deltaMonths: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const targetFirst = new Date(y, (m || 1) - 1 + deltaMonths, 1);
  const maxDayInTarget = new Date(
    targetFirst.getFullYear(),
    targetFirst.getMonth() + 1,
    0
  ).getDate();
  const clampedDay = Math.min(d || 1, maxDayInTarget);
  const yyyy = targetFirst.getFullYear();
  const mm = String(targetFirst.getMonth() + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getWeekDatesForAnchor(anchorIso: string): Array<{ dow: number; isoDate: string }> {
  const anchorDow = getIsoDayOfWeek(anchorIso); // 1..7
  const mondayIso = addDaysLocal(anchorIso, -(anchorDow - 1));
  return [1, 2, 3, 4, 5, 6, 7].map((dow) => ({
    dow,
    isoDate: addDaysLocal(mondayIso, dow - 1),
  }));
}

interface MonthGridCell {
  isoDate: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

function buildMonthGrid(anchorIso: string, todayIso: string): {
  year: number;
  monthIndex: number;
  cells: MonthGridCell[];
} {
  const [y, m] = anchorIso.split('-').map(Number);
  const year = y || new Date().getFullYear();
  const monthIndex = (m || 1) - 1;

  const firstIso = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const firstDow = getIsoDayOfWeek(firstIso); // 1=Mon..7=Sun
  const gridStartIso = addDaysLocal(firstIso, -(firstDow - 1));

  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const lastIso = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const lastDow = getIsoDayOfWeek(lastIso);
  const totalCells = firstDow - 1 + lastDay + (7 - lastDow);

  const cells: MonthGridCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const cellIso = addDaysLocal(gridStartIso, i);
    const [cy, cm, cd] = cellIso.split('-').map(Number);
    cells.push({
      isoDate: cellIso,
      dayNumber: cd || 1,
      inCurrentMonth: cy === year && (cm || 1) - 1 === monthIndex,
      isToday: cellIso === todayIso,
    });
  }

  return { year, monthIndex, cells };
}

export interface UnifiedScheduleEntry {
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
  date: string; // Effective YYYY-MM-DD occurrence date
  startTime: string;
  endTime: string;
  location: string;
  description: string;
}

export function buildBaseScheduleEntries(params: {
  courses: Course[];
  scheduleEvents: ScheduleEvent[];
  examTerms?: ExamTerm[];
  gradingItems?: GradingItem[];
}): UnifiedScheduleEntry[] {
  const { courses, scheduleEvents, examTerms = [], gradingItems = [] } = params;
  const coursesMap: Record<string, Course> = {};
  for (const c of courses) {
    coursesMap[c.id] = c;
  }

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
      description:
        term.notes || `Prijava ispita do ${formatBosnianDate(term.registrationCloseDate)}`,
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
}

export function materializeEntriesForDate(
  baseEntries: UnifiedScheduleEntry[],
  isoDate: string
): UnifiedScheduleEntry[] {
  const dow = getIsoDayOfWeek(isoDate);
  return baseEntries
    .filter((e) => (e.isRecurringWeekly ? e.dayOfWeek === dow : e.date === isoDate))
    .map((e) => ({
      ...e,
      date: isoDate,
    }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/**
 * Shared helper used by both Calendar Agenda view and Student Home Overview
 * to list real upcoming lectures, labs, exams, and deadlines chronologically.
 */
export function buildUpcomingScheduleEntries(params: {
  courses: Course[];
  scheduleEvents: ScheduleEvent[];
  examTerms?: ExamTerm[];
  gradingItems?: GradingItem[];
  fromDateIso: string;
  daysAhead?: number;
  limit?: number;
}): UnifiedScheduleEntry[] {
  const {
    courses,
    scheduleEvents,
    examTerms = [],
    gradingItems = [],
    fromDateIso,
    daysAhead = 28,
    limit = 40,
  } = params;

  const base = buildBaseScheduleEntries({
    courses,
    scheduleEvents,
    examTerms,
    gradingItems,
  });

  const occurrences: UnifiedScheduleEntry[] = [];
  for (let offset = 0; offset <= daysAhead; offset++) {
    const dateIso = addDaysLocal(fromDateIso, offset);
    const dayItems = materializeEntriesForDate(base, dateIso);
    occurrences.push(...dayItems);
    if (occurrences.length >= limit * 2) break;
  }

  // Also include dated exams/deadlines beyond daysAhead if space remains
  const horizonEndIso = addDaysLocal(fromDateIso, daysAhead);
  const farDated = base
    .filter((e) => !e.isRecurringWeekly && e.date > horizonEndIso)
    .sort((a, b) =>
      a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime)
    );

  return [...occurrences, ...farDated].slice(0, limit);
}

function getEventTypeVisuals(eventType: ScheduleEventType) {
  switch (eventType) {
    case ScheduleEventType.EXAM:
      return {
        textClass: 'text-red-700 font-semibold',
        cellClass: 'bg-red-50/80 border-red-200 text-red-900 hover:bg-red-100/70',
        Icon: FileCheck2,
      };
    case ScheduleEventType.PROJECT_DEADLINE:
      return {
        textClass: 'text-amber-700 font-semibold',
        cellClass: 'bg-amber-50/80 border-amber-200 text-amber-900 hover:bg-amber-100/70',
        Icon: FolderKanban,
      };
    case ScheduleEventType.LAB:
      return {
        textClass: 'text-emerald-700 font-medium',
        cellClass: 'bg-emerald-50/80 border-emerald-200 text-emerald-900 hover:bg-emerald-100/70',
        Icon: FlaskConical,
      };
    default:
      return {
        textClass: 'text-blue-700 font-medium',
        cellClass: 'bg-blue-50/80 border-blue-200 text-blue-900 hover:bg-blue-100/70',
        Icon: BookOpen,
      };
  }
}

export type CalendarViewMode = 'mjesec' | 'sedmica' | 'dan' | 'agenda';

interface ScheduleViewProps {
  courses: Course[];
  scheduleEvents: ScheduleEvent[];
  examTerms?: ExamTerm[];
  gradingItems?: GradingItem[];
  canEdit?: boolean;
  onOpenCourse?: (courseId: string) => void;
}

export function ScheduleView({
  courses,
  scheduleEvents,
  examTerms = [],
  gradingItems = [],
  canEdit = false,
  onOpenCourse,
}: ScheduleViewProps) {
  const { profile } = useAuth();
  const todayIso = getTodayIsoLocal();
  const todayDow = getIsoDayOfWeek(todayIso);

  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return 'agenda';
    }
    return 'mjesec';
  });
  const [cursorDateIso, setCursorDateIso] = useState<string>(todayIso);
  const [typeFilter, setTypeFilter] = useState<'all' | ScheduleEventType>('all');
  const [courseFilter, setCourseFilter] = useState<string>('all');

  // Event Details Modal
  const [selectedEntry, setSelectedEntry] = useState<UnifiedScheduleEntry | null>(null);

  // Add / Edit Modal State (Professors & Admins)
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

  const activeCourses = useMemo(
    () => courses.filter((c) => !c.isArchived),
    [courses]
  );

  const allBaseEntries = useMemo(
    () =>
      buildBaseScheduleEntries({
        courses,
        scheduleEvents,
        examTerms,
        gradingItems,
      }),
    [courses, scheduleEvents, examTerms, gradingItems]
  );

  const filteredBase = useMemo(() => {
    return allBaseEntries.filter((e) => {
      if (typeFilter !== 'all' && e.eventType !== typeFilter) return false;
      if (courseFilter !== 'all' && e.courseId !== courseFilter) return false;
      return true;
    });
  }, [allBaseEntries, typeFilter, courseFilter]);

  // Month Grid Data
  const monthGrid = useMemo(
    () => buildMonthGrid(cursorDateIso, todayIso),
    [cursorDateIso, todayIso]
  );

  const monthEntriesByIso = useMemo(() => {
    const map: Record<string, UnifiedScheduleEntry[]> = {};
    for (const cell of monthGrid.cells) {
      map[cell.isoDate] = materializeEntriesForDate(filteredBase, cell.isoDate);
    }
    return map;
  }, [monthGrid.cells, filteredBase]);

  // Week View Data
  const weekDays = useMemo(() => getWeekDatesForAnchor(cursorDateIso), [cursorDateIso]);
  const weekGroups = useMemo(() => {
    return weekDays.map(({ dow, isoDate }) => ({
      dow,
      dayLabel: DAY_NAMES_BS[dow],
      shortLabel: DAY_NAMES_SHORT_BS[dow],
      isoDate,
      isToday: isoDate === todayIso,
      isSelected: isoDate === cursorDateIso,
      items: materializeEntriesForDate(filteredBase, isoDate),
    }));
  }, [weekDays, filteredBase, todayIso, cursorDateIso]);

  // Day View Data
  const cursorDow = getIsoDayOfWeek(cursorDateIso);
  const dayEntries = useMemo(
    () => materializeEntriesForDate(filteredBase, cursorDateIso),
    [filteredBase, cursorDateIso]
  );

  // Agenda View Data (30-day rolling window from cursorDateIso + any later dated exams/deadlines)
  const agendaGroups = useMemo(() => {
    const groups: Array<{
      isoDate: string;
      dow: number;
      dayLabel: string;
      isToday: boolean;
      items: UnifiedScheduleEntry[];
    }> = [];

    for (let offset = 0; offset < 30; offset++) {
      const isoDate = addDaysLocal(cursorDateIso, offset);
      const items = materializeEntriesForDate(filteredBase, isoDate);
      if (items.length > 0) {
        const dow = getIsoDayOfWeek(isoDate);
        groups.push({
          isoDate,
          dow,
          dayLabel: DAY_NAMES_BS[dow],
          isToday: isoDate === todayIso,
          items,
        });
      }
    }

    const windowEnd = addDaysLocal(cursorDateIso, 29);
    const laterDated = filteredBase
      .filter((e) => !e.isRecurringWeekly && e.date > windowEnd)
      .sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime)
      );

    for (const entry of laterDated) {
      const existing = groups.find((g) => g.isoDate === entry.date);
      if (existing) {
        existing.items.push(entry);
      } else {
        const dow = getIsoDayOfWeek(entry.date);
        groups.push({
          isoDate: entry.date,
          dow,
          dayLabel: DAY_NAMES_BS[dow],
          isToday: entry.date === todayIso,
          items: [entry],
        });
      }
    }

    return groups;
  }, [filteredBase, cursorDateIso, todayIso]);

  // Navigation Handlers
  const handleNavigatePrev = () => {
    if (viewMode === 'mjesec') {
      setCursorDateIso((prev) => addMonthsLocal(prev, -1));
    } else if (viewMode === 'sedmica') {
      setCursorDateIso((prev) => addDaysLocal(prev, -7));
    } else if (viewMode === 'dan') {
      setCursorDateIso((prev) => addDaysLocal(prev, -1));
    } else {
      setCursorDateIso((prev) => addDaysLocal(prev, -14));
    }
  };

  const handleNavigateNext = () => {
    if (viewMode === 'mjesec') {
      setCursorDateIso((prev) => addMonthsLocal(prev, 1));
    } else if (viewMode === 'sedmica') {
      setCursorDateIso((prev) => addDaysLocal(prev, 7));
    } else if (viewMode === 'dan') {
      setCursorDateIso((prev) => addDaysLocal(prev, 1));
    } else {
      setCursorDateIso((prev) => addDaysLocal(prev, 14));
    }
  };

  const handleNavigateToday = () => {
    setCursorDateIso(todayIso);
  };

  const activePeriodLabel = useMemo(() => {
    if (viewMode === 'mjesec') {
      return `${MONTH_NAMES_BS[monthGrid.monthIndex]} ${monthGrid.year}.`;
    }
    if (viewMode === 'sedmica') {
      return `${formatBosnianDate(weekDays[0].isoDate)} – ${formatBosnianDate(weekDays[6].isoDate)}`;
    }
    if (viewMode === 'dan') {
      return `${DAY_NAMES_BS[cursorDow]}, ${formatBosnianDate(cursorDateIso)}`;
    }
    const endIso = addDaysLocal(cursorDateIso, 29);
    return `Od ${formatBosnianDate(cursorDateIso)} (${formatBosnianDate(cursorDateIso)} – ${formatBosnianDate(endIso)})`;
  }, [viewMode, monthGrid.monthIndex, monthGrid.year, weekDays, cursorDow, cursorDateIso]);

  const openCreateModal = (prefillDateIso?: string) => {
    const firstActive = activeCourses[0] || courses[0];
    const targetDate = prefillDateIso || cursorDateIso || todayIso;
    const targetDow = getIsoDayOfWeek(targetDate);
    setEditingEvent(null);
    setFormCourseId(
      courseFilter !== 'all' && coursesMap[courseFilter]
        ? courseFilter
        : firstActive?.id || ''
    );
    setFormType(ScheduleEventType.LECTURE);
    setFormTitle('');
    setFormRecurring(true);
    setFormDow(targetDow <= 6 ? targetDow : 1);
    setFormDate(targetDate);
    setFormStart('09:00');
    setFormEnd('11:00');
    setFormLocation('Amfiteatar A1');
    setFormDesc('');
    setModalOpen(true);
  };

  const openEditModal = (ev: ScheduleEvent) => {
    setSelectedEntry(null);
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
        toast.success('Nova stavka je dodana u kalendar.');
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
      setSelectedEntry(null);
      toast.success('Stavka je uklonjena iz rasporeda.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri brisanju stavke.');
    } finally {
      setDeleting(false);
    }
  };

  const renderEventRow = (entry: UnifiedScheduleEntry, showDateSublabel = false) => {
    const visuals = getEventTypeVisuals(entry.eventType);
    const TypeIcon = visuals.Icon;

    return (
      <div
        key={`${entry.key}_${entry.date}`}
        onClick={() => setSelectedEntry(entry)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedEntry(entry);
          }
        }}
        className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-blue-50/40"
      >
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-24 shrink-0 font-mono text-xs tabular-nums pt-0.5">
            <div className="font-bold text-slate-900">
              {entry.startTime}
              {entry.endTime ? `–${entry.endTime}` : ''}
            </div>
            {showDateSublabel && (
              <div className="text-[11px] text-slate-500 mt-0.5">
                {formatBosnianDate(entry.date)}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-mono font-semibold text-slate-900">{entry.courseCode}</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className={cn('inline-flex items-center gap-1', visuals.textClass)}>
                <TypeIcon className="w-3.5 h-3.5 shrink-0" />
                {SCHEDULE_TYPE_LABELS_BS[entry.eventType]}
              </span>
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
              <p className="text-xs text-slate-500 line-clamp-1">{entry.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
          {canEdit && entry.rawScheduleEvent ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditModal(entry.rawScheduleEvent!);
                }}
                className="h-8 px-2.5 text-xs text-slate-600"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Uredi
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(entry.rawScheduleEvent!);
                }}
                className="h-8 w-8 text-slate-400 hover:text-red-700 hover:bg-red-50"
                aria-label="Ukloni iz rasporeda"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : (
            <span className="text-xs font-medium text-blue-700 whitespace-nowrap">
              Detalji
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Calendar Header & Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          {/* Left: Period Navigation (Prev / Today / Next + Active Date Range) */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={handleNavigatePrev}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                aria-label="Prethodni period"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNavigateToday}
                className={cn(
                  'h-8 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  cursorDateIso === todayIso
                    ? 'text-blue-700 bg-blue-50/70'
                    : 'text-slate-700 hover:bg-slate-100'
                )}
              >
                Danas
              </button>
              <button
                type="button"
                onClick={handleNavigateNext}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                aria-label="Sljedeći period"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div>
              <h2 className="text-base font-bold text-slate-900 font-mono tabular-nums">
                {activePeriodLabel}
              </h2>
              <p className="text-xs text-slate-500">
                Predavanja, laboratorijske vježbe, ispitni rokovi i rokovi za projekte
              </p>
            </div>
          </div>

          {/* Right: View Switcher (Mjesec | Sedmica | Dan | Agenda) + Add Button */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
              {(
                [
                  { key: 'mjesec', label: 'Mjesec', Icon: Calendar },
                  { key: 'sedmica', label: 'Sedmica', Icon: CalendarClock },
                  { key: 'dan', label: 'Dan', Icon: Clock },
                  { key: 'agenda', label: 'Lista / Agenda', Icon: ListTodo },
                ] as const
              ).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setViewMode(key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
                    viewMode === key
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:text-slate-900'
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {label}
                </button>
              ))}
            </div>

            {canEdit && activeCourses.length > 0 && (
              <Button
                size="sm"
                onClick={() => openCreateModal(cursorDateIso)}
                className="whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Dodaj termin / rok
              </Button>
            )}
          </div>
        </div>

        {/* Filter Bar + Visual Type Legend */}
        <div className="pt-3 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
            {(
              [
                { key: 'all', label: 'Sve obaveze' },
                { key: ScheduleEventType.LECTURE, label: 'Predavanja' },
                { key: ScheduleEventType.LAB, label: 'Lab. vježbe' },
                { key: ScheduleEventType.EXAM, label: 'Ispiti' },
                { key: ScheduleEventType.PROJECT_DEADLINE, label: 'Rokovi' },
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

          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1 text-blue-700">
                <BookOpen className="w-3.5 h-3.5" />
                Predavanje
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <FlaskConical className="w-3.5 h-3.5" />
                Lab. vježba
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1 text-red-700">
                <FileCheck2 className="w-3.5 h-3.5" />
                Ispit
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1 text-amber-700">
                <FolderKanban className="w-3.5 h-3.5" />
                Rok
              </span>
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
      </div>

      {/* =====================================================================
          VIEW 1: MONTH VIEW (Mjesec)
          ===================================================================== */}
      {viewMode === 'mjesec' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Desktop / Tablet 7-column Grid */}
          <div className="hidden md:block">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
                <div
                  key={dow}
                  className="py-2.5 px-3 text-xs font-semibold text-slate-600 border-r last:border-r-0 border-slate-200"
                >
                  {DAY_NAMES_SHORT_BS[dow]}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {monthGrid.cells.map((cell, idx) => {
                const items = monthEntriesByIso[cell.isoDate] || [];
                const visibleItems = items.slice(0, 3);
                const hiddenCount = items.length - visibleItems.length;
                const isSelectedDay = cell.isoDate === cursorDateIso;

                return (
                  <div
                    key={cell.isoDate}
                    className={cn(
                      'min-h-28 p-2 border-b border-r border-slate-200 flex flex-col gap-1 transition-colors',
                      (idx + 1) % 7 === 0 && 'border-r-0',
                      !cell.inCurrentMonth && 'bg-slate-50/60 text-slate-400',
                      cell.isToday && 'bg-blue-50/25'
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setCursorDateIso(cell.isoDate);
                          setViewMode('dan');
                        }}
                        className={cn(
                          'w-6 h-6 rounded-md font-mono text-xs font-semibold tabular-nums inline-flex items-center justify-center transition-colors cursor-pointer',
                          cell.isToday
                            ? 'bg-blue-700 text-white'
                            : isSelectedDay
                              ? 'bg-slate-900 text-white'
                              : cell.inCurrentMonth
                                ? 'text-slate-800 hover:bg-slate-100'
                                : 'text-slate-400 hover:bg-slate-100'
                        )}
                        title={`Otvori dnevni prikaz: ${formatBosnianDate(cell.isoDate)}`}
                      >
                        {cell.dayNumber}
                      </button>

                      {canEdit && cell.inCurrentMonth && (
                        <button
                          type="button"
                          onClick={() => openCreateModal(cell.isoDate)}
                          className="opacity-0 hover:opacity-100 focus-visible:opacity-100 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-opacity cursor-pointer"
                          aria-label={`Dodaj obavezu za ${formatBosnianDate(cell.isoDate)}`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-1 flex-1">
                      {visibleItems.map((entry) => {
                        const visuals = getEventTypeVisuals(entry.eventType);
                        return (
                          <button
                            key={`${entry.key}_${cell.isoDate}`}
                            type="button"
                            onClick={() => setSelectedEntry(entry)}
                            className={cn(
                              'w-full text-left px-1.5 py-1 rounded border text-[11px] leading-tight transition-colors cursor-pointer truncate',
                              visuals.cellClass
                            )}
                            title={`${entry.startTime} · ${entry.courseCode} · ${entry.title}`}
                          >
                            <span className="font-mono font-semibold tabular-nums mr-1">
                              {entry.startTime}
                            </span>
                            <span className="font-semibold">{entry.courseCode}</span>
                            <span className="opacity-80"> · {entry.title}</span>
                          </button>
                        );
                      })}

                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setCursorDateIso(cell.isoDate);
                            setViewMode('dan');
                          }}
                          className="w-full text-left px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:underline cursor-pointer tabular-nums"
                        >
                          +{hiddenCount} više u ovom danu
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobile Responsive Month View: Compact Mini-Month + Selected Day Events */}
          <div className="md:hidden divide-y divide-slate-200">
            <div className="p-3">
              <div className="grid grid-cols-7 text-center mb-1">
                {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
                  <div key={dow} className="text-[11px] font-semibold text-slate-500 py-1">
                    {DAY_NAMES_SHORT_BS[dow]}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthGrid.cells.map((cell) => {
                  const count = (monthEntriesByIso[cell.isoDate] || []).length;
                  const isSelected = cell.isoDate === cursorDateIso;
                  return (
                    <button
                      key={cell.isoDate}
                      type="button"
                      onClick={() => setCursorDateIso(cell.isoDate)}
                      className={cn(
                        'h-10 rounded-lg flex flex-col items-center justify-center font-mono text-xs tabular-nums transition-colors cursor-pointer',
                        isSelected
                          ? 'bg-slate-900 text-white font-bold'
                          : cell.isToday
                            ? 'bg-blue-50 text-blue-800 font-bold border border-blue-200'
                            : cell.inCurrentMonth
                              ? 'text-slate-800 hover:bg-slate-100'
                              : 'text-slate-400'
                      )}
                    >
                      <span>{cell.dayNumber}</span>
                      {count > 0 && (
                        <span
                          className={cn(
                            'text-[9px] leading-none mt-0.5',
                            isSelected ? 'text-blue-300' : 'text-blue-700 font-semibold'
                          )}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="px-4 py-2.5 bg-slate-50 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-900">
                  {DAY_NAMES_BS[cursorDow]}, {formatBosnianDate(cursorDateIso)}
                </span>
                <span className="font-mono text-slate-500 tabular-nums">
                  {dayEntries.length} obaveza
                </span>
              </div>
              {dayEntries.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Nema zakazanih obaveza za odabrani datum.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {dayEntries.map((entry) => renderEventRow(entry, false))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          VIEW 2: WEEK VIEW (Sedmica)
          ===================================================================== */}
      {viewMode === 'sedmica' && (
        <div className="space-y-4">
          {/* Desktop 7-Column Week Overview Strip */}
          <div className="hidden lg:grid lg:grid-cols-7 gap-3">
            {weekGroups.map((grp) => (
              <div
                key={grp.isoDate}
                className={cn(
                  'bg-white border rounded-xl overflow-hidden flex flex-col min-h-56',
                  grp.isToday ? 'border-blue-600' : 'border-slate-200'
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setCursorDateIso(grp.isoDate);
                    setViewMode('dan');
                  }}
                  className={cn(
                    'px-3 py-2.5 border-b text-left transition-colors cursor-pointer',
                    grp.isToday
                      ? 'bg-blue-50/70 border-blue-200'
                      : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/70'
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-900">{grp.shortLabel}</span>
                    {grp.isToday && (
                      <span className="text-[11px] font-semibold text-blue-700">Danas</span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-slate-600 tabular-nums mt-0.5">
                    {formatBosnianDate(grp.isoDate)}
                  </div>
                </button>

                <div className="p-2 space-y-1.5 flex-1">
                  {grp.items.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[11px] text-slate-400 py-6">
                      Slobodan dan
                    </div>
                  ) : (
                    grp.items.map((entry) => {
                      const visuals = getEventTypeVisuals(entry.eventType);
                      return (
                        <button
                          key={`${entry.key}_${grp.isoDate}`}
                          type="button"
                          onClick={() => setSelectedEntry(entry)}
                          className={cn(
                            'w-full text-left p-2 rounded-lg border text-xs transition-colors cursor-pointer space-y-0.5',
                            visuals.cellClass
                          )}
                        >
                          <div className="flex items-center justify-between gap-1 font-mono text-[11px] tabular-nums">
                            <span className="font-bold">
                              {entry.startTime}
                              {entry.endTime ? `–${entry.endTime}` : ''}
                            </span>
                            <span className="font-semibold">{entry.courseCode}</span>
                          </div>
                          <div className="font-semibold leading-snug line-clamp-2">
                            {entry.title}
                          </div>
                          <div className="text-[11px] opacity-80 truncate">
                            {SCHEDULE_TYPE_SHORT_BS[entry.eventType]}
                            {entry.location ? ` · ${entry.location}` : ''}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Mobile / Tablet Stacked Week View */}
          <div className="lg:hidden space-y-3">
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
                    'px-4 py-3 border-b flex items-center justify-between gap-2',
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
                    {grp.items.length === 0 ? 'Slobodan dan' : `${grp.items.length}`}
                  </span>
                </div>

                {grp.items.length > 0 && (
                  <div className="divide-y divide-slate-100">
                    {grp.items.map((entry) => renderEventRow(entry, false))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          VIEW 3: DAY VIEW (Dan)
          ===================================================================== */}
      {viewMode === 'dan' && (
        <div className="space-y-4">
          {/* Quick 7-day strip for jumping within the active week */}
          <div className="bg-white border border-slate-200 rounded-xl p-2 grid grid-cols-7 gap-1">
            {weekGroups.map((grp) => (
              <button
                key={grp.isoDate}
                type="button"
                onClick={() => setCursorDateIso(grp.isoDate)}
                className={cn(
                  'py-2 px-1 rounded-lg text-center transition-colors cursor-pointer',
                  grp.isSelected
                    ? 'bg-slate-900 text-white'
                    : grp.isToday
                      ? 'bg-blue-50 text-blue-800 border border-blue-200'
                      : 'text-slate-700 hover:bg-slate-100'
                )}
              >
                <div className="text-[11px] font-medium">{grp.shortLabel}</div>
                <div className="font-mono text-xs font-bold tabular-nums mt-0.5">
                  {grp.isoDate.slice(8, 10)}.{grp.isoDate.slice(5, 7)}.
                </div>
              </button>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-700 shrink-0" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Dnevni raspored — {DAY_NAMES_BS[cursorDow]}, {formatBosnianDate(cursorDateIso)}
                </h3>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                Ukupno obaveza: {dayEntries.length}
              </span>
            </div>

            {dayEntries.length === 0 ? (
              <div className="p-10 text-center">
                <CalendarClock className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                <h4 className="text-sm font-semibold text-slate-900">
                  Nema zakazanih obaveza za odabrani dan
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Odaberite drugi datum ili prebacite na prikaz „Sedmica“ ili „Lista / Agenda“.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {dayEntries.map((entry) => renderEventRow(entry, false))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          VIEW 4: AGENDA / LIST VIEW (Lista / Agenda)
          ===================================================================== */}
      {viewMode === 'agenda' && (
        <div className="space-y-4">
          {agendaGroups.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <ListTodo className="w-7 h-7 text-slate-400 mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-slate-900">
                Nema nadolazećih obaveza u odabranom periodu
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Sva zakazana predavanja, laboratorijske vježbe, ispiti i rokovi za projekte bit će
                hronološki prikazani na ovoj listi.
              </p>
            </div>
          ) : (
            agendaGroups.map((grp) => (
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
                    {grp.items.length} {grp.items.length === 1 ? 'obaveza' : 'obaveze'}
                  </span>
                </div>

                <div className="divide-y divide-slate-100">
                  {grp.items.map((entry) => renderEventRow(entry, false))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* =====================================================================
          MODAL: EVENT DETAILS (Click any event in Month / Week / Day / Agenda)
          ===================================================================== */}
      <Dialog
        open={Boolean(selectedEntry)}
        onOpenChange={(o) => !o && setSelectedEntry(null)}
        title={selectedEntry ? selectedEntry.title : 'Detalji obaveze'}
        description={
          selectedEntry
            ? `${selectedEntry.courseCode} — ${selectedEntry.courseName}`
            : undefined
        }
      >
        {selectedEntry && (
          <div className="space-y-4 text-left text-sm">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Vrsta obaveze:</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5',
                    getEventTypeVisuals(selectedEntry.eventType).textClass
                  )}
                >
                  {SCHEDULE_TYPE_LABELS_BS[selectedEntry.eventType]}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Datum održavanja:</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {DAY_NAMES_BS[getIsoDayOfWeek(selectedEntry.date)]},{' '}
                  {formatBosnianDate(selectedEntry.date)}
                  {selectedEntry.isRecurringWeekly ? ' (sedmični termin)' : ''}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Vrijeme:</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {selectedEntry.startTime}
                  {selectedEntry.endTime ? ` – ${selectedEntry.endTime}` : ''}
                </span>
              </div>

              {selectedEntry.location && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Lokacija / Sala:</span>
                  <span className="font-medium text-slate-900">{selectedEntry.location}</span>
                </div>
              )}
            </div>

            {selectedEntry.description && (
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">Napomena i opis</div>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                  {selectedEntry.description}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              {onOpenCourse ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const cId = selectedEntry.courseId;
                    setSelectedEntry(null);
                    onOpenCourse(cId);
                  }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Otvori predmet ({selectedEntry.courseCode})
                </Button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                {canEdit && selectedEntry.rawScheduleEvent && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditModal(selectedEntry.rawScheduleEvent!)}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Uredi
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        const target = selectedEntry.rawScheduleEvent!;
                        setSelectedEntry(null);
                        setDeleteTarget(target);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Ukloni
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => setSelectedEntry(null)}>
                  Zatvori
                </Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      {/* Modal: Create / Edit Schedule Event (Professor / Admin) */}
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingEvent ? 'Uredi stavku rasporeda' : 'Dodaj u kalendar i raspored'}
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
              {saving ? 'Čuvanje...' : editingEvent ? 'Sačuvaj izmjene' : 'Dodaj u kalendar'}
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
