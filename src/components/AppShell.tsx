import React, { useState } from 'react';
import {
  Award,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  Home,
  LogOut,
  Menu,
  Settings,
  User,
  Users,
  X,
} from 'lucide-react';
import { ActivePortalMode, useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { UserRole } from '../types/zamio';
import { Button } from './ui/button';

export type StudentNavKey =
  | 'pocetna'
  | 'predmeti'
  | 'ocjene'
  | 'prisustvo'
  | 'zadaci'
  | 'profil';

export type ProfessorNavKey =
  | 'pocetna'
  | 'predmeti'
  | 'studenti'
  | 'bodovi'
  | 'prisustvo'
  | 'postavke'
  | 'profil';

interface NavItem<T extends string> {
  key: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const STUDENT_NAV_ITEMS: NavItem<StudentNavKey>[] = [
  { key: 'pocetna', label: 'Početna', icon: Home },
  { key: 'predmeti', label: 'Moji predmeti', icon: BookOpen },
  { key: 'ocjene', label: 'Ocjene i bodovi', icon: Award },
  { key: 'prisustvo', label: 'Prisustvo', icon: CalendarCheck },
  { key: 'zadaci', label: 'Zadaci', icon: ClipboardList },
  { key: 'profil', label: 'Profil', icon: User },
];

export const PROFESSOR_NAV_ITEMS: NavItem<ProfessorNavKey>[] = [
  { key: 'pocetna', label: 'Početna', icon: Home },
  { key: 'predmeti', label: 'Moji predmeti', icon: BookOpen },
  { key: 'studenti', label: 'Studenti', icon: Users },
  { key: 'bodovi', label: 'Evidencija bodova', icon: ClipboardList },
  { key: 'prisustvo', label: 'Prisustvo', icon: CalendarCheck },
  { key: 'postavke', label: 'Postavke predmeta', icon: Settings },
  { key: 'profil', label: 'Profil', icon: User },
];

interface AppShellProps {
  portalMode: ActivePortalMode;
  activeNav: string;
  onSelectNav: (key: string) => void;
  pageTitle: string;
  children: React.ReactNode;
}

export function AppShell({
  portalMode,
  activeNav,
  onSelectNav,
  pageTitle,
  children,
}: AppShellProps) {
  const { profile, isAdminUser, setPortalMode, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems =
    portalMode === 'professor' ? PROFESSOR_NAV_ITEMS : STUDENT_NAV_ITEMS;

  const canSwitchPortal = isAdminUser || profile?.role === UserRole.ADMIN;

  const handleNavClick = (key: string) => {
    onSelectNav(key);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-16 px-5 flex items-center gap-2.5 border-b border-slate-200">
          <div className="w-8 h-8 rounded-lg bg-blue-700 flex items-center justify-center text-white shrink-0">
            <GraduationCap className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold tracking-tight text-slate-900 leading-none">
              Zamio
            </div>
            <div className="text-[11px] text-slate-500 mt-1 truncate">
              ETF Student Portal
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleNavClick(item.key)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap',
                  isActive
                    ? 'bg-blue-50 text-blue-800 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )}
              >
                <Icon
                  className={cn(
                    'w-4 h-4 shrink-0',
                    isActive ? 'text-blue-700' : 'text-slate-400'
                  )}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Portal perspective switcher strictly for verified Administrator */}
        {canSwitchPortal && (
          <div className="p-3 border-t border-slate-200 bg-slate-50/70">
            <div className="text-[11px] font-medium text-slate-500 px-1 mb-1.5">
              Aktivni prikaz portala
            </div>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setPortalMode('student');
                  onSelectNav('pocetna');
                }}
                className={cn(
                  'py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap',
                  portalMode === 'student'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                Student
              </button>
              <button
                type="button"
                onClick={() => {
                  setPortalMode('professor');
                  onSelectNav('pocetna');
                }}
                className={cn(
                  'py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap',
                  portalMode === 'professor'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                Profesor
              </button>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500">
          <div className="font-medium text-slate-800 truncate">{profile?.fullName}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-slate-500 truncate">
            <span>{portalMode === 'professor' ? 'Nastavno osoblje' : 'Student'}</span>
            {profile?.studentIndex && portalMode === 'student' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{profile.studentIndex}</span>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden bg-slate-950/45"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="w-72 max-w-[85vw] h-full bg-white border-r border-slate-200 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-700 flex items-center justify-center text-white">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <span className="font-bold text-slate-900">Zamio</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Zatvori meni"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleNavClick(item.key)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer',
                      isActive
                        ? 'bg-blue-50 text-blue-800 font-semibold'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {canSwitchPortal && (
              <div className="p-3 border-t border-slate-200">
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setPortalMode('student');
                      handleNavClick('pocetna');
                    }}
                    className={cn(
                      'py-1.5 text-xs font-medium rounded-md cursor-pointer',
                      portalMode === 'student' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    )}
                  >
                    Student
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPortalMode('professor');
                      handleNavClick('pocetna');
                    }}
                    className={cn(
                      'py-1.5 text-xs font-medium rounded-md cursor-pointer',
                      portalMode === 'professor' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    )}
                  >
                    Profesor
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar Contract: Current Page Breadcrumb — Context — Profile & Logout */}
        <header className="sticky top-0 z-20 h-14 sm:h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
              aria-label="Otvori navigaciju"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 whitespace-nowrap">Zamio</span>
              <span aria-hidden="true" className="hidden sm:inline text-slate-300">/</span>
              <h1 className="font-semibold text-slate-900 truncate">{pageTitle}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-5 shrink-0">
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
              <span>Akademska godina</span>
              <span className="font-mono font-medium text-slate-800 tabular-nums">
                {profile?.academicYear || '2026/2027'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => onSelectNav('profil')}
              className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-700 hover:text-blue-700 transition-colors cursor-pointer whitespace-nowrap"
            >
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span className="max-w-[150px] truncate">{profile?.fullName}</span>
            </button>

            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Odjava</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
