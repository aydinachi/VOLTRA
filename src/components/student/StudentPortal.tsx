import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRight,
  ArrowUpDown,
  Bell,
  BookOpen,
  Calendar,
  CalendarCheck2,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FlaskConical,
  FolderKanban,
  Megaphone,
  Search,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  calculateCourseStudentSummary,
  CourseStudentSummary,
  getExamWindowState,
  getTodayIsoLocal,
} from '../../lib/calculations';
import { getCourseProgramCycle, StudyCycleKey } from '../../lib/programs';
import {
  cn,
  formatBosnianDate,
  formatCourseAssistants,
  formatCourseProfessors,
  formatPoints,
  getCourseProfessors,
} from '../../lib/utils';
import {
  StudentCourseBundle,
  subscribePublishedAnnouncements,
  subscribeStudentActivityAwards,
  subscribeStudentAttendanceRecords,
  subscribeStudentEnrolledCourseLive,
  subscribeStudentEnrollments,
  subscribeStudentExamRegistrations,
  subscribeStudentFinalGrades,
  subscribeStudentScores,
} from '../../services/zamioService';
import {
  ActivityAward,
  Announcement,
  AnnouncementAudience,
  AttendanceRecord,
  AttendanceSession,
  Course,
  Enrollment,
  ExamRegistration,
  ExamRegistrationStatus,
  ExamTerm,
  FinalGrade,
  GradingCategory,
  GradingItem,
  ScheduleEvent,
  ScheduleEventType,
  Score,
  SmartNotificationItem,
} from '../../types/zamio';
import {
  ANNOUNCEMENT_CATEGORY_LABELS,
  AnnouncementsView,
  formatAnnouncementTimestamp,
  readAnnouncementReadMap,
  saveAnnouncementReadMap,
} from '../AnnouncementsView';
import { StudentNavKey } from '../AppShell';
import { ProfileView } from '../ProfileView';
import {
  addDaysLocal,
  buildUpcomingScheduleEntries,
  DAY_NAMES_BS,
  getIsoDayOfWeek,
  SCHEDULE_TYPE_LABELS_BS,
  ScheduleView,
  UnifiedScheduleEntry,
} from '../ScheduleView';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input } from '../ui/input';
import { Progress } from '../ui/progress';
import { StudentCourseDetailsView } from './StudentCourseDetailsView';
import { StudentExamsView } from './StudentExamsView';

interface CourseBundle {
  course: Course;
  categories: GradingCategory[];
  items: GradingItem[];
  sessions: AttendanceSession[];
  examTerms: ExamTerm[];
  scheduleEvents: ScheduleEvent[];
}

export interface StudentDeepLinkTarget {
  subTab?: 'courses' | 'exams' | 'history';
  courseId?: string;
  nonce: number;
}

interface CombinedHomeNotification {
  key: string;
  kind: 'smart' | 'official';
  title: string;
  subtitle: string;
  body: string;
  timestampMs: number;
  timeLabel: string;
  unread: boolean;
  smartItem?: SmartNotificationItem;
  officialItem?: Announcement;
}

