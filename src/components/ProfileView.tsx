import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BellRing,
  BookOpen,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Lock,
  Save,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { getTodayIsoLocal } from '../lib/calculations';
import { ETF_DEPARTMENTS, normalizeStudyTrack } from '../lib/programs';
import {
  cn,
  formatCourseAssistants,
  formatCourseProfessors,
  getCourseAssistants,
} from '../lib/utils';
import { validatePasswordChangeInput } from '../lib/validation';
import {
  clearEtfDemoData,
  fetchCourseBundleByIds,
  redeemProfessorInvitation,
  seedEtfDemoData,
  subscribeProfessorAllExamData,
  subscribeProfessorCourses,
  subscribeStudentEnrollments,
  subscribeStudentExamRegistrations,
  subscribeStudentFinalGrades,
  updateProfessorOwnProfile,
  updateStudentOwnAllowedProfile,
} from '../services/zamioService';
import {
  Course,
  DEFAULT_NOTIFICATION_PREFS,
  Enrollment,
  ExamRegistration,
  ExamRegistrationStatus,
  ExamTerm,
  FinalGrade,
  FinalGradeStatus,
  NotificationPreferences,
  UserRole,
} from '../types/zamio';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input, Label } from './ui/input';

const ACADEMIC_TITLE_OPTIONS = [
  'red. prof. dr.',
  'vanr. prof. dr.',
  'doc. dr.',
  'dr. sc.',
  'viši asistent',
  'asistent',
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ET';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ProfileView() {
  const {
    profile,
    privateData,
    isAdminUser,
    hasPasswordProvider,
    portalMode,
    changeOwnPassword,
    refreshProfile,
  } = useAuth();

  // Professor / Admin freely editable fields
  const [fullName, setFullName] = useState(profile?.fullName || '');
  const [department, setDepartment] = useState(
    profile?.department || 'Računarstvo i informatika'
  );
  const [academicYear, setAcademicYear] = useState(profile?.academicYear || '2026/2027');
  const [academicTitle, setAcademicTitle] = useState(
    profile?.academicTitle || (portalMode === 'professor' ? 'doc. dr.' : '')
  );
  const [officeLocation, setOfficeLocation] = useState(profile?.officeLocation || '');
  const [consultationHours, setConsultationHours] = useState(profile?.consultationHours || '');

  // Student & Faculty self-service fields
  const [phone, setPhone] = useState(privateData?.phone || '');
  const [personalNote, setPersonalNote] = useState(profile?.personalNote || '');
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(
    profile?.notificationPrefs || DEFAULT_NOTIFICATION_PREFS
  );
  const [savingProfile, setSavingProfile] = useState(false);

  // Password Change State (available to Students, Professors, and Admins)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  // Live Student Academic Carton Data
  const [studentEnrollments, setStudentEnrollments] = useState<Enrollment[]>([]);
  const [studentCoursesMap, setStudentCoursesMap] = useState<Record<string, Course>>({});
  const [studentGrades, setStudentGrades] = useState<FinalGrade[]>([]);
  const [studentExamRegs, setStudentExamRegs] = useState<ExamRegistration[]>([]);

  // Live Professor Academic Carton Data
  const [profCourses, setProfCourses] = useState<Course[]>([]);
  const [profExamTerms, setProfExamTerms] = useState<ExamTerm[]>([]);
  const [profExamRegs, setProfExamRegs] = useState<ExamRegistration[]>([]);
  const [copiedUid, setCopiedUid] = useState(false);

  // Invitation Redemption (legacy fallback for students invited to become professors)
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  // Admin: Seed Data Management
  const [seedBusy, setSeedBusy] = useState(false);
  const [confirmClearSeedOpen, setConfirmClearSeedOpen] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.fullName || '');
    setDepartment(profile.department || 'Računarstvo i informatika');
    setAcademicYear(profile.academicYear || '2026/2027');
    setAcademicTitle(
      profile.academicTitle || (portalMode !== 'student' ? 'vanr. prof. dr.' : '')
    );
    setOfficeLocation(profile.officeLocation || '');
    setConsultationHours(profile.consultationHours || '');
    setPersonalNote(profile.personalNote || '');
    setNotifPrefs(profile.notificationPrefs || DEFAULT_NOTIFICATION_PREFS);
  }, [profile, portalMode]);

  useEffect(() => {
    setPhone(privateData?.phone || '');
  }, [privateData]);

  useEffect(() => {
    if (!profile?.uid) return;

    if (portalMode === 'student') {
      const unsubEnr = subscribeStudentEnrollments(profile.uid, setStudentEnrollments);
      const unsubGrades = subscribeStudentFinalGrades(profile.uid, setStudentGrades);
      const unsubRegs = subscribeStudentExamRegistrations(profile.uid, setStudentExamRegs);
      return () => {
        unsubEnr();
        unsubGrades();
        unsubRegs();
      };
    }

    const unsubCourses = subscribeProfessorCourses(profile.uid, (list) => {
      setProfCourses([...list].sort((a, b) => a.name.localeCompare(b.name, 'bs')));
    });
    const unsubExams = subscribeProfessorAllExamData(profile.uid, {
      onExamTerms: setProfExamTerms,
      onExamRegistrations: setProfExamRegs,
    });
    return () => {
      unsubCourses();
      unsubExams();
    };
  }, [profile?.uid, portalMode]);

  useEffect(() => {
    if (portalMode !== 'student' || studentEnrollments.length === 0) {
      setStudentCoursesMap({});
      return;
    }
    let active = true;
    Promise.all(
      studentEnrollments.map(async (enr) => {
        try {
          const bundle = await fetchCourseBundleByIds(enr.courseId);
          return bundle.course;
        } catch {
          return null;
        }
      })
    ).then((courses) => {
      if (!active) return;
      const map: Record<string, Course> = {};
      for (const crs of courses) {
        if (crs) map[crs.id] = crs;
      }
      setStudentCoursesMap(map);
    });
    return () => {
      active = false;
    };
  }, [portalMode, studentEnrollments]);

  const studentStats = useMemo(() => {
    const today = getTodayIsoLocal();
    const activeEnrs = studentEnrollments.filter(
      (enr) => !enr.isArchived && !studentCoursesMap[enr.courseId]?.isArchived
    );
    const totalEcts = activeEnrs.reduce(
      (sum, enr) => sum + (studentCoursesMap[enr.courseId]?.ects ?? 6),
      0
    );
    const passedGrades = studentGrades.filter(
      (g) => g.status === FinalGradeStatus.FINALIZED && g.finalGrade >= 6
    );
    const avgGrade =
      passedGrades.length > 0
        ? (
            passedGrades.reduce((sum, g) => sum + g.finalGrade, 0) / passedGrades.length
          ).toFixed(2)
        : '—';
    const activeExamRegsCount = studentExamRegs.filter(
      (r) => r.status === ExamRegistrationStatus.REGISTERED && r.examDate >= today
    ).length;

    return {
      enrolledCount: activeEnrs.length,
      totalEcts,
      passedCount: passedGrades.length,
      avgGrade,
      activeExamRegsCount,
    };
  }, [studentEnrollments, studentCoursesMap, studentGrades, studentExamRegs]);

  const professorStats = useMemo(() => {
    const today = getTodayIsoLocal();
    const activeCourses = profCourses.filter((c) => !c.isArchived);
    const upcomingTerms = profExamTerms.filter((t) => t.examDate >= today).length;
    const activeRegistrations = profExamRegs.filter(
      (r) => r.status === ExamRegistrationStatus.REGISTERED && r.examDate >= today
    ).length;
    const uniqueAssistants = new Set<string>();
    for (const c of activeCourses) {
      for (const a of getCourseAssistants(c)) {
        uniqueAssistants.add(a);
      }
    }
    return {
      coursesCount: activeCourses.length,
      totalTermsCount: profExamTerms.length,
      upcomingTermsCount: upcomingTerms,
      activeRegistrationsCount: activeRegistrations,
      assistantsCount: uniqueAssistants.size,
    };
  }, [profCourses, profExamTerms, profExamRegs]);

  if (!profile) return null;

  const handleSaveStudentAllowed = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateStudentOwnAllowedProfile(profile.uid, {
        personalNote,
        notificationPrefs: notifPrefs,
        phone,
      });
      await refreshProfile();
      toast.success('Kontakt podaci i postavke pametnih obavijesti su sačuvani.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju postavki profila.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveProfessorProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateProfessorOwnProfile(profile.uid, {
        fullName,
        department,
        academicYear,
        academicTitle,
        officeLocation,
        consultationHours,
        personalNote,
        phone,
      });
      await refreshProfile();
      toast.success('Profil i kabinetski podaci su uspješno sačuvani.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju profila.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changingPassword) return;
    setPasswordFeedback(null);

    const validation = validatePasswordChangeInput({
      requireCurrentPassword: hasPasswordProvider,
      currentPassword,
      newPassword,
      confirmPassword,
    });

    if (!validation.valid) {
      const msg = validation.error || 'Provjerite unesene podatke za promjenu šifre.';
      setPasswordFeedback({ type: 'error', message: msg });
      toast.error(msg);
      return;
    }

    setChangingPassword(true);
    try {
      await changeOwnPassword({
        currentPassword: hasPasswordProvider ? currentPassword : undefined,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      const successMsg = hasPasswordProvider
        ? 'Šifra za prijavu je uspješno promijenjena.'
        : 'Šifra je postavljena! Sada se možete prijavljivati i pomoću e-maila i šifre.';
      setPasswordFeedback({ type: 'success', message: successMsg });
      toast.success(successMsg);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Promjena šifre nije uspjela.';
      setPasswordFeedback({ type: 'error', message: errMsg });
      toast.error(errMsg);
    } finally {
      setChangingPassword(false);
    }
  };

  const scrollToPasswordSection = () => {
    const el = document.getElementById('password-security-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => {
      const inputEl = document.getElementById(
        hasPasswordProvider ? 'pwd-current' : 'pwd-new'
      ) as HTMLInputElement | null;
      inputEl?.focus();
    }, 220);
  };

  const handleCopyFacultyUid = async () => {
    await navigator.clipboard.writeText(profile.uid);
    setCopiedUid(true);
    toast.success('Nastavnički ID je kopiran u međuspremnik.');
    setTimeout(() => setCopiedUid(false), 2000);
  };

  const handleRedeemInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!privateData?.email) return;
    setRedeeming(true);
    try {
      await redeemProfessorInvitation({
        uid: profile.uid,
        userEmail: privateData.email,
        inviteCode: inviteCodeInput,
      });
      await refreshProfile();
      setInviteCodeInput('');
      toast.success('Pozivnica je prihvaćena! Vaš nalog sada ima ulogu Profesora.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Neuspješna aktivacija pozivnice.');
    } finally {
      setRedeeming(false);
    }
  };

  const handleSeedDemo = async () => {
    setSeedBusy(true);
    try {
      await seedEtfDemoData({
        adminUid: profile.uid,
        adminName: profile.fullName,
        adminIndex: profile.studentIndex || '19001',
      });
      toast.success('Razvojni ETF Sarajevo podaci su učitani.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri učitavanju demo podataka.');
    } finally {
      setSeedBusy(false);
    }
  };

  const handleClearSeed = async () => {
    setSeedBusy(true);
    try {
      const removed = await clearEtfDemoData(profile.uid);
      setConfirmClearSeedOpen(false);
      toast.success(`Uklonjeno je ${removed} razvojnih (seed) zapisa.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri uklanjanju demo podataka.');
    } finally {
      setSeedBusy(false);
    }
  };

  const pwdMeetsLength = newPassword.length >= 6 && newPassword.length <= 64;
  const pwdDifferentFromCurrent =
    !hasPasswordProvider ||
    (newPassword.length > 0 && currentPassword.length > 0 && newPassword !== currentPassword);
  const pwdMatchesConfirm =
    newPassword.length > 0 && confirmPassword.length > 0 && newPassword === confirmPassword;
  const pwdMismatchError =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  const PasswordSecurityCard = (
    <section
      id="password-security-section"
      className="bg-white border border-slate-200 rounded-xl p-6 scroll-mt-20"
    >
      <div className="pb-4 border-b border-slate-100 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Promjena šifre i sigurnost naloga
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {hasPasswordProvider
              ? 'Radi sigurnosti je obavezna provjera trenutne šifre prije postavljanja nove šifre.'
              : 'Prijavljeni ste putem Google računa — ovdje možete postaviti šifru za direktnu prijavu e-mailom.'}
          </p>
        </div>
        <KeyRound className="w-5 h-5 text-slate-400 shrink-0" />
      </div>

      <form onSubmit={handlePasswordSubmit} className="pt-4 space-y-4">
        {passwordFeedback && (
          <div
            role="alert"
            className={cn(
              'rounded-lg border px-3.5 py-2.5 text-xs flex items-center gap-2',
              passwordFeedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
                : 'border-red-200 bg-red-50/70 text-red-800'
            )}
          >
            {passwordFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : (
              <Lock className="w-4 h-4 text-red-700 shrink-0" />
            )}
            <span className="font-medium">{passwordFeedback.message}</span>
          </div>
        )}

        <div
          className={cn(
            'grid grid-cols-1 gap-4',
            hasPasswordProvider ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
          )}
        >
          {hasPasswordProvider && (
            <div>
              <Label htmlFor="pwd-current">Trenutna šifra</Label>
              <div className="relative">
                <Input
                  id="pwd-current"
                  type={showCurrentPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (passwordFeedback) setPasswordFeedback(null);
                  }}
                  placeholder="Unesite trenutnu šifru"
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded cursor-pointer"
                  aria-label={showCurrentPassword ? 'Sakrij trenutnu šifru' : 'Prikaži trenutnu šifru'}
                >
                  {showCurrentPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="pwd-new">Nova šifra</Label>
            <div className="relative">
              <Input
                id="pwd-new"
                type={showNewPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (passwordFeedback) setPasswordFeedback(null);
                }}
                placeholder="Najmanje 6 karaktera"
                minLength={6}
                maxLength={64}
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded cursor-pointer"
                aria-label={showNewPassword ? 'Sakrij novu šifru' : 'Prikaži novu šifru'}
              >
                {showNewPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <Label htmlFor="pwd-confirm">Potvrdi novu šifru</Label>
            <div className="relative">
              <Input
                id="pwd-confirm"
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (passwordFeedback) setPasswordFeedback(null);
                }}
                placeholder="Ponovite novu šifru"
                minLength={6}
                maxLength={64}
                className={cn('pr-10', pwdMismatchError && 'border-red-400')}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded cursor-pointer"
                aria-label={showConfirmPassword ? 'Sakrij potvrdu šifre' : 'Prikaži potvrdu šifre'}
              >
                {showConfirmPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {pwdMismatchError && (
              <p className="text-[11px] text-red-600 mt-1">
                Unesene nove šifre se trenutno ne podudaraju.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className={cn(pwdMeetsLength && 'text-emerald-700 font-medium')}>
              {pwdMeetsLength ? '✓' : '·'} Dužina 6–64 karaktera
            </span>
            {hasPasswordProvider && (
              <span className={cn(pwdDifferentFromCurrent && 'text-emerald-700 font-medium')}>
                {pwdDifferentFromCurrent ? '✓' : '·'} Različita od trenutne šifre
              </span>
            )}
            <span className={cn(pwdMatchesConfirm && 'text-emerald-700 font-medium')}>
              {pwdMatchesConfirm ? '✓' : '·'} Podudaranje nove šifre
            </span>
          </div>

          <Button type="submit" disabled={changingPassword} className="shrink-0 self-end sm:self-auto">
            <KeyRound className="w-4 h-4" />
            {changingPassword
              ? 'Provjera i čuvanje...'
              : hasPasswordProvider
                ? 'Promijeni šifru'
                : 'Postavi šifru za prijavu'}
          </Button>
        </div>
      </form>
    </section>
  );

  // =========================================================================
  // 1. STUDENT PROFILE ("Studentski akademski karton" — Locked Faculty Fields)
  // =========================================================================
  if (portalMode === 'student') {
    const normalizedTrack = normalizeStudyTrack(profile.studyTrack);

    return (
      <div className="space-y-6">
        {/* Student Academic Carton Header + Live Hairline KPI Strip */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200">
            <div className="flex items-start sm:items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 font-bold text-base flex items-center justify-center shrink-0">
                {getInitials(profile.fullName)}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-blue-700">
                  Studentski akademski karton · Elektrotehnički fakultet Sarajevo
                </div>
                <h2 className="text-xl font-bold text-slate-900 mt-0.5 truncate">
                  {profile.fullName}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                  <span>
                    Indeks:{' '}
                    <strong className="font-mono text-slate-900 tabular-nums">
                      {profile.studentIndex || 'Dodjeljuje studentska služba'}
                    </strong>
                  </span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="font-medium text-slate-800">
                    {normalizedTrack || profile.department}
                  </span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span>{profile.studyYear || 'I ciklus studija'}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 shrink-0">
              <div className="text-xs text-slate-500 sm:text-right">
                <div>Aktivna akademska godina</div>
                <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                  {profile.academicYear || '2026/2027'}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={scrollToPasswordSection}>
                <KeyRound className="w-3.5 h-3.5" />
                Promijeni šifru
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/50">
            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Aktivni predmeti</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {studentStats.enrolledCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                {studentStats.totalEcts} ECTS u tekućem semestru
              </div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Ukupno položeno</div>
              <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                {studentStats.passedCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Uključujući prethodne semestre
              </div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Ukupni prosjek</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {studentStats.avgGrade}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Na osnovu zaključenih ocjena
              </div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Aktivne prijave ispita</div>
              <div className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums">
                {studentStats.activeExamRegsCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Predstojeći prijavljeni rokovi
              </div>
            </div>
          </div>
        </section>

        {/* Two-Column Student Content: Locked Official Faculty Data + Editable Preferences */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 7 Cols: Read-Only Faculty Dossier + Editable Contact & Smart Notifications */}
          <div className="lg:col-span-7 space-y-6">
            {/* 1A: LOCKED FACULTY-ASSIGNED FIELDS */}
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="pb-4 border-b border-slate-100 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                    <h3 className="text-base font-semibold text-slate-900">
                      Zvanični matični podaci fakulteta (zaključano)
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Broj indeksa, studijski program, smjer i godinu studija dodjeljuje isključivo
                    studentska služba / administrator fakulteta. Podaci su prikazani radi uvida.
                  </p>
                </div>
                <GraduationCap className="w-5 h-5 text-slate-400 shrink-0" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Ime i prezime studenta</Label>
                  <Input
                    value={profile.fullName}
                    disabled
                    className="bg-slate-50 text-slate-700 font-medium cursor-not-allowed"
                  />
                </div>

                <div>
                  <Label>Broj indeksa</Label>
                  <Input
                    value={profile.studentIndex || 'Nije dodijeljen'}
                    disabled
                    className="bg-slate-50 text-slate-800 font-mono font-semibold tabular-nums cursor-not-allowed"
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label>Studijski program / Smjer</Label>
                  <Input
                    value={normalizedTrack || profile.department}
                    disabled
                    className="bg-slate-50 text-slate-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <Label>Matični odsjek na ETF Sarajevo</Label>
                  <Input
                    value={profile.department}
                    disabled
                    className="bg-slate-50 text-slate-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <Label>Godina studija</Label>
                  <Input
                    value={profile.studyYear || 'II godina · I ciklus (Bachelor)'}
                    disabled
                    className="bg-slate-50 text-slate-700 cursor-not-allowed"
                  />
                </div>

                <div>
                  <Label>Upisana akademska godina</Label>
                  <Input
                    value={profile.academicYear || '2026/2027'}
                    disabled
                    className="bg-slate-50 text-slate-700 font-mono tabular-nums cursor-not-allowed"
                  />
                </div>

                <div>
                  <Label>Službeni e-mail naloga</Label>
                  <Input
                    value={privateData?.email || '—'}
                    disabled
                    className="bg-slate-50 text-slate-700 cursor-not-allowed"
                  />
                </div>
              </div>
            </section>

            {/* 1B: STUDENT EDITABLE CONTACT + SMART NOTIFICATIONS */}
            <form
              onSubmit={handleSaveStudentAllowed}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
            >
              <div className="pb-4 border-b border-slate-100 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Lični kontakt podaci i pametne notifikacije
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Odaberite koje obavijesti u realnom vremenu želite primati i ažurirajte kontakt
                    podatke.
                  </p>
                </div>
                <BellRing className="w-5 h-5 text-blue-700 shrink-0" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="stu-phone">Kontakt telefon (opciono)</Label>
                  <Input
                    id="stu-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="npr. +387 61 123 456"
                    maxLength={30}
                    className="font-mono tabular-nums"
                  />
                </div>

                <div>
                  <Label htmlFor="stu-note">Lična napomena / podsjetnik</Label>
                  <Input
                    id="stu-note"
                    value={personalNote}
                    onChange={(e) => setPersonalNote(e.target.value)}
                    placeholder="npr. Fokus na I parcijalne ispite"
                    maxLength={240}
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="text-xs font-semibold text-slate-800">
                  Pametne notifikacije — izaberite obavijesti koje želite primati:
                </div>

                <div className="space-y-2.5">
                  {(
                    [
                      {
                        key: 'resultsPublished',
                        title: 'Objava konačnih rezultata i zaključivanje ocjene',
                        desc: 'Obavijest čim profesor objavi ili zaključi konačnu ocjenu na predmetu.',
                      },
                      {
                        key: 'pointsChanged',
                        title: 'Unos ili promjena bodova',
                        desc: 'Obavijest kada profesor ili asistent upiše nove bodove ili izmijeni postojeće.',
                      },
                      {
                        key: 'attendanceRecorded',
                        title: 'Evidencija prisustva na nastavi i vježbama',
                        desc: 'Obavijest kada nastavnik evidentira prisustvo ili izostanak za održani termin.',
                      },
                      {
                        key: 'newExamTerm',
                        title: 'Novi ispitni rokovi i status prijave ispita',
                        desc: 'Obavijest kada profesor objavi novi termin ispita, promijeni salu ili zaključa prijavu.',
                      },
                      {
                        key: 'announcements',
                        title: 'Zvanična obavještenja administracije fakulteta',
                        desc: 'Obavijest kada administrator objavi važnu odluku na oglasnoj ploči.',
                      },
                    ] as const
                  ).map((item) => (
                    <label
                      key={item.key}
                      className="flex items-start gap-3 p-2.5 rounded-lg border border-slate-200/80 hover:bg-slate-50/70 transition-colors cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={notifPrefs[item.key]}
                        onChange={(e) =>
                          setNotifPrefs((prev) => ({
                            ...prev,
                            [item.key]: e.target.checked,
                          }))
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900">{item.title}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{item.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <Button type="submit" disabled={savingProfile}>
                  <Save className="w-4 h-4" />
                  {savingProfile ? 'Čuvanje...' : 'Sačuvaj lične postavke i obavijesti'}
                </Button>
              </div>
            </form>
          </div>

          {/* Right 5 Cols: Enrolled Courses & Teaching Staff Dossier */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Evidencija upisanih predmeta
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Aktivni i arhivirani predmeti u vašem kartonu
                </p>
              </div>
              <BookOpen className="w-4 h-4 text-slate-400 shrink-0" />
            </div>

            {studentEnrollments.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 leading-relaxed">
                Trenutno nemate evidentiranih predmeta. Predmetni nastavnik ili administrator će
                vas dodati na odgovarajuće predmete vašeg smjera.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {studentEnrollments.map((enr) => {
                  const crs = studentCoursesMap[enr.courseId];
                  const assistantsText = formatCourseAssistants(crs);
                  const isArch = Boolean(enr.isArchived || crs?.isArchived);
                  const fg = studentGrades.find(
                    (g) =>
                      g.courseId === enr.courseId &&
                      g.status === FinalGradeStatus.FINALIZED
                  );

                  return (
                    <div key={enr.id} className="px-5 py-3.5 space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className="font-mono font-semibold text-blue-700">
                              {enr.courseCode}
                            </span>
                            {crs && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">{crs.ects} ECTS</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{enr.academicYear}</span>
                            {isArch && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-500 font-medium">Arhiva</span>
                              </>
                            )}
                          </div>
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {enr.courseName}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {fg ? (
                            <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                              <Award className="w-3.5 h-3.5" />
                              Ocjena {fg.finalGrade}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">U toku</span>
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-slate-600">
                        <span className="text-slate-500">
                          {crs && (crs.professorNames?.length ?? 0) > 1
                            ? 'Profesori: '
                            : 'Profesor: '}
                        </span>
                        <span className="font-medium text-slate-800">
                          {formatCourseProfessors(crs, enr.leadProfessorName)}
                        </span>
                      </div>

                      {assistantsText && (
                        <div className="text-xs text-slate-500">
                          <span>Asistenti: </span>
                          <span className="text-slate-700">{assistantsText}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Password Change Card for Students */}
        {PasswordSecurityCard}

        {/* Optional Invitation Redemption for Google-authenticated users invited as Professor */}
        {profile.role === UserRole.STUDENT && !isAdminUser && (
          <section className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
                <ShieldCheck className="w-4 h-4 text-blue-700" />
                <span>Aktivacija jednokratne pozivnice za nastavno osoblje</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Ako ste prijavljeni putem Google računa ({privateData?.email}) i imate jednokratni
                pozivni kod za profesora, unesite ga ispod.
              </p>
            </div>

            <form onSubmit={handleRedeemInvite} className="pt-4 flex flex-col sm:flex-row gap-3">
              <Input
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
                placeholder="npr. INV-ETF-8K2P9A"
                className="font-mono sm:max-w-xs"
                required
              />
              <Button type="submit" disabled={redeeming || !inviteCodeInput.trim()}>
                {redeeming ? 'Provjera...' : 'Aktiviraj profesorski nalog'}
              </Button>
            </form>
          </section>
        )}
      </div>
    );
  }

  // =========================================================================
  // 2. PROFESSOR / ADMIN PROFILE ("Karton nastavnog osoblja / Administracije")
  // =========================================================================
  const displayTitlePrefix = academicTitle.trim();
  const formattedFacultyHeading = displayTitlePrefix
    ? fullName.toLowerCase().startsWith(displayTitlePrefix.toLowerCase())
      ? fullName
      : `${displayTitlePrefix} ${fullName}`
    : fullName;

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-900 text-white p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start sm:items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 text-blue-300 font-bold text-base flex items-center justify-center shrink-0">
              {getInitials(profile.fullName)}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-blue-300 tracking-wide">
                {portalMode === 'admin'
                  ? 'Administratorski profil · Elektrotehnički fakultet Sarajevo'
                  : `Karton nastavnog osoblja · ${isAdminUser ? 'Administrator i Profesor' : 'Nastavnik'}`}
              </div>
              <h2 className="text-xl font-bold text-white tracking-wide mt-0.5 truncate">
                {formattedFacultyHeading}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  Odsjek: {profile.department}
                </span>
                {profile.officeLocation && (
                  <>
                    <span aria-hidden="true" className="text-slate-600">
                      ·
                    </span>
                    <span>{profile.officeLocation}</span>
                  </>
                )}
                {profile.consultationHours && (
                  <>
                    <span aria-hidden="true" className="text-slate-600">
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      Konsultacije: {profile.consultationHours}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="bg-slate-800/90 border border-slate-700 rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400">
                Nastavnički ID (za dodavanje ko-profesora)
              </div>
              <div className="font-mono text-xs text-slate-100 truncate max-w-[180px] tabular-nums mt-0.5">
                {profile.uid}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyFacultyUid}
              className="bg-slate-900 border-slate-600 text-slate-100 hover:bg-slate-700 hover:text-white h-8 px-2.5 shrink-0"
            >
              {copiedUid ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Kopirano
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Kopiraj ID
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/50">
          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Aktivni predmeti</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {professorStats.coursesCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Akademska {profile.academicYear}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Objavljeni ispitni rokovi</div>
            <div className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums">
              {professorStats.totalTermsCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
              Predstojeći: {professorStats.upcomingTermsCount}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Aktivne prijave ispita</div>
            <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
              {professorStats.activeRegistrationsCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Potvrđeni izlasci studenata
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Asistenti na predmetima</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {professorStats.assistantsCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Angažovani saradnici u nastavi
            </div>
          </div>
        </div>
      </section>

      {/* Two-Column Faculty Content: Freely Editable Professor Form + Teaching Portfolio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSaveProfessorProfile}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="pb-4 border-b border-slate-100 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Uređivanje nastavničkog i ličnog profila
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Kao nastavnik možete slobodno uređivati sve profesionalne, kabinetske i kontakt
                podatke.
              </p>
            </div>
            <Briefcase className="w-5 h-5 text-slate-400 shrink-0" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="fac-title">Akademsko zvanje</Label>
              <select
                id="fac-title"
                value={academicTitle}
                onChange={(e) => setAcademicTitle(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value="">Bez prefiksa zvanja</option>
                {ACADEMIC_TITLE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="fac-fullname">Ime i prezime</Label>
              <Input
                id="fac-fullname"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={100}
              />
            </div>

            <div>
              <Label htmlFor="fac-dept">Matični odsjek / Katedra</Label>
              <select
                id="fac-dept"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                {ETF_DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="fac-office">Kabinet i lokacija</Label>
              <Input
                id="fac-office"
                value={officeLocation}
                onChange={(e) => setOfficeLocation(e.target.value)}
                placeholder="npr. Kabinet 3-14, Kampus UNSA"
                maxLength={60}
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="fac-consult">Termini konsultacija sa studentima</Label>
              <Input
                id="fac-consult"
                value={consultationHours}
                onChange={(e) => setConsultationHours(e.target.value)}
                placeholder="npr. Utorak 12:00–14:00, Četvrtak 11:00–12:00"
                maxLength={100}
              />
            </div>

            <div>
              <Label htmlFor="fac-phone">Kontakt telefon</Label>
              <Input
                id="fac-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="npr. +387 33 250 700"
                maxLength={30}
                className="font-mono tabular-nums"
              />
            </div>

            <div>
              <Label htmlFor="fac-year">Akademska godina</Label>
              <Input
                id="fac-year"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                maxLength={20}
                className="font-mono tabular-nums"
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="fac-note">Dodatna napomena uz profil (opciono)</Label>
              <Input
                id="fac-note"
                value={personalNote}
                onChange={(e) => setPersonalNote(e.target.value)}
                placeholder="npr. Konsultacije uz prethodnu najavu e-mailom"
                maxLength={240}
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="fac-email">Službeni e-mail za prijavu</Label>
              <Input
                id="fac-email"
                value={privateData?.email || '—'}
                disabled
                className="bg-slate-50 text-slate-500"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" disabled={savingProfile}>
              <Save className="w-4 h-4" />
              {savingProfile ? 'Čuvanje...' : 'Sačuvaj izmjene profila'}
            </Button>
          </div>
        </form>

        {/* Right 5 Cols: Teaching Portfolio */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Nastavni angažman i saradnici
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Profesori i asistenti po dodijeljenim predmetima
              </p>
            </div>
            <Users className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          {profCourses.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Nemate dodijeljenih predmeta.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {profCourses.map((crs) => {
                const assistants = formatCourseAssistants(crs);
                const profCount = crs.professorNames?.length || 1;
                return (
                  <div key={crs.id} className="px-5 py-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-semibold text-blue-700">{crs.code}</span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {crs.ects} ECTS · {crs.academicYear}
                        {crs.isArchived ? ' · Arhiva' : ''}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">{crs.name}</div>
                    {crs.studyProgram && (
                      <div className="text-xs text-slate-500">
                        {normalizeStudyTrack(crs.studyProgram)} · {crs.semester}
                      </div>
                    )}
                    <div className="text-xs text-slate-600">
                      <span className="text-slate-500">
                        {profCount > 1 ? `Profesori (${profCount}): ` : 'Profesor: '}
                      </span>
                      <span className="font-medium text-slate-800">
                        {formatCourseProfessors(crs)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      <span>Asistenti: </span>
                      <span className="text-slate-700">
                        {assistants || 'Nisu evidentirani'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Password Change Card for Professors & Admins */}
      {PasswordSecurityCard}

      {/* Admin Seed Controls */}
      {isAdminUser && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
              <Database className="w-4 h-4 text-slate-700" />
              <span>Razvojni (seed) podaci za demonstraciju</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-2xl">
              Učitava demo predmete za Bachelor, Stručni studij Razvoj softvera (2 godine) i Master
              smjerove (RI, AE, EE, TK), sedmični raspored nastave, službena obavještenja i
              arhivirane predmete iz prethodnog semestra.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSeedDemo}
              disabled={seedBusy}
            >
              <Database className="w-3.5 h-3.5" />
              Učitaj ETF demo podatke
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClearSeedOpen(true)}
              disabled={seedBusy}
              className="text-red-700 border-red-200 hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Ukloni demo podatke
            </Button>
          </div>
        </section>
      )}

      <Dialog
        open={confirmClearSeedOpen}
        onOpenChange={setConfirmClearSeedOpen}
        title="Uklanjanje razvojnih (seed) podataka"
        description="Ova akcija će obrisati isključivo demo predmete, studente, raspored i ocjene označene sa isSeed: true. Produkcijski nalozi i predmeti ostaju netaknuti."
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button variant="outline" onClick={() => setConfirmClearSeedOpen(false)}>
            Odustani
          </Button>
          <Button
            variant="destructive"
            onClick={handleClearSeed}
            disabled={seedBusy}
          >
            {seedBusy ? 'Brisanje...' : 'Potvrdi brisanje demo zapisa'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
