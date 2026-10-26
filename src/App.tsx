import React, { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import {
  ADMIN_NAV_ITEMS,
  AdminNavKey,
  AppShell,
  PROFESSOR_NAV_ITEMS,
  ProfessorNavKey,
  STUDENT_NAV_ITEMS,
  StudentNavKey,
} from './components/AppShell';
import { AdminPortal } from './components/admin/AdminPortal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './components/LoginPage';
import { ProfessorPortal } from './components/professor/ProfessorPortal';
import { StudentDeepLinkTarget, StudentPortal } from './components/student/StudentPortal';
import {
  NotificationNavigateOptions,
  saveStoredSmartNotifications,
  StudentSmartNotifier,
} from './components/student/StudentSmartNotifier';
import { AuthProvider, useAuth } from './context/AuthContext';
import { subscribeAcademicState } from './services/zamioService';
import { AcademicState, SmartNotificationItem } from './types/zamio';

function VoltraContent() {
  const { firebaseUser, profile, authReady, portalMode } = useAuth();
  const [studentNav, setStudentNav] = useState<StudentNavKey>('pocetna');
  const [studentDeepLink, setStudentDeepLink] = useState<StudentDeepLinkTarget | null>(null);
  const [professorNav, setProfessorNav] = useState<ProfessorNavKey>('pocetna');
  const [adminNav, setAdminNav] = useState<AdminNavKey>('korisnici');
  const [notifications, setNotifications] = useState<SmartNotificationItem[]>([]);
  const [academicState, setAcademicState] = useState<AcademicState | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    const unsub = subscribeAcademicState(setAcademicState);
    return () => unsub();
  }, [firebaseUser]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-slate-600">
          <div className="w-8 h-8 rounded-full border-2 border-blue-700 border-t-transparent animate-spin" />
          <span className="text-sm font-medium">Učitavanje VOLTRA portala...</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    return <LoginPage />;
  }

  const navigateInCurrentMode = (key: string, options?: NotificationNavigateOptions) => {
    if (portalMode === 'admin') {
      const validAdminKeys = ADMIN_NAV_ITEMS.map((i) => i.key) as string[];
      setAdminNav(validAdminKeys.includes(key) ? (key as AdminNavKey) : 'obavjestenja');
      return;
    }

    if (portalMode === 'professor') {
      const validProfKeys = PROFESSOR_NAV_ITEMS.map((i) => i.key) as string[];
      setProfessorNav(validProfKeys.includes(key) ? (key as ProfessorNavKey) : 'pocetna');
      return;
    }

    // Student navigation + graceful mapping for legacy notification keys
    if (key === 'ispiti') {
      setStudentNav('predmeti');
      setStudentDeepLink({
        subTab: 'exams',
        courseId: options?.courseId,
        nonce: Date.now(),
      });
      return;
    }
    if (key === 'semestri') {
      setStudentNav('predmeti');
      setStudentDeepLink({
        subTab: 'history',
        courseId: options?.courseId,
        nonce: Date.now(),
      });
      return;
    }
    if (key === 'prisustvo' || key === 'zadaci') {
      setStudentNav('predmeti');
      setStudentDeepLink({
        subTab: 'courses',
        courseId: options?.courseId,
        nonce: Date.now(),
      });
      return;
    }

    const validStudentKeys = STUDENT_NAV_ITEMS.map((i) => i.key) as string[];
    const nextStudentKey: StudentNavKey = validStudentKeys.includes(key)
      ? (key as StudentNavKey)
      : 'pocetna';

    setStudentNav(nextStudentKey);
    if (options?.courseId || options?.subTab) {
      setStudentDeepLink({
        subTab: options.subTab || 'courses',
        courseId: options.courseId,
        nonce: Date.now(),
      });
    } else if (nextStudentKey === 'predmeti') {
      // Clicking "Moji predmeti" in sidebar resets to main course overview list
      setStudentDeepLink({
        subTab: 'courses',
        courseId: undefined,
        nonce: Date.now(),
      });
    }
  };

  const activeKey =
    portalMode === 'admin'
      ? adminNav
      : portalMode === 'professor'
        ? professorNav
        : studentNav;

  const pageTitle =
    portalMode === 'admin'
      ? ADMIN_NAV_ITEMS.find((i) => i.key === adminNav)?.label || 'Administratorski portal'
      : portalMode === 'professor'
        ? PROFESSOR_NAV_ITEMS.find((i) => i.key === professorNav)?.label || 'Pregled predmeta'
        : STUDENT_NAV_ITEMS.find((i) => i.key === studentNav)?.label || 'Početna';

  const handleSelectNotification = (item: SmartNotificationItem) => {
    const updated = notifications.map((n) => (n.id === item.id ? { ...n, read: true } : n));
    setNotifications(updated);
    saveStoredSmartNotifications(profile.uid, updated);
    if (item.targetNav) {
      navigateInCurrentMode(item.targetNav, {
        courseId: item.targetCourseId,
        subTab: item.targetSubTab,
      });
    }
  };

  const handleMarkSingleNotificationRead = (itemId: string) => {
    const updated = notifications.map((n) => (n.id === itemId ? { ...n, read: true } : n));
    setNotifications(updated);
    saveStoredSmartNotifications(profile.uid, updated);
  };

  const handleMarkAllRead = () => {
    const updated = notifications.map((n) => ({ ...n, read: true }));
    setNotifications(updated);
    saveStoredSmartNotifications(profile.uid, updated);
  };

  return (
    <>
      <StudentSmartNotifier
        studentUid={profile.uid}
        portalMode={portalMode}
        preferences={profile.notificationPrefs}
        onNavigateTab={navigateInCurrentMode}
        onNotificationsChange={setNotifications}
      />
      <AppShell
        portalMode={portalMode}
        activeNav={activeKey}
        onSelectNav={(k) => navigateInCurrentMode(k)}
        pageTitle={pageTitle}
        activeAcademicYear={academicState?.activeAcademicYear || profile.academicYear}
        notifications={notifications}
        onSelectNotification={handleSelectNotification}
        onMarkAllRead={handleMarkAllRead}
        onOpenNotificationSettings={() => navigateInCurrentMode('profil')}
      >
        {portalMode === 'admin' ? (
          <AdminPortal activeNav={adminNav} onNavigate={(k) => setAdminNav(k)} />
        ) : portalMode === 'professor' ? (
          <ProfessorPortal activeNav={professorNav} onNavigate={(k) => setProfessorNav(k)} />
        ) : (
          <StudentPortal
            activeNav={studentNav}
            onNavigate={(k) => setStudentNav(k)}
            deepLink={studentDeepLink}
            notifications={notifications}
            onSelectNotification={handleSelectNotification}
            onMarkNotificationRead={handleMarkSingleNotificationRead}
            onMarkAllNotificationsRead={handleMarkAllRead}
          />
        )}
      </AppShell>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <VoltraContent />
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </ErrorBoundary>
  );
}
