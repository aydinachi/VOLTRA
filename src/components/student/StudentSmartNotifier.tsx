import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ActivePortalMode } from '../../context/AuthContext';
import { formatBosnianDate, formatPoints } from '../../lib/utils';
import {
  getSeenExamRegsStorageKey,
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
  DEFAULT_NOTIFICATION_PREFS,
  Enrollment,
  ExamRegistration,
  ExamRegistrationStatus,
  ExamTerm,
  FinalGrade,
  FinalGradeStatus,
  GradingItem,
  NotificationPreferences,
  Score,
  SmartNotificationItem,
} from '../../types/zamio';

interface SeenExamTermSnapshot {
  isOpen: boolean;
  regOpen: string;
  regClose: string;
  examDate: string;
  examTime: string;
  classroom: string;
  title: string;
}

interface SeenScoreSnapshot {
  points: number;
  feedback: string;
}

interface SeenActivitySnapshot {
  points: number;
  description: string;
}

interface SeenGradeSnapshot {
  finalGrade: number;
  status: FinalGradeStatus;
}

function getStorageKey(prefix: string, uid: string): string {
  return `voltra_${prefix}_v2_${uid}`;
}

export function getSmartFeedStorageKey(uid: string): string {
  return `voltra_smart_feed_v2_${uid}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

export function readStoredSmartNotifications(uid: string): SmartNotificationItem[] {
  if (!uid) return [];
  return readJson<SmartNotificationItem[]>(getSmartFeedStorageKey(uid)) || [];
}

export function saveStoredSmartNotifications(
  uid: string,
  items: SmartNotificationItem[]
): void {
  if (!uid) return;
  writeJson(getSmartFeedStorageKey(uid), items.slice(0, 30));
}

function toTermSnapshot(term: ExamTerm): SeenExamTermSnapshot {
  return {
    isOpen: term.isOpen,
    regOpen: term.registrationOpenDate,
    regClose: term.registrationCloseDate,
    examDate: term.examDate,
    examTime: term.examTime,
    classroom: term.classroom,
    title: term.title,
  };
}

export interface NotificationNavigateOptions {
  courseId?: string;
  subTab?: 'courses' | 'exams' | 'history';
}

interface StudentSmartNotifierProps {
  studentUid: string;
  portalMode: ActivePortalMode;
  preferences?: NotificationPreferences;
  onNavigateTab: (navKey: string, options?: NotificationNavigateOptions) => void;
  onNotificationsChange: (items: SmartNotificationItem[]) => void;
}

export function StudentSmartNotifier({
  studentUid,
  portalMode,
  preferences,
  onNavigateTab,
  onNotificationsChange,
}: StudentSmartNotifierProps) {
  const prefs = preferences || DEFAULT_NOTIFICATION_PREFS;

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [enrollmentsLoaded, setEnrollmentsLoaded] = useState(false);

  const [coursesById, setCoursesById] = useState<Record<string, Course>>({});
  const [itemsById, setItemsById] = useState<Record<string, GradingItem>>({});
  const [sessionsById, setSessionsById] = useState<Record<string, AttendanceSession>>({});
  const [termsByCourseId, setTermsByCourseId] = useState<Record<string, ExamTerm[]>>({});
  const [loadedCourseIds, setLoadedCourseIds] = useState<Record<string, boolean>>({});

  const [scores, setScores] = useState<Score[]>([]);
  const [scoresLoaded, setScoresLoaded] = useState(false);

  const [activityAwards, setActivityAwards] = useState<ActivityAward[]>([]);
  const [activityLoaded, setActivityLoaded] = useState(false);

  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [attLoaded, setAttLoaded] = useState(false);

  const [finalGrades, setFinalGrades] = useState<FinalGrade[]>([]);
  const [gradesLoaded, setGradesLoaded] = useState(false);

  const [registrations, setRegistrations] = useState<ExamRegistration[]>([]);
  const [regsLoaded, setRegsLoaded] = useState(false);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annLoaded, setAnnLoaded] = useState(false);

  const onNavigateRef = useRef(onNavigateTab);
  onNavigateRef.current = onNavigateTab;

  const onFeedChangeRef = useRef(onNotificationsChange);
  onFeedChangeRef.current = onNotificationsChange;

  const pushSmartNotification = (params: {
    category: SmartNotificationItem['category'];
    title: string;
    description: string;
    targetNav: string;
    targetCourseId?: string;
    targetSubTab?: 'courses' | 'exams' | 'history';
    variant?: 'info' | 'success' | 'warning';
    actionLabel?: string;
  }) => {
    const newItem: SmartNotificationItem = {
      id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      category: params.category,
      title: params.title,
      description: params.description,
      createdAtIso: new Date().toISOString(),
      read: false,
      targetNav: params.targetNav,
      targetCourseId: params.targetCourseId,
      targetSubTab: params.targetSubTab,
    };

    const current = readStoredSmartNotifications(studentUid);
    const updated = [newItem, ...current].slice(0, 30);
    saveStoredSmartNotifications(studentUid, updated);
    onFeedChangeRef.current(updated);

    const toastFn =
      params.variant === 'success'
        ? toast.success
        : params.variant === 'warning'
          ? toast.warning
          : toast.info;

    toastFn(params.title, {
      description: params.description,
      duration: 7500,
      action: {
        label: params.actionLabel || 'Otvori',
        onClick: () =>
          onNavigateRef.current(params.targetNav, {
            courseId: params.targetCourseId,
            subTab: params.targetSubTab,
          }),
      },
    });
  };

  // Load initial stored feed on login
  useEffect(() => {
    if (!studentUid) return;
    onFeedChangeRef.current(readStoredSmartNotifications(studentUid));
  }, [studentUid]);

  // Core Student + Announcement Listeners
  useEffect(() => {
    if (!studentUid) return;
    setEnrollmentsLoaded(false);
    setScoresLoaded(false);
    setActivityLoaded(false);
    setAttLoaded(false);
    setGradesLoaded(false);
    setRegsLoaded(false);
    setAnnLoaded(false);
    setCoursesById({});
    setItemsById({});
    setSessionsById({});
    setTermsByCourseId({});
    setLoadedCourseIds({});

    const uEnr = subscribeStudentEnrollments(studentUid, (rows) => {
      setEnrollments(rows);
      setEnrollmentsLoaded(true);
    });
    const uScr = subscribeStudentScores(studentUid, (rows) => {
      setScores(rows);
      setScoresLoaded(true);
    });
    const uAct = subscribeStudentActivityAwards(studentUid, (rows) => {
      setActivityAwards(rows);
      setActivityLoaded(true);
    });
    const uAtt = subscribeStudentAttendanceRecords(studentUid, (rows) => {
      setAttendanceRecords(rows);
      setAttLoaded(true);
    });
    const uGrd = subscribeStudentFinalGrades(studentUid, (rows) => {
      setFinalGrades(rows);
      setGradesLoaded(true);
    });
    const uReg = subscribeStudentExamRegistrations(studentUid, (rows) => {
      setRegistrations(rows);
      setRegsLoaded(true);
    });
    const uAnn = subscribePublishedAnnouncements((rows) => {
      setAnnouncements(rows);
      setAnnLoaded(true);
    });

    return () => {
      uEnr();
      uScr();
      uAct();
      uAtt();
      uGrd();
      uReg();
      uAnn();
    };
  }, [studentUid]);

  const enrolledCourseKey = useMemo(
    () => enrollments.map((e) => e.courseId).sort().join(','),
    [enrollments]
  );

  useEffect(() => {
    if (!enrolledCourseKey) {
      setCoursesById({});
      setItemsById({});
      setSessionsById({});
      setTermsByCourseId({});
      setLoadedCourseIds({});
      return;
    }

    const courseIds = enrolledCourseKey.split(',').filter(Boolean);
    const unsubs = courseIds.map((courseId) =>
      subscribeStudentEnrolledCourseLive(courseId, (bundle: StudentCourseBundle) => {
        if (bundle.course) {
          setCoursesById((prev) => ({ ...prev, [courseId]: bundle.course! }));
        }
        setItemsById((prev) => {
          const next = { ...prev };
          for (const it of bundle.items) next[it.id] = it;
          return next;
        });
        setSessionsById((prev) => {
          const next = { ...prev };
          for (const ses of bundle.sessions) next[ses.id] = ses;
          return next;
        });
        setTermsByCourseId((prev) => ({ ...prev, [courseId]: bundle.examTerms }));
        setLoadedCourseIds((prev) => ({ ...prev, [courseId]: true }));
      })
    );

    return () => {
      for (const u of unsubs) u();
    };
  }, [enrolledCourseKey]);

  const allCoursesReady = useMemo(() => {
    if (!enrollmentsLoaded) return false;
    if (enrollments.length === 0) return true;
    return enrollments.every((e) => loadedCourseIds[e.courseId]);
  }, [enrollmentsLoaded, enrollments, loadedCourseIds]);

  const allExamTerms = useMemo(() => {
    const list: ExamTerm[] = [];
    for (const enr of enrollments) {
      const terms = termsByCourseId[enr.courseId];
      if (terms) list.push(...terms);
    }
    return list;
  }, [enrollments, termsByCourseId]);

  // 1. Finalized Results ("Objava rezultata / konačne ocjene")
  useEffect(() => {
    if (!studentUid || !gradesLoaded || !allCoursesReady) return;
    const key = getStorageKey('seen_grades', studentUid);
    const existing = readJson<Record<string, SeenGradeSnapshot>>(key);

    if (!existing) {
      const init: Record<string, SeenGradeSnapshot> = {};
      for (const g of finalGrades) {
        init[g.id] = { finalGrade: g.finalGrade, status: g.status };
      }
      writeJson(key, init);
      return;
    }

    if (portalMode !== 'student') {
      const silent = { ...existing };
      let changed = false;
      for (const g of finalGrades) {
        if (!silent[g.id] && g.isSeed) {
          silent[g.id] = { finalGrade: g.finalGrade, status: g.status };
          changed = true;
        }
      }
      if (changed) writeJson(key, silent);
      return;
    }

    const updated: Record<string, SeenGradeSnapshot> = {};
    for (const g of finalGrades) {
      const prev = existing[g.id];
      updated[g.id] = { finalGrade: g.finalGrade, status: g.status };
      if (!prev && g.isSeed) continue;

      const crsCode = coursesById[g.courseId]?.code || 'Predmet';
      const crsName = coursesById[g.courseId]?.name || '';

      if (
        g.status === FinalGradeStatus.FINALIZED &&
        (!prev || prev.status !== FinalGradeStatus.FINALIZED || prev.finalGrade !== g.finalGrade)
      ) {
        if (prefs.resultsPublished) {
          pushSmartNotification({
            category: 'resultsPublished',
            title: `Objavljeni konačni rezultati — ${crsCode}`,
            description: `${crsName ? `${crsName}: ` : ''}Zaključena ocjena ${g.finalGrade} (${formatPoints(g.totalPoints)} bodova).`,
            targetNav: 'predmeti',
            targetCourseId: g.courseId,
            targetSubTab: 'courses',
            variant: 'success',
            actionLabel: 'Pregled predmeta',
          });
        }
      }
    }
    writeJson(key, updated);
  }, [studentUid, gradesLoaded, allCoursesReady, finalGrades, portalMode, coursesById, prefs.resultsPublished]);

  // 2. Points Entered or Changed ("Unos ili promjena bodova")
  useEffect(() => {
    if (!studentUid || !scoresLoaded || !allCoursesReady) return;
    const key = getStorageKey('seen_scores', studentUid);
    const existing = readJson<Record<string, SeenScoreSnapshot>>(key);

    if (!existing) {
      const init: Record<string, SeenScoreSnapshot> = {};
      for (const s of scores) {
        init[s.id] = { points: s.points, feedback: s.feedback };
      }
      writeJson(key, init);
      return;
    }

    if (portalMode !== 'student') {
      const silent = { ...existing };
      let changed = false;
      for (const s of scores) {
        if (!silent[s.id] && s.isSeed) {
          silent[s.id] = { points: s.points, feedback: s.feedback };
          changed = true;
        }
      }
      if (changed) writeJson(key, silent);
      return;
    }

    const updated: Record<string, SeenScoreSnapshot> = {};
    for (const s of scores) {
      const prev = existing[s.id];
      updated[s.id] = { points: s.points, feedback: s.feedback };
      if (!prev && s.isSeed) continue;

      const crsCode = coursesById[s.courseId]?.code || 'Predmet';
      const itemObj = itemsById[s.itemId];
      const itemLabel = itemObj?.name || 'Stavka ocjenjivanja';
      const maxLabel = itemObj ? ` / ${formatPoints(itemObj.maxPoints)} b` : ' b';

      if (!prev) {
        if (prefs.pointsChanged) {
          pushSmartNotification({
            category: 'pointsChanged',
            title: `Upisani novi bodovi — ${crsCode}`,
            description: `${itemLabel}: osvojeno ${formatPoints(s.points)}${maxLabel}${s.feedback ? ` (${s.feedback})` : ''}.`,
            targetNav: 'predmeti',
            targetCourseId: s.courseId,
            targetSubTab: 'courses',
            variant: 'success',
            actionLabel: 'Detalji predmeta',
          });
        }
      } else if (prev.points !== s.points || prev.feedback !== s.feedback) {
        if (prefs.pointsChanged) {
          pushSmartNotification({
            category: 'pointsChanged',
            title: `Izmjena bodova — ${crsCode}`,
            description: `${itemLabel}: novi broj bodova ${formatPoints(s.points)}${maxLabel} (ranije ${formatPoints(prev.points)} b).`,
            targetNav: 'predmeti',
            targetCourseId: s.courseId,
            targetSubTab: 'courses',
            variant: 'info',
            actionLabel: 'Detalji predmeta',
          });
        }
      }
    }
    writeJson(key, updated);
  }, [studentUid, scoresLoaded, allCoursesReady, scores, portalMode, coursesById, itemsById, prefs.pointsChanged]);

  // 2B. Activity Points Awarded or Updated ("Bodovi za aktivnost")
  useEffect(() => {
    if (!studentUid || !activityLoaded || !allCoursesReady) return;
    const key = getStorageKey('seen_activity_awards', studentUid);
    const existing = readJson<Record<string, SeenActivitySnapshot>>(key);

    if (!existing) {
      const init: Record<string, SeenActivitySnapshot> = {};
      for (const a of activityAwards) {
        init[a.id] = { points: a.points, description: a.description };
      }
      writeJson(key, init);
      return;
    }

    if (portalMode !== 'student') {
      const silent = { ...existing };
      let changed = false;
      for (const a of activityAwards) {
        if (!silent[a.id] && a.isSeed) {
          silent[a.id] = { points: a.points, description: a.description };
          changed = true;
        }
      }
      if (changed) writeJson(key, silent);
      return;
    }

    const updated: Record<string, SeenActivitySnapshot> = {};
    for (const a of activityAwards) {
      const prev = existing[a.id];
      updated[a.id] = { points: a.points, description: a.description };
      if (!prev && a.isSeed) continue;

      const crsCode = coursesById[a.courseId]?.code || 'Predmet';

      if (!prev) {
        if (prefs.pointsChanged) {
          pushSmartNotification({
            category: 'pointsChanged',
            title:
              a.points > 0
                ? `Dodijeljeni bodovi za aktivnost — ${crsCode}`
                : `Evidentiran plus (+) za aktivnost — ${crsCode}`,
            description:
              a.points > 0
                ? `${a.description}: +${formatPoints(a.points)} bodova (${formatBosnianDate(a.date)}).`
                : `${a.description} (${formatBosnianDate(a.date)}).`,
            targetNav: 'predmeti',
            targetCourseId: a.courseId,
            targetSubTab: 'courses',
            variant: 'success',
            actionLabel: 'Detalji predmeta',
          });
        }
      } else if (prev.points !== a.points || prev.description !== a.description) {
        if (prefs.pointsChanged) {
          pushSmartNotification({
            category: 'pointsChanged',
            title:
              a.points > 0
                ? `Ažurirani bodovi za aktivnost — ${crsCode}`
                : `Ažurirana evidencija aktivnosti (+) — ${crsCode}`,
            description:
              a.points > 0
                ? `${a.description}: +${formatPoints(a.points)} bodova.`
                : `${a.description} (${formatBosnianDate(a.date)}).`,
            targetNav: 'predmeti',
            targetCourseId: a.courseId,
            targetSubTab: 'courses',
            variant: 'info',
            actionLabel: 'Detalji predmeta',
          });
        }
      }
    }
    writeJson(key, updated);
  }, [studentUid, activityLoaded, allCoursesReady, activityAwards, portalMode, coursesById, prefs.pointsChanged]);

  // 3. Attendance Recorded ("Unos ili promjena prisustva")
  useEffect(() => {
    if (!studentUid || !attLoaded || !allCoursesReady) return;
    const key = getStorageKey('seen_att', studentUid);
    const existing = readJson<Record<string, boolean>>(key);

    if (!existing) {
      const init: Record<string, boolean> = {};
      for (const r of attendanceRecords) {
        init[r.id] = r.present;
      }
      writeJson(key, init);
      return;
    }

    if (portalMode !== 'student') {
      const silent = { ...existing };
      let changed = false;
      for (const r of attendanceRecords) {
        if (silent[r.id] === undefined && r.isSeed) {
          silent[r.id] = r.present;
          changed = true;
        }
      }
      if (changed) writeJson(key, silent);
      return;
    }

    const updated: Record<string, boolean> = {};
    for (const r of attendanceRecords) {
      const prev = existing[r.id];
      updated[r.id] = r.present;
      if (prev === undefined && r.isSeed) continue;

      if (prev === undefined || prev !== r.present) {
        if (prefs.attendanceRecorded) {
          const crsCode = coursesById[r.courseId]?.code || 'Predmet';
          const ses = sessionsById[r.sessionId];
          const dateInfo = ses ? ` (${formatBosnianDate(ses.date)})` : '';
          pushSmartNotification({
            category: 'attendanceRecorded',
            title: `Evidentirano prisustvo — ${crsCode}`,
            description: `Status za termin${dateInfo}: ${r.present ? 'Prisutan' : 'Odsutan'}${r.note ? ` · ${r.note}` : ''}.`,
            targetNav: 'predmeti',
            targetCourseId: r.courseId,
            targetSubTab: 'courses',
            variant: r.present ? 'success' : 'warning',
            actionLabel: 'Prisustvo',
          });
        }
      }
    }
    writeJson(key, updated);
  }, [studentUid, attLoaded, allCoursesReady, attendanceRecords, portalMode, coursesById, sessionsById, prefs.attendanceRecorded]);

  // 4. Exam Terms & Registration Updates ("Objava novog roka ili promjena statusa prijave")
  useEffect(() => {
    if (!studentUid || !allCoursesReady) return;
    const termsKey = getStorageKey('seen_exam_terms', studentUid);
    const existingBaseline = readJson<Record<string, SeenExamTermSnapshot>>(termsKey);

    if (!existingBaseline) {
      const initialMap: Record<string, SeenExamTermSnapshot> = {};
      for (const term of allExamTerms) {
        initialMap[term.id] = toTermSnapshot(term);
      }
      writeJson(termsKey, initialMap);
      return;
    }

    if (portalMode !== 'student') {
      let addedSeed = false;
      const nextSilent = { ...existingBaseline };
      for (const term of allExamTerms) {
        if (!nextSilent[term.id] && term.isSeed) {
          nextSilent[term.id] = toTermSnapshot(term);
          addedSeed = true;
        }
      }
      if (addedSeed) writeJson(termsKey, nextSilent);
      return;
    }

    const updatedBaseline: Record<string, SeenExamTermSnapshot> = {};
    for (const term of allExamTerms) {
      const prev = existingBaseline[term.id];
      updatedBaseline[term.id] = toTermSnapshot(term);

      if (!prev) {
        if (term.isSeed) continue;
        if (prefs.newExamTerm) {
          pushSmartNotification({
            category: 'newExamTerm',
            title: `Novi ispitni rok — ${term.courseCode}`,
            description: `${term.title} (${formatBosnianDate(term.examDate)}${term.examTime ? ` u ${term.examTime}` : ''}) · Prijava do ${formatBosnianDate(term.registrationCloseDate)}.`,
            targetNav: 'predmeti',
            targetCourseId: term.courseId,
            targetSubTab: 'exams',
            variant: 'info',
            actionLabel: 'Prijava ispita',
          });
        }
        continue;
      }

      if (prev.isOpen !== term.isOpen) {
        if (prefs.newExamTerm) {
          pushSmartNotification({
            category: 'newExamTerm',
            title: term.isOpen
              ? `Prijave za ispit su otvorene — ${term.courseCode}`
              : `Prijave za ispit su zaključane — ${term.courseCode}`,
            description: term.isOpen
              ? `${term.title} · Možete prijaviti izlazak do ${formatBosnianDate(term.registrationCloseDate)}.`
              : `Profesor je zaključao prijave za rok „${term.title}“ (${formatBosnianDate(term.examDate)}).`,
            targetNav: 'predmeti',
            targetCourseId: term.courseId,
            targetSubTab: 'exams',
            variant: term.isOpen ? 'success' : 'warning',
            actionLabel: 'Ispiti',
          });
        }
        continue;
      }

      const datesOrVenueChanged =
        prev.regOpen !== term.registrationOpenDate ||
        prev.regClose !== term.registrationCloseDate ||
        prev.examDate !== term.examDate ||
        prev.examTime !== term.examTime ||
        prev.classroom !== term.classroom;

      if (datesOrVenueChanged && prefs.newExamTerm) {
        pushSmartNotification({
          category: 'newExamTerm',
          title: `Ažuriran termin ili rok prijave — ${term.courseCode}`,
          description: `${term.title}: ispit ${formatBosnianDate(term.examDate)}${term.examTime ? ` u ${term.examTime}` : ''}, prijava do ${formatBosnianDate(term.registrationCloseDate)}.`,
          targetNav: 'predmeti',
          targetCourseId: term.courseId,
          targetSubTab: 'exams',
          variant: 'info',
          actionLabel: 'Detalji roka',
        });
      }
    }
    writeJson(termsKey, updatedBaseline);
  }, [studentUid, allCoursesReady, allExamTerms, portalMode, prefs.newExamTerm]);

  useEffect(() => {
    if (!studentUid || !regsLoaded) return;
    const regsKey = getSeenExamRegsStorageKey(studentUid);
    const existingRegs = readJson<Record<string, string>>(regsKey);

    if (!existingRegs) {
      const initialMap: Record<string, string> = {};
      for (const reg of registrations) {
        initialMap[reg.id] = reg.status;
      }
      writeJson(regsKey, initialMap);
      return;
    }

    if (portalMode !== 'student') {
      let addedSeed = false;
      const nextSilent = { ...existingRegs };
      for (const reg of registrations) {
        if (!nextSilent[reg.id] && reg.isSeed) {
          nextSilent[reg.id] = reg.status;
          addedSeed = true;
        }
      }
      if (addedSeed) writeJson(regsKey, nextSilent);
      return;
    }

    const updatedRegs: Record<string, string> = {};
    for (const reg of registrations) {
      const prevStatus = existingRegs[reg.id];
      updatedRegs[reg.id] = reg.status;
      if (!prevStatus && reg.isSeed) continue;

      if (prevStatus !== reg.status && prefs.newExamTerm) {
        const isNowRegistered = reg.status === ExamRegistrationStatus.REGISTERED;
        pushSmartNotification({
          category: 'newExamTerm',
          title: isNowRegistered
            ? `Potvrđena prijava ispita — ${reg.courseCode}`
            : `Promjena statusa prijave — ${reg.courseCode}`,
          description: isNowRegistered
            ? `Evidentirana je prijava za „${reg.termTitle}“ (${formatBosnianDate(reg.examDate)}).`
            : `Status vaše prijave za „${reg.termTitle}“ promijenjen je u: Odjavljen.`,
          targetNav: 'predmeti',
          targetCourseId: reg.courseId,
          targetSubTab: 'exams',
          variant: isNowRegistered ? 'success' : 'warning',
          actionLabel: 'Moje prijave',
        });
      }
    }
    writeJson(regsKey, updatedRegs);
  }, [studentUid, regsLoaded, registrations, portalMode, prefs.newExamTerm]);

  // 5. Official Admin Announcements ("Zvanična obavještenja administratora")
  useEffect(() => {
    if (!studentUid || !annLoaded) return;
    const key = getStorageKey('seen_announcements', studentUid);
    const existing = readJson<Record<string, boolean>>(key);

    if (!existing) {
      const init: Record<string, boolean> = {};
      for (const a of announcements) {
        init[a.id] = true;
      }
      writeJson(key, init);
      return;
    }

    if (portalMode === 'admin') {
      const silent = { ...existing };
      for (const a of announcements) {
        silent[a.id] = true;
      }
      writeJson(key, silent);
      return;
    }

    const updated: Record<string, boolean> = { ...existing };
    for (const a of announcements) {
      if (existing[a.id]) continue;
      updated[a.id] = true;
      if (a.isSeed) continue;

      const relevantForStudent =
        portalMode === 'student' &&
        (a.audience === AnnouncementAudience.ALL ||
          a.audience === AnnouncementAudience.STUDENTS);
      const relevantForProf =
        portalMode === 'professor' &&
        (a.audience === AnnouncementAudience.ALL ||
          a.audience === AnnouncementAudience.PROFESSORS);

      if ((relevantForStudent || relevantForProf) && prefs.announcements) {
        pushSmartNotification({
          category: 'announcements',
          title: `Novo zvanično obavještenje`,
          description: a.title,
          targetNav: 'obavjestenja',
          variant: 'info',
          actionLabel: 'Pročitaj',
        });
      }
    }
    writeJson(key, updated);
  }, [studentUid, annLoaded, announcements, portalMode, prefs.announcements]);

  return null;
}
