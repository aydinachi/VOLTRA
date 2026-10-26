import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  CalendarCheck,
  CalendarCheck2,
  Check,
  ChevronDown,
  ClipboardList,
  Plus,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { getCourseProgramCycle, StudyCycleKey } from '../../lib/programs';
import {
  cn,
  formatCourseAssistants,
  formatCourseProfessors,
  getCourseAssistants,
  getCourseProfessors,
} from '../../lib/utils';
import { Course } from '../../types/zamio';
import { ProfessorNavKey } from '../AppShell';
import { Button } from '../ui/button';

interface ProfessorCourseSelectorProps {
  activeCourse: Course;
  activeSemesterCourses: Course[];
  archivedCourses: Course[];
  showArchived: boolean;
  onToggleArchived: (showArchived: boolean) => void;
  selectedCourseId: string;
  onSelectCourse: (courseId: string) => void;
  onOpenNewCourse: () => void;
  activeNav: ProfessorNavKey;
  onNavigate: (nav: ProfessorNavKey) => void;
  enrolledCount: number;
  termsCount: number;
  sessionsCount: number;
}

export function ProfessorCourseSelector({
  activeCourse,
  activeSemesterCourses,
  archivedCourses,
  showArchived,
  onToggleArchived,
  selectedCourseId,
  onSelectCourse,
  onOpenNewCourse,
  activeNav,
  onNavigate,
  enrolledCount,
  termsCount,
  sessionsCount,
}: ProfessorCourseSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [cycleFilter, setCycleFilter] = useState<StudyCycleKey>('all');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  const dropdownContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const poolCourses = useMemo(() => {
    if (showArchived && archivedCourses.length > 0) return archivedCourses;
    if (activeSemesterCourses.length > 0) return activeSemesterCourses;
    return archivedCourses;
  }, [showArchived, activeSemesterCourses, archivedCourses]);

  const cycleCounts = useMemo(
    () => ({
      all: poolCourses.length,
      bachelor: poolCourses.filter((c) => getCourseProgramCycle(c) === 'bachelor').length,
      master: poolCourses.filter((c) => getCourseProgramCycle(c) === 'master').length,
      strucni_rs: poolCourses.filter((c) => getCourseProgramCycle(c) === 'strucni_rs').length,
    }),
    [poolCourses]
  );

  const filteredCourses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return poolCourses.filter((c) => {
      if (cycleFilter !== 'all' && getCourseProgramCycle(c) !== cycleFilter) {
        return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.studyProgram || '').toLowerCase().includes(q) ||
        c.semester.toLowerCase().includes(q)
      );
    });
  }, [poolCourses, cycleFilter, searchQuery]);

  // Focus search input and initialize highlighted option when dropdown opens
  useEffect(() => {
    if (!isOpen) return;
    const selectedIdx = filteredCourses.findIndex((c) => c.id === selectedCourseId);
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0);
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  // Keep highlightedIndex in bounds when filtering
  useEffect(() => {
    setHighlightedIndex((prev) => {
      if (filteredCourses.length === 0) return 0;
      return Math.min(prev, filteredCourses.length - 1);
    });
  }, [filteredCourses]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        dropdownContainerRef.current &&
        !dropdownContainerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  const handleSelect = (courseId: string) => {
    onSelectCourse(courseId);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setSearchQuery('');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredCourses.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % filteredCourses.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredCourses.length > 0) {
        setHighlightedIndex(
          (prev) => (prev - 1 + filteredCourses.length) % filteredCourses.length
        );
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredCourses[highlightedIndex];
      if (target) {
        handleSelect(target.id);
      }
    }
  };

  const workspaceTabs: {
    key: ProfessorNavKey;
    label: string;
    count?: number;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { key: 'bodovi', label: 'Unos bodova', icon: ClipboardList },
    { key: 'prisustvo', label: 'Prisustvo', count: sessionsCount, icon: CalendarCheck },
    { key: 'ispiti', label: 'Ispitni rokovi', count: termsCount, icon: CalendarCheck2 },
    { key: 'studenti', label: 'Studenti i ocjene', count: enrolledCount, icon: Users },
    { key: 'postavke', label: 'Osoblje i postavke', icon: Settings },
  ];

  const availableCycleTabs = (
    [
      { key: 'all', label: `Svi (${cycleCounts.all})`, count: cycleCounts.all },
      { key: 'bachelor', label: `Bachelor (${cycleCounts.bachelor})`, count: cycleCounts.bachelor },
      { key: 'master', label: `Master (${cycleCounts.master})`, count: cycleCounts.master },
      {
        key: 'strucni_rs',
        label: `Stručni RS (${cycleCounts.strucni_rs})`,
        count: cycleCounts.strucni_rs,
      },
    ] as const
  ).filter((tab) => tab.key === 'all' || tab.count > 0);

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      {/* Top Bar: Active Course Context + Searchable Course Dropdown */}
      <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left: Full Active Course Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <button
              type="button"
              onClick={() => onNavigate('pocetna')}
              className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-blue-700 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Svi predmeti</span>
            </button>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            {activeCourse.isArchived && (
              <>
                <span className="font-semibold text-amber-700">
                  Arhiviran ({activeCourse.academicYear})
                </span>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
              </>
            )}
            {activeCourse.studyProgram && (
              <>
                <span className="font-medium text-blue-700">{activeCourse.studyProgram}</span>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
              </>
            )}
            <span>{activeCourse.semester}</span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="font-mono tabular-nums">{activeCourse.ects} ECTS</span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              Studenti:{' '}
              <strong className="font-mono text-slate-900 tabular-nums">{enrolledCount}</strong>
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-sm font-semibold text-blue-700 shrink-0">
              {activeCourse.code}
            </span>
            <h2 className="text-lg font-bold text-slate-900 leading-snug">{activeCourse.name}</h2>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
            <span>
              {getCourseProfessors(activeCourse).length > 1 ? 'Profesori: ' : 'Profesor: '}
              <strong className="font-medium text-slate-900">
                {formatCourseProfessors(activeCourse)}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              Asistenti:{' '}
              {getCourseAssistants(activeCourse).length > 0 ? (
                <strong className="font-medium text-slate-800">
                  {formatCourseAssistants(activeCourse)}
                </strong>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate('postavke')}
                  className="text-blue-700 hover:underline cursor-pointer"
                >
                  + Dodaj asistente
                </button>
              )}
            </span>
          </div>
        </div>

        {/* Right: Searchable Course Combobox Dropdown + Novi Predmet */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 shrink-0 w-full lg:w-auto">
          <div
            ref={dropdownContainerRef}
            onKeyDown={handleKeyDown}
            className="relative w-full sm:w-80 xl:w-96"
          >
            <button
              type="button"
              role="combobox"
              aria-expanded={isOpen}
              aria-haspopup="listbox"
              aria-label="Izaberi predmet"
              onClick={() => setIsOpen((prev) => !prev)}
              className={cn(
                'w-full h-10 px-3.5 rounded-lg border bg-white text-left flex items-center justify-between gap-2.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
                isOpen
                  ? 'border-blue-600 ring-2 ring-blue-600/15'
                  : 'border-slate-300 hover:border-slate-400'
              )}
            >
              <div className="min-w-0 flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-blue-700 shrink-0">
                  {activeCourse.code}
                </span>
                <span className="text-sm font-medium text-slate-900 truncate">
                  {activeCourse.name}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  {poolCourses.length}
                </span>
                <ChevronDown
                  className={cn(
                    'w-4 h-4 text-slate-500 transition-transform duration-150',
                    isOpen && 'rotate-180 text-blue-700'
                  )}
                />
              </div>
            </button>

            {/* Floating Searchable Dropdown Menu */}
            {isOpen && (
              <div
                role="listbox"
                aria-label="Lista predmeta"
                className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-full sm:w-[440px] z-50 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
              >
                {/* Search Input & Cycle Filter */}
                <div className="p-2.5 border-b border-slate-100 bg-slate-50/70 space-y-2">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Pretraži naziv predmeta, šifru ili smjer..."
                      className="w-full h-9 pl-9 pr-8 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          searchInputRef.current?.focus();
                        }}
                        aria-label="Obriši pretragu"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {(availableCycleTabs.length > 2 || archivedCourses.length > 0) && (
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      {availableCycleTabs.length > 2 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {availableCycleTabs.map((tab) => (
                            <button
                              key={tab.key}
                              type="button"
                              onClick={() => setCycleFilter(tab.key)}
                              className={cn(
                                'px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
                                cycleFilter === tab.key
                                  ? 'bg-slate-900 text-white'
                                  : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                              )}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span />
                      )}

                      {archivedCourses.length > 0 && (
                        <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-md text-[11px]">
                          <button
                            type="button"
                            onClick={() => onToggleArchived(false)}
                            className={cn(
                              'px-2 py-0.5 rounded font-medium transition-colors cursor-pointer whitespace-nowrap tabular-nums',
                              !showArchived
                                ? 'bg-white text-slate-900 shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900'
                            )}
                          >
                            Aktivni ({activeSemesterCourses.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleArchived(true)}
                            className={cn(
                              'px-2 py-0.5 rounded font-medium transition-colors cursor-pointer whitespace-nowrap tabular-nums',
                              showArchived
                                ? 'bg-white text-slate-900 shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900'
                            )}
                          >
                            Arhiva ({archivedCourses.length})
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Course Options List */}
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {filteredCourses.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-slate-500">
                      Nijedan predmet ne odgovara pretrazi „{searchQuery}“.
                    </div>
                  ) : (
                    filteredCourses.map((c, idx) => {
                      const isSelected = c.id === selectedCourseId;
                      const isHighlighted = idx === highlightedIndex;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                          onClick={() => handleSelect(c.id)}
                          className={cn(
                            'w-full px-3.5 py-2.5 text-left flex items-start justify-between gap-3 transition-colors cursor-pointer',
                            isSelected
                              ? 'bg-blue-50/70'
                              : isHighlighted
                                ? 'bg-slate-50'
                                : 'bg-white hover:bg-slate-50'
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono text-xs font-semibold text-blue-700 shrink-0">
                                {c.code}
                              </span>
                              <span
                                className={cn(
                                  'text-sm leading-snug',
                                  isSelected
                                    ? 'font-semibold text-slate-950'
                                    : 'font-medium text-slate-900'
                                )}
                              >
                                {c.name}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500 leading-snug">
                              {c.studyProgram ? `${c.studyProgram} · ` : ''}
                              {c.semester} ·{' '}
                              <span className="font-mono tabular-nums">{c.ects} ECTS</span>
                            </div>
                          </div>

                          {isSelected && (
                            <Check className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={onOpenNewCourse} className="h-10 shrink-0">
            <Plus className="w-3.5 h-3.5" />
            Novi predmet
          </Button>
        </div>
      </div>

      {/* Bottom Workspace Sub-Navigation */}
      <div className="px-4 sm:px-5 py-2.5 bg-slate-50/50 border-t border-slate-200 rounded-b-xl flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {workspaceTabs.map((tab) => {
            const Icon = tab.icon;
            const isTabActive = activeNav === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onNavigate(tab.key)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
                  isTabActive
                    ? 'bg-white text-slate-900 font-semibold border border-slate-200/90 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 border border-transparent'
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {tab.label}
                  {tab.count !== undefined ? ` (${tab.count})` : ''}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onNavigate('raspored')}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0',
            activeNav === 'raspored'
              ? 'bg-white text-slate-900 font-semibold border border-slate-200/90 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 border border-transparent'
          )}
        >
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>Raspored nastave</span>
        </button>
      </div>
    </div>
  );
}