function formatShortIsoTime(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}. ${hh}:${min}`;
}

function getRelativeDayPrefix(isoDate: string, todayIso: string): string {
  if (isoDate === todayIso) return 'Danas';
  if (isoDate === addDaysLocal(todayIso, 1)) return 'Sutra';
  return DAY_NAMES_BS[getIsoDayOfWeek(isoDate)] || '';
}

interface StudentPortalProps {
  activeNav: StudentNavKey;
  onNavigate: (nav: StudentNavKey) => void;
  deepLink?: StudentDeepLinkTarget | null;
  notifications?: SmartNotificationItem[];
  onSelectNotification?: (item: SmartNotificationItem) => void;
  onMarkNotificationRead?: (itemId: string) => void;
  onMarkAllNotificationsRead?: () => void;
}

export function StudentPortal({
  activeNav,
  onNavigate,
  deepLink,
  notifications = [],
  onSelectNotification,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
}: StudentPortalProps) {
  const { profile } = useAuth();
  const studentUid = profile?.uid || '';

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [bundlesByCourseId, setBundlesByCourseId] = useState<Record<string, CourseBundle>>({});
  const [scores, setScores] = useState<Score[]>([]);
  const [activityAwards, setActivityAwards] = useState<ActivityAward[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [finalGrades, setFinalGrades] = useState<FinalGrade[]>([]);
  const [examRegistrations, setExamRegistrations] = useState<ExamRegistration[]>([]);
  const [publishedAnnouncements, setPublishedAnnouncements] = useState<Announcement[]>([]);
  const [readOfficialMap, setReadOfficialMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Courses Hub ("Moji predmeti") state
  const [coursesSubTab, setCoursesSubTab] = useState<'courses' | 'exams' | 'history'>('courses');
  const [detailCourseId, setDetailCourseId] = useState<string | null>(null);
  const [selectedHistoryCourseId, setSelectedHistoryCourseId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'archived' | 'passed' | 'all_history'>(
    'all_history'
  );
  const [historyYearFilter, setHistoryYearFilter] = useState<string>('all');

  const [courseSearch, setCourseSearch] = useState('');
  const [programFilter, setProgramFilter] = useState<StudyCycleKey>('all');
  const [courseSortBy, setCourseSortBy] = useState<'name' | 'points' | 'pct'>('name');

  // Home page modals (Event details & Notification reader)
  const [selectedHomeEvent, setSelectedHomeEvent] = useState<UnifiedScheduleEntry | null>(null);
  const [selectedHomeNotif, setSelectedHomeNotif] = useState<CombinedHomeNotification | null>(null);

  useEffect(() => {
    if (!studentUid) return;
    setReadOfficialMap(readAnnouncementReadMap(studentUid));
  }, [studentUid, activeNav]);

  // Apply deepLink transitions from notifications or AppShell
  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.subTab) {
      setCoursesSubTab(deepLink.subTab);
    }
    if (deepLink.subTab === 'history') {
      setSelectedHistoryCourseId(deepLink.courseId || null);
      setDetailCourseId(null);
    } else if (deepLink.subTab === 'exams') {
      setDetailCourseId(null);
    } else {
      setDetailCourseId(deepLink.courseId || null);
    }
  }, [deepLink]);

  useEffect(() => {
    if (!studentUid) return;
    setLoading(true);

    const unsubEnroll = subscribeStudentEnrollments(studentUid, (rows) => {
      const sorted = [...rows].sort((a, b) => a.courseCode.localeCompare(b.courseCode, 'bs'));
      setEnrollments(sorted);
      if (sorted.length === 0) {
        setLoading(false);
      }
    });
    const unsubScores = subscribeStudentScores(studentUid, setScores);
    const unsubActivity = subscribeStudentActivityAwards(studentUid, setActivityAwards);
    const unsubAtt = subscribeStudentAttendanceRecords(studentUid, setAttendanceRecords);
    const unsubGrades = subscribeStudentFinalGrades(studentUid, setFinalGrades);
    const unsubExamRegs = subscribeStudentExamRegistrations(studentUid, setExamRegistrations);
    const unsubAnn = subscribePublishedAnnouncements(setPublishedAnnouncements);

    return () => {
      unsubEnroll();
      unsubScores();
      unsubActivity();
      unsubAtt();
      unsubGrades();
      unsubExamRegs();
      unsubAnn();
    };
  }, [studentUid]);

  const enrolledCourseKey = useMemo(
    () => enrollments.map((e) => e.courseId).sort().join(','),
    [enrollments]
  );

  useEffect(() => {
    if (!enrolledCourseKey) {
      setBundlesByCourseId({});
      return;
    }

    const courseIds = enrolledCourseKey.split(',').filter(Boolean);
    const loadedSet = new Set<string>();

    const unsubs = courseIds.map((courseId) =>
      subscribeStudentEnrolledCourseLive(courseId, (bundle: StudentCourseBundle) => {
        loadedSet.add(courseId);
        setBundlesByCourseId((prev) => {
          const next = { ...prev };
          if (bundle.course) {
            next[courseId] = {
              course: bundle.course,
              categories: bundle.categories,
              items: bundle.items,
              sessions: bundle.sessions,
              examTerms: bundle.examTerms,
              scheduleEvents: bundle.scheduleEvents ?? [],
            };
          } else {
            delete next[courseId];
          }
          return next;
        });

        if (loadedSet.size >= courseIds.length) {
          setLoading(false);
        }
      })
    );

    return () => {
      for (const u of unsubs) u();
    };
  }, [enrolledCourseKey]);

  const activeEnrollments = useMemo(
    () =>
      enrollments.filter((enr) => {
        const crs = bundlesByCourseId[enr.courseId]?.course;
        return !enr.isArchived && !crs?.isArchived;
      }),
    [enrollments, bundlesByCourseId]
  );

  const archivedEnrollments = useMemo(
    () =>
      enrollments.filter((enr) => {
        const crs = bundlesByCourseId[enr.courseId]?.course;
        return Boolean(enr.isArchived || crs?.isArchived);
      }),
    [enrollments, bundlesByCourseId]
  );

  const summariesByCourseId = useMemo(() => {
    const map: Record<string, CourseStudentSummary> = {};
    for (const enr of enrollments) {
      const bundle = bundlesByCourseId[enr.courseId];
      if (!bundle) continue;
      const fg = finalGrades.find((g) => g.courseId === enr.courseId) || null;
      map[enr.courseId] = calculateCourseStudentSummary({
        course: bundle.course,
        categories: bundle.categories,
        items: bundle.items,
        scores,
        activityAwards,
        sessions: bundle.sessions,
        attendanceRecords,
        finalGradeRecord: fg,
        studentId: studentUid,
      });
    }
    return map;
  }, [
    enrollments,
    bundlesByCourseId,
    scores,
    activityAwards,
    attendanceRecords,
    finalGrades,
    studentUid,
  ]);

  const historicalEnrollments = useMemo(() => {
    return enrollments
      .filter((enr) => {
        const crs = bundlesByCourseId[enr.courseId]?.course;
        const isArch = Boolean(enr.isArchived || crs?.isArchived);
        const sum = summariesByCourseId[enr.courseId];
        const isPassed =
          sum?.studentVisibleFinalGrade !== null &&
          sum?.studentVisibleFinalGrade !== undefined &&
          sum.studentVisibleFinalGrade >= 6;
        return isArch || isPassed;
      })
      .sort((a, b) => {
        const yearCmp = (b.academicYear || '').localeCompare(a.academicYear || '');
        if (yearCmp !== 0) return yearCmp;
        return a.courseCode.localeCompare(b.courseCode, 'bs');
      });
  }, [enrollments, bundlesByCourseId, summariesByCourseId]);

  const passedEnrollmentsAll = useMemo(
    () =>
      enrollments.filter((enr) => {
        const g = summariesByCourseId[enr.courseId]?.studentVisibleFinalGrade;
        return g !== null && g !== undefined && g >= 6;
      }),
    [enrollments, summariesByCourseId]
  );

  const earnedEctsTotal = useMemo(
    () =>
      passedEnrollmentsAll.reduce(
        (acc, enr) => acc + (bundlesByCourseId[enr.courseId]?.course.ects ?? 0),
        0
      ),
    [passedEnrollmentsAll, bundlesByCourseId]
  );

  const activeExamTerms = useMemo(() => {
    const list: ExamTerm[] = [];
    for (const enr of activeEnrollments) {
      const bundle = bundlesByCourseId[enr.courseId];
      if (bundle?.examTerms) {
        list.push(...bundle.examTerms);
      }
    }
    return list;
  }, [activeEnrollments, bundlesByCourseId]);

  const activeCoursesById = useMemo(() => {
    const map: Record<string, Course> = {};
    for (const enr of activeEnrollments) {
      const bundle = bundlesByCourseId[enr.courseId];
      if (bundle?.course) {
        map[enr.courseId] = bundle.course;
      }
    }
    return map;
  }, [activeEnrollments, bundlesByCourseId]);

  const activeCoursesList = useMemo(
    () => Object.values(activeCoursesById),
    [activeCoursesById]
  );

  const activeScheduleEvents = useMemo(() => {
    const list: ScheduleEvent[] = [];
    for (const enr of activeEnrollments) {
      const bundle = bundlesByCourseId[enr.courseId];
      if (bundle?.scheduleEvents) {
        list.push(...bundle.scheduleEvents);
      }
    }
    return list;
  }, [activeEnrollments, bundlesByCourseId]);

  const activeGradingItems = useMemo(() => {
    const list: GradingItem[] = [];
    for (const enr of activeEnrollments) {
      const bundle = bundlesByCourseId[enr.courseId];
      if (bundle?.items) {
        list.push(...bundle.items);
      }
    }
    return list;
  }, [activeEnrollments, bundlesByCourseId]);

  const todayIso = getTodayIsoLocal();

  // Nearest upcoming events for Student Home Page
  const upcomingHomeEvents = useMemo(
    () =>
      buildUpcomingScheduleEntries({
        courses: activeCoursesList,
        scheduleEvents: activeScheduleEvents,
        examTerms: activeExamTerms,
        gradingItems: activeGradingItems,
        fromDateIso: todayIso,
        daysAhead: 21,
        limit: 6,
      }),
    [activeCoursesList, activeScheduleEvents, activeExamTerms, activeGradingItems, todayIso]
  );

  const next7DaysCount = useMemo(() => {
    const sevenDaysIso = addDaysLocal(todayIso, 6);
    return buildUpcomingScheduleEntries({
      courses: activeCoursesList,
      scheduleEvents: activeScheduleEvents,
      examTerms: activeExamTerms,
      gradingItems: activeGradingItems,
      fromDateIso: todayIso,
      daysAhead: 6,
      limit: 50,
    }).filter((e) => e.date <= sevenDaysIso).length;
  }, [activeCoursesList, activeScheduleEvents, activeExamTerms, activeGradingItems, todayIso]);

  const openExamStats = useMemo(() => {
    const openTerms = activeExamTerms.filter(
      (t) => getExamWindowState(t, todayIso).state === 'open'
    );
    const regMap = new Map(examRegistrations.map((r) => [r.termId, r]));
    const unansweredOpen = openTerms.filter((t) => !regMap.has(t.id));
    const registeredOpen = openTerms.filter(
      (t) => regMap.get(t.id)?.status === ExamRegistrationStatus.REGISTERED
    );
    return {
      openCount: openTerms.length,
      unansweredCount: unansweredOpen.length,
      registeredCount: registeredOpen.length,
      firstOpenTerm: unansweredOpen[0] || openTerms[0] || null,
    };
  }, [activeExamTerms, examRegistrations, todayIso]);

  // Combined real notifications (personal smart notifications + official student announcements)
  const combinedHomeNotifications = useMemo<CombinedHomeNotification[]>(() => {
    const items: CombinedHomeNotification[] = [];

    for (const sn of notifications) {
      const parsedMs = Date.parse(sn.createdAtIso);
      items.push({
        key: `smart_${sn.id}`,
        kind: 'smart',
        title: sn.title,
        subtitle: 'Obavijest sa predmeta',
        body: sn.description,
        timestampMs: Number.isNaN(parsedMs) ? 0 : parsedMs,
        timeLabel: formatShortIsoTime(sn.createdAtIso),
        unread: !sn.read,
        smartItem: sn,
      });
    }

    for (const ann of publishedAnnouncements) {
      if (
        ann.audience !== AnnouncementAudience.ALL &&
        ann.audience !== AnnouncementAudience.STUDENTS
      ) {
        continue;
      }
      const sec = (ann.createdAt as { seconds?: number })?.seconds ?? 0;
      items.push({
        key: `ann_${ann.id}`,
        kind: 'official',
        title: ann.title,
        subtitle: ANNOUNCEMENT_CATEGORY_LABELS[ann.category] || 'Zvanično obavještenje',
        body: ann.body,
        timestampMs: sec * 1000,
        timeLabel: formatAnnouncementTimestamp(ann.createdAt),
        unread: !readOfficialMap[ann.id],
        officialItem: ann,
      });
    }

    return items
      .sort((a, b) => {
        if (a.unread !== b.unread) return a.unread ? -1 : 1;
        return b.timestampMs - a.timestampMs;
      })
      .slice(0, 6);
  }, [notifications, publishedAnnouncements, readOfficialMap]);

  const totalUnreadHomeNotifications = useMemo(() => {
    const unreadSmart = notifications.filter((n) => !n.read).length;
    const unreadOfficial = publishedAnnouncements.filter(
      (a) =>
        (a.audience === AnnouncementAudience.ALL ||
          a.audience === AnnouncementAudience.STUDENTS) &&
        !readOfficialMap[a.id]
    ).length;
    return unreadSmart + unreadOfficial;
  }, [notifications, publishedAnnouncements, readOfficialMap]);

  const handleOpenCourseDetails = (courseId: string) => {
    setCoursesSubTab('courses');
    setDetailCourseId(courseId);
    onNavigate('predmeti');
  };

  const handleOpenExamRegistrations = () => {
    setCoursesSubTab('exams');
    setDetailCourseId(null);
    onNavigate('predmeti');
  };

  const handleOpenArchivedHistory = () => {
    setCoursesSubTab('history');
    setDetailCourseId(null);
    onNavigate('predmeti');
  };

  const handleMarkHomeNotifRead = (item: CombinedHomeNotification) => {
    if (item.kind === 'smart' && item.smartItem && onMarkNotificationRead) {
      onMarkNotificationRead(item.smartItem.id);
    } else if (item.kind === 'official' && item.officialItem && studentUid) {
      const next = { ...readOfficialMap, [item.officialItem.id]: true };
      setReadOfficialMap(next);
      saveAnnouncementReadMap(studentUid, next);
    }
  };

  const handleMarkAllHomeNotifsRead = () => {
    if (onMarkAllNotificationsRead) {
      onMarkAllNotificationsRead();
    }
    if (studentUid) {
      const next = { ...readOfficialMap };
      for (const a of publishedAnnouncements) {
        if (
          a.audience === AnnouncementAudience.ALL ||
          a.audience === AnnouncementAudience.STUDENTS
        ) {
          next[a.id] = true;
        }
      }
      setReadOfficialMap(next);
      saveAnnouncementReadMap(studentUid, next);
    }
  };

  // =========================================================================
  // ROUTE: PROFILE & SETTINGS
  // =========================================================================
  if (activeNav === 'profil') {
    return <ProfileView />;
  }

  // =========================================================================
  // ROUTE: NOTIFICATIONS & ANNOUNCEMENTS
  // =========================================================================
  if (activeNav === 'obavjestenja') {
    return (
      <AnnouncementsView
        viewerMode="student"
        canManage={false}
        smartNotifications={notifications}
        onSelectSmartNotification={onSelectNotification}
        onMarkSmartReadOnly={onMarkNotificationRead}
        onMarkAllSmartRead={onMarkAllNotificationsRead}
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
          <div className="lg:col-span-5 h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  // =========================================================================
  // ROUTE: INTERACTIVE TIMETABLE & CALENDAR ("Kalendar")
  // =========================================================================
  if (activeNav === 'raspored') {
    return (
      <ScheduleView
        courses={activeCoursesList}
        scheduleEvents={activeScheduleEvents}
        examTerms={activeExamTerms}
        gradingItems={activeGradingItems}
        canEdit={false}
        onOpenCourse={(cId) => handleOpenCourseDetails(cId)}
      />
    );
  }

  // =========================================================================
  // ROUTE: NEW STUDENT HOME PAGE / OVERVIEW ("Početna")
  // Answers immediately:
  //   1. What is coming up? (Upcoming events)
  //   2. What has changed? (Recent notifications)
  //   3. What should I pay attention to? (Open exams & compact course overview)
  // =========================================================================
  if (activeNav === 'pocetna') {
    const firstName = profile?.fullName?.trim().split(/\s+/)[0] || 'studente';
    const currentAcademicYear =
      activeCoursesList[0]?.academicYear || profile?.academicYear || '2026/2027';

    return (
      <div className="space-y-6">
        {/* A. WELCOME SECTION + COMPACT ACADEMIC ACTIVITY SUMMARY */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span>Studentski pregled</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {DAY_NAMES_BS[getIsoDayOfWeek(todayIso)]}, {formatBosnianDate(todayIso)}
                </span>
                {profile?.studentIndex && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono font-semibold text-slate-700 tabular-nums">
                      Indeks {profile.studentIndex}
                    </span>
                  </>
                )}
                {profile?.department && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{profile.department}</span>
                  </>
                )}
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Dobrodošli, {firstName}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Pregled nadolazećih obaveza, najnovijih obavijesti i aktivnih predmeta za akademsku{' '}
                <span className="font-mono font-medium text-slate-800 tabular-nums">
                  {currentAcademicYear}
                </span>
                .
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {openExamStats.openCount > 0 && (
                <Button size="sm" onClick={handleOpenExamRegistrations} className="whitespace-nowrap">
                  <FileCheck2 className="w-4 h-4" />
                  Prijava ispita ({openExamStats.openCount})
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate('raspored')}
                className="whitespace-nowrap"
              >
                <Calendar className="w-4 h-4" />
                Otvori kalendar
              </Button>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50/50 grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 sm:divide-x divide-slate-200">
            <div className="px-5 py-3.5">
              <div className="text-xs text-slate-500">Aktivni predmeti</div>
              <div className="mt-0.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
                {activeEnrollments.length}
              </div>
            </div>
            <div className="px-5 py-3.5">
              <div className="text-xs text-slate-500">Obaveze u 7 dana</div>
              <div className="mt-0.5 font-mono text-xl font-bold text-blue-700 tabular-nums">
                {next7DaysCount}
              </div>
            </div>
            <div className="px-5 py-3.5">
              <div className="text-xs text-slate-500">Otvorene prijave ispita</div>
              <div className="mt-0.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
                {openExamStats.openCount}
                {openExamStats.unansweredCount > 0 && (
                  <span className="ml-1.5 text-xs font-sans font-medium text-amber-700">
                    ({openExamStats.unansweredCount} čeka prijavu)
                  </span>
                )}
              </div>
            </div>
            <div className="px-5 py-3.5">
              <div className="text-xs text-slate-500">Položeno ukupno</div>
              <div className="mt-0.5 font-mono text-xl font-bold text-emerald-700 tabular-nums">
                {passedEnrollmentsAll.length}{' '}
                <span className="text-xs font-normal text-slate-500">
                  ({earnedEctsTotal} ECTS)
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Attention Banner if an Exam Registration Window is Open & Unanswered */}
        {openExamStats.unansweredCount > 0 && openExamStats.firstOpenTerm && (
          <div className="bg-white border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3 min-w-0">
              <CalendarCheck2 className="w-5 h-5 text-blue-700 shrink-0 mt-0.5 sm:mt-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  Otvorena prijava ispita: {openExamStats.firstOpenTerm.courseCode} —{' '}
                  {openExamStats.firstOpenTerm.title}
                </div>
                <p className="text-xs text-slate-600 mt-0.5 font-mono tabular-nums">
                  Ispit: {formatBosnianDate(openExamStats.firstOpenTerm.examDate)} · Rok za prijavu
                  do {formatBosnianDate(openExamStats.firstOpenTerm.registrationCloseDate)}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleOpenExamRegistrations}
              className="shrink-0 self-start sm:self-auto whitespace-nowrap"
            >
              Prijavi izlazak
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {/* MAIN 2-COLUMN DASHBOARD SPLIT: B. UPCOMING EVENTS & C. RECENT NOTIFICATIONS */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* B. UPCOMING EVENTS ("Šta slijedi?") */}
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Nadolazeće obaveze</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Najbliža predavanja, laboratorijske vježbe, ispiti i rokovi predaje
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('raspored')}
                className="text-xs text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
              >
                Cijeli kalendar
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>

            {upcomingHomeEvents.length === 0 ? (
              <div className="p-8 text-center flex-1 flex flex-col items-center justify-center">
                <CalendarClock className="w-7 h-7 text-slate-400 mb-2" />
                <h4 className="text-sm font-semibold text-slate-900">
                  Trenutno nema zakazanih nadolazećih obaveza
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
                  Kada nastavnici unesu sedmični raspored nastave, ispitne rokove ili rokove za
                  zadaće, najbliže obaveze će se automatski prikazati ovdje.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigate('raspored')}
                  className="mt-4"
                >
                  Otvori kalendar
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 flex-1">
                {upcomingHomeEvents.map((ev) => {
                  const TypeIcon =
                    ev.eventType === ScheduleEventType.EXAM
                      ? FileCheck2
                      : ev.eventType === ScheduleEventType.PROJECT_DEADLINE
                        ? FolderKanban
                        : ev.eventType === ScheduleEventType.LAB
                          ? FlaskConical
                          : BookOpen;

                  const typeColor =
                    ev.eventType === ScheduleEventType.EXAM
                      ? 'text-red-700 font-semibold'
                      : ev.eventType === ScheduleEventType.PROJECT_DEADLINE
                        ? 'text-amber-700 font-semibold'
                        : ev.eventType === ScheduleEventType.LAB
                          ? 'text-emerald-700 font-medium'
                          : 'text-blue-700 font-medium';

                  const dayPrefix = getRelativeDayPrefix(ev.date, todayIso);

                  return (
                    <button
                      key={`${ev.key}_${ev.date}`}
                      type="button"
                      onClick={() => setSelectedHomeEvent(ev)}
                      className="w-full text-left px-5 py-3.5 flex items-start justify-between gap-4 hover:bg-slate-50/80 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="font-mono font-bold text-slate-900">
                            {ev.courseCode}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className={cn('inline-flex items-center gap-1', typeColor)}>
                            <TypeIcon className="w-3.5 h-3.5 shrink-0" />
                            {SCHEDULE_TYPE_LABELS_BS[ev.eventType]}
                          </span>
                          {ev.location && (
                            <>
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                              <span className="text-slate-500 truncate">{ev.location}</span>
                            </>
                          )}
                        </div>

                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {ev.title}{' '}
                          <span className="font-normal text-slate-500">— {ev.courseName}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0 font-mono text-xs tabular-nums">
                        <div
                          className={cn(
                            'font-semibold',
                            ev.date === todayIso ? 'text-blue-700' : 'text-slate-900'
                          )}
                        >
                          {dayPrefix ? `${dayPrefix}, ` : ''}
                          {formatBosnianDate(ev.date)}
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          {ev.startTime}
                          {ev.endTime ? `–${ev.endTime}` : ''}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* C. RECENT NOTIFICATIONS ("Šta se promijenilo?") */}
          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900 truncate">
                    Nedavne obavijesti
                  </h3>
                  {totalUnreadHomeNotifications > 0 && (
                    <span className="font-mono text-xs font-bold text-blue-700 tabular-nums shrink-0">
                      ({totalUnreadHomeNotifications} novo)
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Promjene bodova, rokovi i obavještenja uprave
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {totalUnreadHomeNotifications > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllHomeNotifsRead}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap"
                    title="Označi sve obavijesti pročitanim"
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('obavjestenja')}
                  className="text-xs text-blue-700 hover:text-blue-800 whitespace-nowrap"
                >
                  Sve
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {combinedHomeNotifications.length === 0 ? (
              <div className="p-8 text-center flex-1 flex flex-col items-center justify-center">
                <Bell className="w-7 h-7 text-slate-400 mb-2" />
                <h4 className="text-sm font-semibold text-slate-900">
                  Nema novih obavijesti
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
                  Ovdje se prikazuju samo stvarna zvanična obavještenja i promjene na vašim
                  predmetima.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 flex-1">
                {combinedHomeNotifications.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      handleMarkHomeNotifRead(item);
                      setSelectedHomeNotif({ ...item, unread: false });
                    }}
                    className={cn(
                      'w-full text-left px-5 py-3.5 transition-colors cursor-pointer block',
                      item.unread
                        ? 'bg-blue-50/45 hover:bg-blue-50/80'
                        : 'bg-white hover:bg-slate-50/70'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <div className="flex items-center gap-1.5 min-w-0 truncate">
                        {item.unread && (
                          <>
                            <span className="font-semibold text-blue-700 shrink-0">
                              Nepročitano
                            </span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span className="truncate">{item.subtitle}</span>
                      </div>
                      <span className="font-mono tabular-nums shrink-0">{item.timeLabel}</span>
                    </div>

                    <div
                      className={cn(
                        'text-sm mt-0.5 truncate',
                        item.unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'
                      )}
                    >
                      {item.title}
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 line-clamp-2 leading-relaxed">
                      {item.body}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* D. QUICK OVERVIEW OF ENROLLED COURSES ("Na šta trebam obratiti pažnju?") */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Brzi pregled upisanih predmeta
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Kliknite na predmet za detaljan pregled bodova, prisustva, provjera znanja i
                aktivnosti
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              {archivedEnrollments.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleOpenArchivedHistory}>
                  Stari semestri ({archivedEnrollments.length})
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCoursesSubTab('courses');
                  setDetailCourseId(null);
                  onNavigate('predmeti');
                }}
              >
                Svi predmeti
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {activeEnrollments.length === 0 ? (
            <div className="p-8 text-center">
              <BookOpen className="w-7 h-7 text-slate-400 mx-auto mb-2" />
              <h4 className="text-sm font-semibold text-slate-900">
                Nemate aktivnih upisanih predmeta u tekućem semestru
              </h4>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Studentska služba ili predmetni nastavnik vrši upis na aktivne predmete. Ako imate
                ranije položene ili arhivirane predmete, možete ih otvoriti u sekciji Moji predmeti.
              </p>
              {historicalEnrollments.length > 0 && (
                <Button size="sm" variant="outline" onClick={handleOpenArchivedHistory} className="mt-4">
                  <Archive className="w-3.5 h-3.5" />
                  Pregledaj stare semestre ({historicalEnrollments.length})
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 divide-y md:divide-y-0 gap-0 md:gap-4 md:p-5">
              {activeEnrollments.map((enr) => {
                const bundle = bundlesByCourseId[enr.courseId];
                const crs = bundle?.course;
                const sum = summariesByCourseId[enr.courseId];
                const openTermsForCourse = (bundle?.examTerms || []).filter(
                  (t) => getExamWindowState(t, todayIso).state === 'open'
                );

                return (
                  <button
                    key={enr.id}
                    type="button"
                    onClick={() => handleOpenCourseDetails(enr.courseId)}
                    className="text-left p-5 md:rounded-xl md:border md:border-slate-200 hover:bg-slate-50/80 md:hover:border-blue-300 transition-colors cursor-pointer flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-mono font-bold text-blue-700">{enr.courseCode}</span>
                        <span className="font-mono tabular-nums">
                          {crs ? `${crs.ects} ECTS` : ''}
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-slate-900 leading-snug">
                        {enr.courseName}
                      </h4>

                      <div className="text-xs text-slate-500 truncate">
                        {formatCourseProfessors(crs, enr.leadProfessorName)}
                      </div>
                    </div>

                    {sum && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="text-slate-600">
                            {sum.studentVisibleFinalGrade !== null ? (
                              <strong className="text-emerald-700 font-semibold">
                                Zaključena ocjena {sum.studentVisibleFinalGrade}
                              </strong>
                            ) : sum.passedThreshold ? (
                              <span className="text-emerald-700 font-medium">Ostvaren prag</span>
                            ) : (
                              <span>
                                Još {formatPoints(sum.pointsNeededToPass)} b do praga
                              </span>
                            )}
                          </span>
                          <span className="font-mono font-bold text-slate-900 tabular-nums">
                            {formatPoints(sum.totalEarnedPoints)} /{' '}
                            {formatPoints(sum.maxPossiblePoints)} b
                          </span>
                        </div>

                        <Progress
                          value={sum.percentageAchieved}
                          indicatorClassName={
                            sum.passedThreshold ? 'bg-emerald-600' : 'bg-blue-700'
                          }
                        />

                        {openTermsForCourse.length > 0 && (
                          <div className="pt-1 text-[11px] font-medium text-blue-700 flex items-center gap-1">
                            <CalendarCheck2 className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              Otvorena prijava ispita ({openTermsForCourse.length})
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Home Event Details Modal */}
        <Dialog
          open={Boolean(selectedHomeEvent)}
          onOpenChange={(o) => !o && setSelectedHomeEvent(null)}
          title={selectedHomeEvent?.title || 'Detalji obaveze'}
          description={
            selectedHomeEvent
              ? `${selectedHomeEvent.courseCode} — ${selectedHomeEvent.courseName}`
              : undefined
          }
        >
          {selectedHomeEvent && (
            <div className="space-y-4 text-left text-sm">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Vrsta obaveze:</span>
                  <span className="font-semibold text-slate-900">
                    {SCHEDULE_TYPE_LABELS_BS[selectedHomeEvent.eventType]}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Datum i vrijeme:</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {DAY_NAMES_BS[getIsoDayOfWeek(selectedHomeEvent.date)]},{' '}
                    {formatBosnianDate(selectedHomeEvent.date)} u {selectedHomeEvent.startTime}
                    {selectedHomeEvent.endTime ? `–${selectedHomeEvent.endTime}` : ''}
                  </span>
                </div>
                {selectedHomeEvent.location && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Lokacija / Sala:</span>
                    <span className="font-medium text-slate-900">
                      {selectedHomeEvent.location}
                    </span>
                  </div>
                )}
              </div>

              {selectedHomeEvent.description && (
                <p className="text-xs text-slate-600 leading-relaxed">
                  {selectedHomeEvent.description}
                </p>
              )}

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const cId = selectedHomeEvent.courseId;
                    setSelectedHomeEvent(null);
                    handleOpenCourseDetails(cId);
                  }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Otvori predmet
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedHomeEvent(null);
                      onNavigate('raspored');
                    }}
                  >
                    Kalendar
                  </Button>
                  <Button size="sm" onClick={() => setSelectedHomeEvent(null)}>
                    Zatvori
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Dialog>

        {/* Home Notification Reader Modal */}
        <Dialog
          open={Boolean(selectedHomeNotif)}
          onOpenChange={(o) => !o && setSelectedHomeNotif(null)}
          title={selectedHomeNotif?.title || 'Obavijest'}
          description={
            selectedHomeNotif
              ? `${selectedHomeNotif.subtitle} · ${selectedHomeNotif.timeLabel}`
              : undefined
          }
        >
          {selectedHomeNotif && (
            <div className="space-y-4 text-left">
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {selectedHomeNotif.body}
              </p>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                {selectedHomeNotif.kind === 'smart' &&
                selectedHomeNotif.smartItem &&
                onSelectNotification ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      const target = selectedHomeNotif.smartItem!;
                      setSelectedHomeNotif(null);
                      onSelectNotification(target);
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Otvori vezanu stranicu
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedHomeNotif(null);
                      onNavigate('obavjestenja');
                    }}
                  >
                    <Megaphone className="w-3.5 h-3.5" />
                    Sva obavještenja
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedHomeNotif(null)}
                >
                  Zatvori
                </Button>
              </div>
            </div>
          )}
        </Dialog>
      </div>
    );
  }

  // =========================================================================
  // ROUTE: CONSOLIDATED COURSES HUB ("Moji predmeti")
  // Sub-tabs:
  //   1. Aktivni predmeti (+ full Course Details view when a course is selected)
  //   2. Prijava ispita
  //   3. Stari semestri (+ full archived Course Details inspection)
  // =========================================================================
  const activeDetailBundle = detailCourseId ? bundlesByCourseId[detailCourseId] : undefined;
  const activeDetailSummary = detailCourseId ? summariesByCourseId[detailCourseId] : undefined;

  const avgFinalGrade =
    passedEnrollmentsAll.length > 0
      ? passedEnrollmentsAll.reduce(
          (acc, enr) =>
            acc + (summariesByCourseId[enr.courseId]?.studentVisibleFinalGrade ?? 0),
          0
        ) / passedEnrollmentsAll.length
      : 0;

  const distinctHistoryYears = Array.from(
    new Set(
      historicalEnrollments
        .map((e) => bundlesByCourseId[e.courseId]?.course.academicYear || e.academicYear)
        .filter(Boolean)
    )
  ).sort((a, b) => b.localeCompare(a));

  const visibleHistory = historicalEnrollments.filter((enr) => {
    const crs = bundlesByCourseId[enr.courseId]?.course;
    const isArch = Boolean(enr.isArchived || crs?.isArchived);
    const g = summariesByCourseId[enr.courseId]?.studentVisibleFinalGrade;
    const isPassed = g !== null && g !== undefined && g >= 6;
    const yearStr = crs?.academicYear || enr.academicYear;

    if (historyFilter === 'archived' && !isArch) return false;
    if (historyFilter === 'passed' && !isPassed) return false;
    if (historyYearFilter !== 'all' && yearStr !== historyYearFilter) return false;
    return true;
  });

  const filteredActiveEnrollments = activeEnrollments
    .filter((enr) => {
      const crs = bundlesByCourseId[enr.courseId]?.course;
      if (programFilter !== 'all') {
        const cycle = getCourseProgramCycle(
          crs || { code: enr.courseCode, semester: '', studyProgram: undefined }
        );
        if (cycle !== programFilter) return false;
      }
      const q = courseSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        enr.courseName.toLowerCase().includes(q) ||
        enr.courseCode.toLowerCase().includes(q) ||
        (crs?.studyProgram || '').toLowerCase().includes(q) ||
        (crs?.semester || '').toLowerCase().includes(q) ||
        formatCourseProfessors(crs, enr.leadProfessorName).toLowerCase().includes(q) ||
        formatCourseAssistants(crs).toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const sumA = summariesByCourseId[a.courseId];
      const sumB = summariesByCourseId[b.courseId];
      if (courseSortBy === 'points') {
        return (sumB?.totalEarnedPoints ?? 0) - (sumA?.totalEarnedPoints ?? 0);
      }
      if (courseSortBy === 'pct') {
        return (sumB?.percentageAchieved ?? 0) - (sumA?.percentageAchieved ?? 0);
      }
      return a.courseName.localeCompare(b.courseName, 'bs');
    });

  const selectedHistBundle = selectedHistoryCourseId
    ? bundlesByCourseId[selectedHistoryCourseId]
    : undefined;
  const selectedHistSummary = selectedHistoryCourseId
    ? summariesByCourseId[selectedHistoryCourseId]
    : undefined;

  return (
    <div className="space-y-5">
      {/* Top Sub-Navigation Bar for Courses, Exam Registration, and Past Semesters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => {
              setCoursesSubTab('courses');
              setDetailCourseId(null);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
              coursesSubTab === 'courses'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:text-slate-900'
            )}
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            Aktivni predmeti ({activeEnrollments.length})
          </button>

          <button
            type="button"
            onClick={() => {
              setCoursesSubTab('exams');
              setDetailCourseId(null);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
              coursesSubTab === 'exams'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:text-slate-900'
            )}
          >
            <FileCheck2 className="w-3.5 h-3.5 shrink-0" />
            Prijava ispita
            {openExamStats.openCount > 0 ? ` (${openExamStats.openCount} otvoreno)` : ''}
          </button>

          <button
            type="button"
            onClick={() => {
              setCoursesSubTab('history');
              setDetailCourseId(null);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
              coursesSubTab === 'history'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:text-slate-900'
            )}
          >
            <Archive className="w-3.5 h-3.5 shrink-0" />
            Stari semestri ({historicalEnrollments.length})
          </button>
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums px-2">
          <span>Ostvareno: {earnedEctsTotal} ECTS</span>
          {passedEnrollmentsAll.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>Prosjek: {avgFinalGrade.toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      {/* =====================================================================
          SUB-TAB 1: ACTIVE COURSES & COURSE DETAILS PAGE
          ===================================================================== */}
      {coursesSubTab === 'courses' && (
        <>
          {detailCourseId && activeDetailBundle && activeDetailSummary && profile ? (
            <StudentCourseDetailsView
              course={activeDetailBundle.course}
              summary={activeDetailSummary}
              studentProfile={profile}
              courseExamTerms={activeDetailBundle.examTerms}
              examRegistrations={examRegistrations}
              siblingEnrollments={activeEnrollments}
              onSelectCourse={(nextId) => setDetailCourseId(nextId)}
              onBackToList={() => setDetailCourseId(null)}
              onOpenAllExams={() => {
                setDetailCourseId(null);
                setCoursesSubTab('exams');
              }}
            />
          ) : activeEnrollments.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-xl mx-auto">
              <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-900">
                Trenutno nemate aktivnih predmeta u tekućem semestru
              </h3>
              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                Studentska služba (administrator) ili predmetni nastavnik vrši upis na predmete
                prema vašem broju indeksa.
              </p>
              {historicalEnrollments.length > 0 && (
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={() => setCoursesSubTab('history')}
                >
                  <Archive className="w-4 h-4" />
                  Pregledaj stare semestre ({historicalEnrollments.length})
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Filter & Sort Toolbar */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      value={courseSearch}
                      onChange={(e) => setCourseSearch(e.target.value)}
                      placeholder="Pretraži predmete, smjerove ili osoblje..."
                      className="pl-9"
                    />
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
                    {(
                      [
                        { key: 'all', label: 'Svi programi' },
                        { key: 'strucni_rs', label: 'Stručni RS (2 god.)' },
                        { key: 'bachelor', label: 'Bachelor' },
                        { key: 'master', label: 'Master smjerovi' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setProgramFilter(tab.key)}
                        className={cn(
                          'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
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

                <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-600">Sortiraj po:</span>
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    {[
                      { key: 'name', label: 'Nazivu' },
                      { key: 'points', label: 'Bodovima' },
                      { key: 'pct', label: 'Procentu' },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setCourseSortBy(opt.key as 'name' | 'points' | 'pct')}
                        className={cn(
                          'px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0',
                          courseSortBy === opt.key
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Active Enrolled Courses Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {filteredActiveEnrollments.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Nema upisanih predmeta za izabrani kriterij pretrage.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="text-left py-3 px-4">Predmet</th>
                          <th className="text-left py-3 px-4">Nastavno osoblje</th>
                          <th className="text-right py-3 px-4 whitespace-nowrap">Osvojeno</th>
                          <th className="text-right py-3 px-4 whitespace-nowrap">Preostalo</th>
                          <th className="text-left py-3 px-4 whitespace-nowrap">Status / Ocjena</th>
                          <th className="text-right py-3 px-4">Detalji</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredActiveEnrollments.map((enr) => {
                          const sum = summariesByCourseId[enr.courseId];
                          const bundle = bundlesByCourseId[enr.courseId];
                          const crs = bundle?.course;
                          const assistantsStr = formatCourseAssistants(crs);
                          return (
                            <tr
                              key={enr.id}
                              onClick={() => setDetailCourseId(enr.courseId)}
                              className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                            >
                              <td className="py-3.5 px-4">
                                <div className="font-semibold text-slate-900">{enr.courseName}</div>
                                <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                  <span className="font-mono font-semibold text-blue-700">
                                    {enr.courseCode}
                                  </span>
                                  {crs && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono tabular-nums">
                                        {crs.ects} ECTS
                                      </span>
                                    </>
                                  )}
                                  {crs?.studyProgram && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>{crs.studyProgram}</span>
                                    </>
                                  )}
                                </div>
                              </td>

                              <td className="py-3.5 px-4">
                                <div className="text-xs text-slate-800">
                                  <span className="text-slate-500">
                                    {getCourseProfessors(crs, enr.leadProfessorName).length > 1
                                      ? 'Profesori: '
                                      : 'Profesor: '}
                                  </span>
                                  <span className="font-medium">
                                    {formatCourseProfessors(crs, enr.leadProfessorName)}
                                  </span>
                                </div>
                                {assistantsStr && (
                                  <div className="text-xs text-slate-500 mt-0.5">
                                    Asistenti: <span className="text-slate-700">{assistantsStr}</span>
                                  </div>
                                )}
                              </td>

                              <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                                {sum ? (
                                  <div>
                                    <span className="font-bold text-slate-900">
                                      {formatPoints(sum.totalEarnedPoints)}
                                    </span>{' '}
                                    <span className="text-xs text-slate-500">
                                      / {formatPoints(sum.maxPossiblePoints)} b
                                    </span>
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>

                              <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                                {sum ? `${formatPoints(sum.remainingAvailablePoints)} b` : '—'}
                              </td>

                              <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                                {sum?.studentVisibleFinalGrade !== null && sum !== undefined ? (
                                  <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold font-mono tabular-nums">
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                    Ocjena {sum.studentVisibleFinalGrade}
                                  </span>
                                ) : sum?.passedThreshold ? (
                                  <span className="text-emerald-700 font-medium">
                                    Ostvaren prag · U toku
                                  </span>
                                ) : (
                                  <span className="text-slate-500">Nastava u toku</span>
                                )}
                              </td>

                              <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDetailCourseId(enr.courseId);
                                  }}
                                >
                                  Otvori predmet
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* =====================================================================
          SUB-TAB 2: EXAM REGISTRATION ("Prijava ispita")
          ===================================================================== */}
      {coursesSubTab === 'exams' && profile && (
        <StudentExamsView
          studentProfile={profile}
          examTerms={activeExamTerms}
          examRegistrations={examRegistrations}
          coursesById={activeCoursesById}
        />
      )}

      {/* =====================================================================
          SUB-TAB 3: ARCHIVED SEMESTERS & PASSED COURSES ("Stari semestri")
          ===================================================================== */}
      {coursesSubTab === 'history' && (
        <div className="space-y-6">
          {selectedHistoryCourseId && selectedHistBundle && selectedHistSummary && profile ? (
            <StudentCourseDetailsView
              course={selectedHistBundle.course}
              summary={selectedHistSummary}
              studentProfile={profile}
              siblingEnrollments={visibleHistory}
              onSelectCourse={(nextId) => setSelectedHistoryCourseId(nextId)}
              onBackToList={() => setSelectedHistoryCourseId(null)}
              isArchivedView={true}
            />
          ) : (
            <>
              {/* Historical KPI Strip */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 sm:divide-x divide-slate-200">
                  <div className="p-4 sm:p-5">
                    <div className="text-xs text-slate-500">Arhivirani predmeti</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                      {archivedEnrollments.length}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Stari semestri u dosjeu</div>
                  </div>

                  <div className="p-4 sm:p-5">
                    <div className="text-xs text-slate-500">Ukupno položeno predmeta</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                      {passedEnrollmentsAll.length}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Sa zaključenom ocjenom ≥ 6
                    </div>
                  </div>

                  <div className="p-4 sm:p-5">
                    <div className="text-xs text-slate-500">Ostvareno ECTS kredita</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums">
                      {earnedEctsTotal} ECTS
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Zbir položenih predmeta</div>
                  </div>

                  <div className="p-4 sm:p-5">
                    <div className="text-xs text-slate-500">Prosjek zaključenih ocjena</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                      {passedEnrollmentsAll.length > 0 ? avgFinalGrade.toFixed(2) : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Na osnovu položenih ispita
                    </div>
                  </div>
                </div>
              </div>

              {/* Filter Bar */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {[
                    {
                      key: 'all_history',
                      label: `Sva historija (${historicalEnrollments.length})`,
                    },
                    {
                      key: 'archived',
                      label: `Arhivirani semestri (${archivedEnrollments.length})`,
                    },
                    { key: 'passed', label: `Položeni predmeti (${passedEnrollmentsAll.length})` },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() =>
                        setHistoryFilter(tab.key as 'archived' | 'passed' | 'all_history')
                      }
                      className={cn(
                        'px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
                        historyFilter === tab.key
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {distinctHistoryYears.length > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 whitespace-nowrap">Akademska godina:</span>
                    <select
                      value={historyYearFilter}
                      onChange={(e) => setHistoryYearFilter(e.target.value)}
                      className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-800 tabular-nums"
                    >
                      <option value="all">Sve godine</option>
                      {distinctHistoryYears.map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Historical Courses Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {visibleHistory.length === 0 ? (
                  <div className="p-8 text-center">
                    <Archive className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      Nema arhiviranih semestara ili položenih predmeta za izabrani filter
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
                      Kada uprava fakulteta arhivira završeni semestar ili nastavnik zaključi
                      prolaznu ocjenu, cjelokupna evidencija predmeta trajno ostaje dostupna ovdje.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="text-left py-3 px-4">Predmet</th>
                          <th className="text-left py-3 px-4 whitespace-nowrap">
                            Godina i semestar
                          </th>
                          <th className="text-left py-3 px-4">Nastavnik</th>
                          <th className="text-right py-3 px-4 whitespace-nowrap">Bodovi</th>
                          <th className="text-left py-3 px-4 whitespace-nowrap">Konačna ocjena</th>
                          <th className="text-right py-3 px-4">Detalji</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visibleHistory.map((enr) => {
                          const bundle = bundlesByCourseId[enr.courseId];
                          const crs = bundle?.course;
                          const sum = summariesByCourseId[enr.courseId];
                          const isArch = Boolean(enr.isArchived || crs?.isArchived);
                          return (
                            <tr
                              key={enr.id}
                              onClick={() => setSelectedHistoryCourseId(enr.courseId)}
                              className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                            >
                              <td className="py-3 px-4">
                                <div className="font-semibold text-slate-900">{enr.courseName}</div>
                                <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                                  <span className="font-mono text-blue-700">{enr.courseCode}</span>
                                  {crs && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono tabular-nums">
                                        {crs.ects} ECTS
                                      </span>
                                    </>
                                  )}
                                  {isArch && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>Arhiviran semestar</span>
                                    </>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-700">
                                <div className="font-mono font-semibold text-slate-900 tabular-nums">
                                  {crs?.academicYear || enr.academicYear}
                                </div>
                                <div className="text-slate-500 mt-0.5">
                                  {crs?.semester || enr.semester || 'Završen semestar'}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-700">
                                {formatCourseProfessors(crs, enr.leadProfessorName)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                                {sum
                                  ? `${formatPoints(sum.totalEarnedPoints)} / ${formatPoints(sum.maxPossiblePoints)}`
                                  : '—'}
                              </td>
                              <td className="py-3 px-4 text-xs whitespace-nowrap">
                                {sum?.studentVisibleFinalGrade !== null && sum !== undefined ? (
                                  <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold font-mono tabular-nums">
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                    Ocjena {sum.studentVisibleFinalGrade}
                                  </span>
                                ) : (
                                  <span className="text-slate-500">Arhivirano bez ocjene</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedHistoryCourseId(enr.courseId);
                                  }}
                                >
                                  Pregled bodova
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
