import React, { useState } from 'react';
import { Toaster } from 'sonner';
import {
  AppShell,
  PROFESSOR_NAV_ITEMS,
  ProfessorNavKey,
  STUDENT_NAV_ITEMS,
  StudentNavKey,
} from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './components/LoginPage';
import { ProfessorPortal } from './components/professor/ProfessorPortal';
import { StudentPortal } from './components/student/StudentPortal';
import { AuthProvider, useAuth } from './context/AuthContext';

function ZamioContent() {
  const { firebaseUser, profile, authReady, portalMode } = useAuth();
  const [studentNav, setStudentNav] = useState<StudentNavKey>('pocetna');
  const [professorNav, setProfessorNav] = useState<ProfessorNavKey>('pocetna');

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-slate-600">
          <div className="w-8 h-8 rounded-full border-2 border-blue-700 border-t-transparent animate-spin" />
          <span className="text-sm font-medium">Učitavanje Zamio portala...</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    return <LoginPage />;
  }

  const isProfView = portalMode === 'professor';
  const activeKey = isProfView ? professorNav : studentNav;
  const pageTitle = isProfView
    ? PROFESSOR_NAV_ITEMS.find((i) => i.key === professorNav)?.label || 'Početna'
    : STUDENT_NAV_ITEMS.find((i) => i.key === studentNav)?.label || 'Početna';

  return (
    <AppShell
      portalMode={portalMode}
      activeNav={activeKey}
      onSelectNav={(key) => {
        if (isProfView) {
          setProfessorNav(key as ProfessorNavKey);
        } else {
          setStudentNav(key as StudentNavKey);
        }
      }}
      pageTitle={pageTitle}
    >
      {isProfView ? (
        <ProfessorPortal
          activeNav={professorNav}
          onNavigate={(k) => setProfessorNav(k)}
        />
      ) : (
        <StudentPortal
          activeNav={studentNav}
          onNavigate={(k) => setStudentNav(k)}
        />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ZamioContent />
        <Toaster position="bottom-right" richColors closeButton />
      </AuthProvider>
    </ErrorBoundary>
  );
}
