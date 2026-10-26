import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  Bell,
  BookOpen,
  Calendar,
  CalendarCheck,
  CheckCheck,
  ClipboardList,
  FileCheck2,
  FolderSync,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  ShieldCheck,
  User,
  Users,
  X,
} from 'lucide-react';
import { ActivePortalMode, useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { SmartNotificationItem, UserRole } from '../types/zamio';
import { AdminNavKey } from './admin/AdminPortal';
import { Button } from './ui/button';

export type { AdminNavKey };

export type StudentNavKey =
  | 'pocetna'
  | 'predmeti'
  | 'raspored'
  | 'obavjestenja'
  | 'profil';

export type ProfessorNavKey =
  | 'pocetna'
  | 'raspored'
  | 'ispiti'
  | 'bodovi'
  | 'prisustvo'
  | 'studenti'
  | 'obavjestenja'
  | 'postavke'
  | 'profil';

interface NavItem<T extends string> {
  key: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const STUDENT_NAV_ITEMS: NavItem<StudentNavKey>[] = [
  { key: 'pocetna', label: 'Početna', icon: LayoutDashboard },
  { key: 'predmeti', label: 'Moji predmeti', icon: BookOpen },
  { key: 'raspored', label: 'Kalendar', icon: Calendar },
  { key: 'obavjestenja', label: 'Obavještenja', icon: Bell },
  { key: 'profil', label: 'Profil i postavke', icon: User },
];

export const PROFESSOR_NAV_ITEMS: NavItem<ProfessorNavKey>[] = [
  { key: 'pocetna', label: 'Pregled predmeta', icon: LayoutDashboard },
  { key: 'raspored', label: 'Raspored nastave', icon: Calendar },
  { key: 'ispiti', label: 'Ispitni rokovi', icon: FileCheck2 },
  { key: 'bodovi', label: 'Unos bodova', icon: ClipboardList },
  { key: 'prisustvo', label: 'Prisustvo', icon: CalendarCheck },
  { key: 'studenti', label: 'Studenti i ocjene', icon: Users },
  { key: 'obavjestenja', label: 'Obavještenja', icon: Megaphone },
  { key: 'postavke', label: 'Postavke predmeta', icon: Settings },
  { key: 'profil', label: 'Moj profil', icon: User },
];

export const ADMIN_NAV_ITEMS: NavItem<AdminNavKey>[] = [
  { key: 'korisnici', label: 'Korisnici i nalozi', icon: Users },
  { key: 'predmeti', label: 'Svi predmeti', icon: BookOpen },
  { key: 'raspored', label: 'Raspored nastave', icon: Calendar },
  { key: 'semestri', label: 'Semestri i arhiva', icon: FolderSync },
  { key: 'obavjestenja', label: 'Obavještenja', icon: Megaphone },
  { key: 'profil', label: 'Moj profil', icon: User },
];

function formatNotificationTime(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}. ${hh}:${min}`;
}

interface AppShellProps {
  portalMode: ActivePortalMode;
  activeNav: string;
  onSelectNav: (key: string) => void;
  pageTitle: string;
  activeAcademicYear?: string;
  notifications?: SmartNotificationItem[];
  onSelectNotification?: (item: SmartNotificationItem) => void;
  onMarkAllRead?: () => void;
  onOpenNotificationSettings?: () => void;
  children: React.ReactNode;
}

export function AppShell({
  portalMode,
  activeNav,
  onSelectNav,
  pageTitle,
  activeAcademicYear,
  notifications = [],
  onSelectNotification,
  onMarkAllRead,
  onOpenNotificationSettings,
  children,
}: AppShellProps) {
  const { profile, isAdminUser, setPortalMode, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifContainerRef = useRef<HTMLDivElement | null>(null);

  const navItems =
    portalMode === 'admin'
      ? ADMIN_NAV_ITEMS
      : portalMode === 'professor'
        ? PROFESSOR_NAV_ITEMS
        : STUDENT_NAV_ITEMS;

  const canSwitchPortal = isAdminUser || profile?.role === UserRole.ADMIN;
  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!notifOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (notifContainerRef.current && !notifContainerRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [notifOpen]);

  const formattedUserLabel =
    (portalMode === 'professor' || profile?.role === UserRole.PROFESSOR) &&
    profile?.academicTitle?.trim()
      ? profile.fullName.toLowerCase().startsWith(profile.academicTitle.trim().toLowerCase())
        ? profile.fullName
        : `${profile.academicTitle.trim()} ${profile.fullName}`
      : profile?.fullName || '';

  const portalBreadcrumbLabel =
    portalMode === 'admin'
      ? 'Administratorski portal'
      : portalMode === 'professor'
        ? 'Nastavnički portal'
        : 'Studentski portal';

  const sidebarRoleSummary =
    portalMode === 'admin'
      ? 'Administrator sistema'
      : portalMode === 'professor'
        ? 'Nastavno osoblje'
        : 'Student';

  const handleNavClick = (key: string) => {
    onSelectNav(key);
    setMobileOpen(false);
  };

  const handlePortalModeChange = (mode: ActivePortalMode) => {
    setPortalMode(mode);
    onSelectNav(mode === 'admin' ? 'korisnici' : 'pocetna');
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200">
          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white shrink-0">
            {portalMode === 'admin' ? (
              <ShieldCheck className="w-4 h-4" />
            ) : (
              <GraduationCap className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold tracking-tight text-slate-900 leading-none">
              VOLTRA
            </div>
            <div className="text-[11px] text-slate-500 mt-1 truncate">
              {portalMode === 'admin' ? 'ETF Uprava sistema' : 'ETF Student Portal'}
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
              Režim prikaza portala
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                onClick={() => handlePortalModeChange('admin')}
                className={cn(
                  'py-1.5 px-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  portalMode === 'admin'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                Admin
              </button>
              <button
                type="button"
                onClick={() => handlePortalModeChange('professor')}
                className={cn(
                  'py-1.5 px-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  portalMode === 'professor'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                Profesor
              </button>
              <button
                type="button"
                onClick={() => handlePortalModeChange('student')}
                className={cn(
                  'py-1.5 px-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  portalMode === 'student'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                Student
              </button>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500">
          <div className="font-medium text-slate-800 truncate">{formattedUserLabel}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-slate-500 truncate">
            <span>{sidebarRoleSummary}</span>
            {portalMode === 'student' && profile?.studentIndex && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{profile.studentIndex}</span>
              </>
            )}
            {portalMode === 'professor' && profile?.officeLocation && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{profile.officeLocation}</span>
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
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center text-white">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <span className="font-bold tracking-tight text-slate-900">VOLTRA</span>
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
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap',
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
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => handlePortalModeChange('admin')}
                    className={cn(
                      'py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0',
                      portalMode === 'admin'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    )}
                  >
                    Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePortalModeChange('professor')}
                    className={cn(
                      'py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0',
                      portalMode === 'professor'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    )}
                  >
                    Profesor
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePortalModeChange('student')}
                    className={cn(
                      'py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0',
                      portalMode === 'student'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    )}
                  >
                    Student
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb Trail — Account Context, Notifications & Logout */}
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
              <span className="hidden sm:inline font-semibold text-slate-400 whitespace-nowrap">
                VOLTRA
              </span>
              <span aria-hidden="true" className="hidden sm:inline text-slate-300">
                /
              </span>
              <span className="hidden md:inline text-slate-500 whitespace-nowrap">
                {portalBreadcrumbLabel}
              </span>
              <span aria-hidden="true" className="hidden md:inline text-slate-300">
                /
              </span>
              <h1 className="font-semibold text-slate-900 truncate">{pageTitle}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap">
              <span>Akademska</span>
              <span className="font-mono font-medium text-slate-800 tabular-nums">
                {activeAcademicYear || profile?.academicYear || '2026/2027'}
              </span>
            </div>

            {/* Smart Notifications Popover */}
            <div className="relative" ref={notifContainerRef}>
              <button
                type="button"
                onClick={() => setNotifOpen((prev) => !prev)}
                className={cn(
                  'relative h-9 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  notifOpen
                    ? 'border-blue-600 bg-blue-50/70 text-blue-800'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                )}
                aria-label="Pametne notifikacije"
              >
                <Bell className="w-4 h-4 shrink-0" />
                {unreadCount > 0 && (
                  <span className="font-mono font-bold text-blue-700 tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-900">
                      Pametne notifikacije{' '}
                      <span className="font-mono text-slate-500 tabular-nums">
                        ({unreadCount} nepročitano)
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {unreadCount > 0 && onMarkAllRead && (
                        <button
                          type="button"
                          onClick={() => onMarkAllRead()}
                          className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium cursor-pointer whitespace-nowrap"
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          Pročitaj sve
                        </button>
                      )}
                      {onOpenNotificationSettings && (
                        <button
                          type="button"
                          onClick={() => {
                            setNotifOpen(false);
                            onOpenNotificationSettings();
                          }}
                          className="text-slate-500 hover:text-slate-900 hover:underline cursor-pointer whitespace-nowrap"
                        >
                          Postavke
                        </button>
                      )}
                    </div>
                  </div>

                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 leading-relaxed">
                      Trenutno nema novih obavijesti. Kada profesor objavi rezultate, promijeni
                      bodove, unese prisustvo ili objavi ispitni rok, obavijest će se pojaviti ovdje.
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                      {notifications.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setNotifOpen(false);
                            if (onSelectNotification) {
                              onSelectNotification(item);
                            }
                          }}
                          className={cn(
                            'w-full text-left px-4 py-3 transition-colors cursor-pointer block',
                            item.read
                              ? 'bg-white hover:bg-slate-50'
                              : 'bg-blue-50/45 hover:bg-blue-50/80'
                          )}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span
                              className={cn(
                                'text-xs truncate',
                                item.read
                                  ? 'font-medium text-slate-800'
                                  : 'font-semibold text-slate-900'
                              )}
                            >
                              {item.title}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                              {formatNotificationTime(item.createdAtIso)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5 line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onSelectNav('profil')}
              className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-700 hover:text-blue-700 transition-colors cursor-pointer whitespace-nowrap"
            >
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span className="max-w-[180px] truncate">{formattedUserLabel}</span>
            </button>

            <Button variant="outline" size="sm" onClick={signOut} className="whitespace-nowrap">
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
