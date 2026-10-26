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
import { StudentPortal } from './components/student/StudentPortal';
import {
  saveStoredSmartNotifications,
  StudentSmartNotifier,
} from './components/student/StudentSmartNotifier';
import { AuthProvider, useAuth } from './context/AuthContext';
import { subscribeAcademicState } from './services/zamioService';
import { AcademicState, SmartNotificationItem } from './types/zamio';

function VoltraContent() {
  const { firebaseUser, profile, authReady, portalMode } = useAuth();
  const [studentNav, setStudentNav] = useState<StudentNavKey>('pocetna');
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

  const navigateInCurrentMode = (key: string) => {
    if (portalMode === 'admin') {
      const validAdminKeys = ADMIN_NAV_ITEMS.map((i) => i.key) as string[];
      setAdminNav(validAdminKeys.includes(key) ? (key as AdminNavKey) : 'obavjestenja');
    } else if (portalMode === 'professor') {
      const validProfKeys = PROFESSOR_NAV_ITEMS.map((i) => i.key) as string[];
      setProfessorNav(validProfKeys.includes(key) ? (key as ProfessorNavKey) : 'pocetna');
    } else {
      const validStudentKeys = STUDENT_NAV_ITEMS.map((i) => i.key) as string[];
      setStudentNav(validStudentKeys.includes(key) ? (key as StudentNavKey) : 'pocetna');
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
        : STUDENT_NAV_ITEMS.find((i) => i.key === studentNav)?.label || 'Pregled i bodovi';

  const handleSelectNotification = (item: SmartNotificationItem) => {
    const updated = notifications.map((n) => (n.id === item.id ? { ...n, read: true } : n));
    setNotifications(updated);
    saveStoredSmartNotifications(profile.uid, updated);
    if (item.targetNav) {
      navigateInCurrentMode(item.targetNav);
    }
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
        onSelectNav={navigateInCurrentMode}
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
          <StudentPortal activeNav={studentNav} onNavigate={(k) => setStudentNav(k)} />
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
