import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Check,
  Copy,
  Database,
  Edit3,
  FolderSync,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import {
  ETF_DEPARTMENTS,
  getCourseProgramCycle,
  getDefaultDepartmentForTrack,
  getSemesterPresetsForProgram,
  getStudyYearsForTrack,
  normalizeStudyTrack,
  STRUCNI_RS_PROGRAM,
  STUDY_PROGRAM_GROUPS,
  StudyCycleKey,
} from '../../lib/programs';
import {
  cn,
  formatCourseAssistants,
  formatCourseProfessors,
  getCourseAssistants,
  getCourseProfessors,
} from '../../lib/utils';
import { generateInitialPassword } from '../../lib/validation';
import {
  adminCreateUserAccount,
  AdminCreatedAccountResult,
  adminEnrollStudentInCourse,
  adminUpdateUserAccount,
  archiveSemesterAndOpenNew,
  clearEtfDemoData,
  createCourse,
  removeEnrollment,
  seedEtfDemoData,
  setCourseArchiveStatus,
  subscribeAcademicState,
  subscribeAllCoursesForAdmin,
  subscribeAllEnrollmentsForAdmin,
  subscribeAllScheduleEventsForAdmin,
  subscribeAllUsersForAdmin,
  updateCourseTeachingStaff,
} from '../../services/zamioService';
import {
  AcademicState,
  Course,
  Enrollment,
  ProvisionedAccount,
  ScheduleEvent,
  UserPrivate,
  UserProfile,
  UserRole,
} from '../../types/zamio';
import { AnnouncementsView } from '../AnnouncementsView';
import { ProfileView } from '../ProfileView';
import { ScheduleView } from '../ScheduleView';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Label } from '../ui/input';

export type AdminNavKey =
  | 'korisnici'
  | 'predmeti'
  | 'raspored'
  | 'semestri'
  | 'obavjestenja'
  | 'profil';

const ACADEMIC_TITLE_OPTIONS = [
  'red. prof. dr.',
  'vanr. prof. dr.',
  'doc. dr.',
  'dr. sc.',
  'viši asistent',
  'asistent',
];

interface AdminPortalProps {
  activeNav: AdminNavKey;
  onNavigate: (nav: AdminNavKey) => void;
}

export function AdminPortal({ activeNav }: AdminPortalProps) {
  const { profile } = useAuth();
  const adminUid = profile?.uid || '';

  // Global Faculty State
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [privates, setPrivates] = useState<UserPrivate[]>([]);
  const [provisioned, setProvisioned] = useState<ProvisionedAccount[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);
  const [academicState, setAcademicState] = useState<AcademicState | null>(null);
  const [loading, setLoading] = useState(true);

  // Users Directory Filters
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'professor' | 'student' | 'admin'>('all');

  // Create Account Modal (Professor or Student)
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newRole, setNewRole] = useState<'student' | 'professor'>('student');
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState(() => generateInitialPassword());
  const [newStudentIndex, setNewStudentIndex] = useState('');
  const [newStudyTrack, setNewStudyTrack] = useState('Bachelor · Računarstvo i informatika');
  const [newDepartment, setNewDepartment] = useState('Računarstvo i informatika');
  const [newStudyYear, setNewStudyYear] = useState('I godina · I ciklus (Bachelor)');
  const [newAcademicYear, setNewAcademicYear] = useState('2026/2027');
  const [newTitle, setNewTitle] = useState('doc. dr.');
  const [newOffice, setNewOffice] = useState('');
  const [newConsult, setNewConsult] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [selectedInitialCourseIds, setSelectedInitialCourseIds] = useState<string[]>([]);
  const [creatingAccount, setCreatingAccount] = useState(false);

  // Issued Credentials Summary Card
  const [createdCredentials, setCreatedCredentials] =
    useState<AdminCreatedAccountResult | null>(null);
  const [copiedCreds, setCopiedCreds] = useState(false);

  // Edit Existing User Modal
  const [editUserTarget, setEditUserTarget] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>(UserRole.STUDENT);
  const [editIndex, setEditIndex] = useState('');
  const [editTrack, setEditTrack] = useState('Bachelor · Računarstvo i informatika');
  const [editDept, setEditDept] = useState('Računarstvo i informatika');
  const [editStudyYear, setEditStudyYear] = useState('I godina · I ciklus (Bachelor)');
  const [editAcadYear, setEditAcadYear] = useState('2026/2027');
  const [editTitle, setEditTitle] = useState('');
  const [editOffice, setEditOffice] = useState('');
  const [editConsult, setEditConsult] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [savingUserEdit, setSavingUserEdit] = useState(false);

  // Manage Student Enrollments Modal
  const [enrollManageStudent, setEnrollManageStudent] = useState<UserProfile | null>(null);
  const [enrollBusyId, setEnrollBusyId] = useState<string | null>(null);

  // Courses Management State
  const [courseSearch, setCourseSearch] = useState('');
  const [programFilter, setProgramFilter] = useState<StudyCycleKey>('all');
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');

  const [newCourseOpen, setNewCourseOpen] = useState(false);
  const [crsLeadProfUid, setCrsLeadProfUid] = useState('');
  const [crsProgram, setCrsProgram] = useState('Bachelor · Računarstvo i informatika');
  const [crsCode, setCrsCode] = useState('');
  const [crsName, setCrsName] = useState('');
  const [crsSemester, setCrsSemester] = useState('Zimski semestar · I godina');
  const [crsEcts, setCrsEcts] = useState('6');
  const [crsCoProfs, setCrsCoProfs] = useState('');
  const [crsAssistants, setCrsAssistants] = useState('');
  const [creatingCourse, setCreatingCourse] = useState(false);

  // Edit Course Staff Modal
  const [staffEditCourse, setStaffEditCourse] = useState<Course | null>(null);
  const [staffProfsInput, setStaffProfsInput] = useState('');
  const [staffAsstsInput, setStaffAsstsInput] = useState('');
  const [savingStaff, setSavingStaff] = useState(false);

  // Semesters & Archiving State
  const [selectedArchiveCourseIds, setSelectedArchiveCourseIds] = useState<string[]>([]);
  const [nextAcadYearInput, setNextAcadYearInput] = useState('2026/2027');
  const [nextSemTypeInput, setNextSemTypeInput] = useState<'Zimski' | 'Ljetni'>('Ljetni');
  const [nextSemLabelInput, setNextSemLabelInput] = useState('Ljetni semestar 2026/2027');
  const [cloneCoursesOnRollover, setCloneCoursesOnRollover] = useState(false);
  const [archivingBusy, setArchivingBusy] = useState(false);

  // Demo seed busy
  const [seedBusy, setSeedBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    let readyUsers = false;
    let readyCourses = false;

    const checkDone = () => {
      if (readyUsers && readyCourses) setLoading(false);
    };

    const uUsers = subscribeAllUsersForAdmin({
      onProfiles: (rows) => {
        setUsers(rows);
        readyUsers = true;
        checkDone();
      },
      onPrivates: setPrivates,
      onProvisioned: setProvisioned,
    });

    const uCourses = subscribeAllCoursesForAdmin((rows) => {
      setCourses([...rows].sort((a, b) => a.code.localeCompare(b.code, 'bs')));
      readyCourses = true;
      checkDone();
    });

    const uEnr = subscribeAllEnrollmentsForAdmin(setEnrollments);
    const uSched = subscribeAllScheduleEventsForAdmin(setScheduleEvents);
    const uAcad = subscribeAcademicState((st) => {
      setAcademicState(st);
      if (st?.activeAcademicYear) {
        setNewAcademicYear(st.activeAcademicYear);
      }
    });

    return () => {
      uUsers();
      uCourses();
      uEnr();
      uSched();
      uAcad();
    };
  }, []);

  const activeCourses = useMemo(() => courses.filter((c) => !c.isArchived), [courses]);
  const archivedCourses = useMemo(() => courses.filter((c) => Boolean(c.isArchived)), [courses]);

  // Pre-select active non-seed or all active courses when opening semestri tab
  useEffect(() => {
    setSelectedArchiveCourseIds((prev) => {
      if (prev.length > 0) {
        return prev.filter((id) => activeCourses.some((c) => c.id === id));
      }
      return activeCourses.map((c) => c.id);
    });
  }, [activeCourses]);

  const privatesByUid = useMemo(() => {
    const map: Record<string, UserPrivate> = {};
    for (const p of privates) map[p.uid] = p;
    return map;
  }, [privates]);

  const professorUsers = useMemo(
    () =>
      users
        .filter((u) => u.role === UserRole.PROFESSOR || u.role === UserRole.ADMIN)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'bs')),
    [users]
  );

  const enrollmentsByStudentId = useMemo(() => {
    const map: Record<string, Enrollment[]> = {};
    for (const e of enrollments) {
      if (!map[e.studentId]) map[e.studentId] = [];
      map[e.studentId].push(e);
    }
    return map;
  }, [enrollments]);

  if (activeNav === 'profil') {
    return <ProfileView />;
  }

  if (activeNav === 'obavjestenja') {
    return <AnnouncementsView canManage viewerMode="admin" />;
  }

  if (activeNav === 'raspored') {
    return (
      <ScheduleView
        courses={courses}
        scheduleEvents={scheduleEvents}
        canEdit
      />
    );
  }

  // Handlers: Create User Account
  const openCreateAccountModal = (defaultRole: 'student' | 'professor') => {
    setNewRole(defaultRole);
    setNewFullName('');
    setNewEmail('');
    setNewPassword(generateInitialPassword());
    setNewStudentIndex('');
    const defaultTrack = 'Bachelor · Računarstvo i informatika';
    setNewStudyTrack(defaultTrack);
    setNewDepartment('Računarstvo i informatika');
    setNewStudyYear(getStudyYearsForTrack(defaultTrack)[0]);
    setNewAcademicYear(academicState?.activeAcademicYear || '2026/2027');
    setNewTitle('doc. dr.');
    setNewOffice('');
    setNewConsult('');
    setNewPhone('');
    setSelectedInitialCourseIds([]);
    setCreateUserOpen(true);
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminUid) return;
    setCreatingAccount(true);
    try {
      const selectedCourses =
        newRole === 'student'
          ? activeCourses.filter((c) => selectedInitialCourseIds.includes(c.id))
          : [];

      const res = await adminCreateUserAccount({
        adminUid,
        email: newEmail,
        password: newPassword,
        fullName: newFullName,
        role: newRole,
        studentIndex: newRole === 'student' ? newStudentIndex : '',
        department: newDepartment,
        studyTrack: newRole === 'student' ? newStudyTrack : '',
        studyYear: newRole === 'student' ? newStudyYear : '',
        academicYear: newAcademicYear,
        academicTitle: newRole === 'professor' ? newTitle : '',
        officeLocation: newRole === 'professor' ? newOffice : '',
        consultationHours: newRole === 'professor' ? newConsult : '',
        phone: newPhone,
        coursesToEnroll: selectedCourses,
      });

      setCreatedCredentials(res);
      setCreateUserOpen(false);
      toast.success(
        newRole === 'professor'
          ? `Profesorski nalog za ${res.fullName} je spreman.`
          : `Studentski nalog za ${res.fullName} (${res.studentIndex}) je spreman.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri kreiranju naloga.');
    } finally {
      setCreatingAccount(false);
    }
  };

  const handleCopyCredentials = async () => {
    if (!createdCredentials) return;
    const lines = [
      `VOLTRA — ETF Sarajevo Pristupni podaci`,
      `Ime i prezime: ${createdCredentials.fullName}`,
      `Uloga: ${createdCredentials.role === 'professor' ? 'Profesor' : 'Student'}`,
      ...(createdCredentials.role === 'student'
        ? [
            `Broj indeksa: ${createdCredentials.studentIndex}`,
            `Smjer: ${createdCredentials.studyTrack}`,
            `Godina studija: ${createdCredentials.studyYear}`,
          ]
        : [`Odsjek: ${createdCredentials.department}`]),
      `E-mail za prijavu: ${createdCredentials.email}`,
      `Početna lozinka: ${createdCredentials.password}`,
      `Napomena: Lozinku možete promijeniti nakon prijave u sekciji Moj profil.`,
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopiedCreds(true);
    toast.success('Pristupni podaci su kopirani u međuspremnik.');
    setTimeout(() => setCopiedCreds(false), 2500);
  };

  const openEditUserModal = (u: UserProfile) => {
    setEditUserTarget(u);
    setEditName(u.fullName);
    setEditRole(u.role);
    setEditIndex(u.studentIndex || '');
    const normTrack = normalizeStudyTrack(u.studyTrack);
    setEditTrack(normTrack);
    setEditDept(u.department || 'Računarstvo i informatika');
    const validYears = getStudyYearsForTrack(normTrack);
    setEditStudyYear(
      u.studyYear && validYears.includes(u.studyYear) ? u.studyYear : validYears[0]
    );
    setEditAcadYear(u.academicYear || '2026/2027');
    setEditTitle(u.academicTitle || '');
    setEditOffice(u.officeLocation || '');
    setEditConsult(u.consultationHours || '');
    setEditPhone(privatesByUid[u.uid]?.phone || '');
  };

  const handleSaveUserEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUserTarget) return;
    setSavingUserEdit(true);
    try {
      await adminUpdateUserAccount({
        targetProfile: editUserTarget,
        fullName: editName,
        role: editRole,
        studentIndex: editIndex,
        department: editDept,
        studyTrack: editRole === UserRole.STUDENT ? editTrack : '',
        studyYear: editRole === UserRole.STUDENT ? editStudyYear : '',
        academicYear: editAcadYear,
        academicTitle: editRole !== UserRole.STUDENT ? editTitle : '',
        officeLocation: editRole !== UserRole.STUDENT ? editOffice : '',
        consultationHours: editRole !== UserRole.STUDENT ? editConsult : '',
        phone: editPhone,
        userEnrollments: enrollmentsByStudentId[editUserTarget.uid] || [],
      });
      setEditUserTarget(null);
      toast.success('Korisnički podaci su uspješno ažurirani.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri ažuriranju korisnika.');
    } finally {
      setSavingUserEdit(false);
    }
  };

  const handleToggleStudentCourseEnrollment = async (
    student: UserProfile,
    course: Course
  ) => {
    const stuEnrs = enrollmentsByStudentId[student.uid] || [];
    const existing = stuEnrs.find((e) => e.courseId === course.id);
    setEnrollBusyId(course.id);
    try {
      if (existing) {
        await removeEnrollment(existing.id);
        toast.success(`Student ${student.fullName} je ispisan sa predmeta ${course.code}.`);
      } else {
        await adminEnrollStudentInCourse({ student, course });
        toast.success(`Student ${student.fullName} je upisan na predmet ${course.code}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri promjeni upisa.');
    } finally {
      setEnrollBusyId(null);
    }
  };

  const handleAdminCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosenProf =
      professorUsers.find((p) => p.uid === crsLeadProfUid) || profile;
    if (!chosenProf) return;

    setCreatingCourse(true);
    try {
      const titlePrefix = chosenProf.academicTitle?.trim() || 'doc. dr.';
      const leadFormatted = chosenProf.fullName
        .toLowerCase()
        .startsWith(titlePrefix.toLowerCase())
        ? chosenProf.fullName
        : `${titlePrefix} ${chosenProf.fullName}`;

      const extraProfs = crsCoProfs
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const assts = crsAssistants
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await createCourse({
        professorUid: chosenProf.uid,
        professorName: leadFormatted,
        professorNames: [leadFormatted, ...extraProfs],
        assistantNames: assts,
        studyProgram: crsProgram,
        code: crsCode,
        name: crsName,
        semester: crsSemester,
        academicYear: academicState?.activeAcademicYear || '2026/2027',
        ects: Number(crsEcts),
        attendanceEnabled: true,
        attendanceMaxPoints: 10,
      });

      setNewCourseOpen(false);
      setCrsCode('');
      setCrsName('');
      setCrsCoProfs('');
      setCrsAssistants('');
      toast.success('Novi predmet je uspješno kreiran i dodijeljen nastavniku.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri kreiranju predmeta.');
    } finally {
      setCreatingCourse(false);
    }
  };

  const openStaffEditor = (course: Course) => {
    setStaffEditCourse(course);
    setStaffProfsInput(getCourseProfessors(course).join(', '));
    setStaffAsstsInput(getCourseAssistants(course).join(', '));
  };

  const handleSaveCourseStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffEditCourse) return;
    setSavingStaff(true);
    try {
      const profList = staffProfsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const asstList = staffAsstsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const crsEnrs = enrollments.filter((enr) => enr.courseId === staffEditCourse.id);

      await updateCourseTeachingStaff({
        course: staffEditCourse,
        professorNames: profList,
        assistantNames: asstList,
        enrollments: crsEnrs,
      });
      setStaffEditCourse(null);
      toast.success('Nastavno osoblje na predmetu je ažurirano.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri ažuriranju osoblja.');
    } finally {
      setSavingStaff(false);
    }
  };

  const handleToggleCourseArchive = async (course: Course, targetArchived: boolean) => {
    try {
      const crsEnrollments = enrollments.filter((e) => e.courseId === course.id);
      await setCourseArchiveStatus({
        course,
        isArchived: targetArchived,
        courseEnrollments: crsEnrollments,
      });
      toast.success(
        targetArchived
          ? `Predmet ${course.code} je prebačen u arhivu starih semestara.`
          : `Predmet ${course.code} je vraćen u aktivni semestar.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri arhiviranju predmeta.');
    }
  };

  const handleRolloverSemester = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminUid) return;
    const toArchive = activeCourses.filter((c) => selectedArchiveCourseIds.includes(c.id));
    setArchivingBusy(true);
    try {
      const res = await archiveSemesterAndOpenNew({
        adminUid,
        coursesToArchive: toArchive,
        allEnrollments: enrollments,
        nextAcademicYear: nextAcadYearInput,
        nextSemesterType: nextSemTypeInput,
        nextSemesterLabel: nextSemLabelInput,
        cloneFreshCourses: cloneCoursesOnRollover,
      });
      toast.success(
        `Otvoren je ${nextSemLabelInput}! Arhivirano predmeta: ${res.archivedCount}${
          res.clonedCount > 0 ? ` · Otvoreno novih predmeta: ${res.clonedCount}` : ''
        }.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri otvaranju novog semestra.');
    } finally {
      setArchivingBusy(false);
    }
  };

  // =========================================================================
  // VIEW: SEMESTRI I AKADEMSKE GODINE
  // =========================================================================
  if (activeNav === 'semestri') {
    return (
      <div className="space-y-6">
        {/* Current Academic State Strip */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="bg-slate-900 text-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-blue-300">
                Upravljanje akademskom godinom i semestrima
              </div>
              <h2 className="text-xl font-bold mt-0.5">
                {academicState?.semesterLabel || 'Zimski semestar 2026/2027'}
              </h2>
              <p className="text-xs text-slate-300 mt-1">
                Arhiviranjem semestra stari rezultati i zaključene ocjene ostaju trajno dostupni
                studentima u sekciji „Stari semestri“, dok se nastava prebacuje na novi semestar.
              </p>
            </div>
            <div className="text-left sm:text-right shrink-0">
              <div className="text-xs text-slate-400">Aktivna akademska godina</div>
              <div className="font-mono text-lg font-bold text-white tabular-nums mt-0.5">
                {academicState?.activeAcademicYear || '2026/2027'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 divide-x divide-slate-200 bg-slate-50/60">
            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Aktivni predmeti</div>
              <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
                {activeCourses.length}
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Arhivirani predmeti</div>
              <div className="font-mono text-2xl font-bold text-blue-700 tabular-nums mt-1">
                {archivedCourses.length}
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <div className="text-xs text-slate-500">Ukupno upisa u sistemu</div>
              <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
                {enrollments.length}
              </div>
            </div>
          </div>
        </section>

        {/* Archive Old Semester & Open New Semester Form */}
        <form
          onSubmit={handleRolloverSemester}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="pb-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Arhiviraj završeni semestar i otvori novi semestar / akademsku godinu
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Označite aktivne predmete koje želite arhivirati i unesite parametre novog semestra.
              </p>
            </div>
            <FolderSync className="w-5 h-5 text-blue-700 shrink-0" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="sem-year">Nova akademska godina</Label>
              <Input
                id="sem-year"
                value={nextAcadYearInput}
                onChange={(e) => {
                  const yr = e.target.value;
                  setNextAcadYearInput(yr);
                  setNextSemLabelInput(`${nextSemTypeInput} semestar ${yr}`);
                }}
                placeholder="npr. 2026/2027 ili 2027/2028"
                className="font-mono tabular-nums"
                required
              />
            </div>

            <div>
              <Label htmlFor="sem-type">Tip semestra</Label>
              <select
                id="sem-type"
                value={nextSemTypeInput}
                onChange={(e) => {
                  const tp = e.target.value as 'Zimski' | 'Ljetni';
                  setNextSemTypeInput(tp);
                  setNextSemLabelInput(`${tp} semestar ${nextAcadYearInput}`);
                }}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value="Zimski">Zimski semestar</option>
                <option value="Ljetni">Ljetni semestar</option>
              </select>
            </div>

            <div>
              <Label htmlFor="sem-label">Zvanični naziv semestra</Label>
              <Input
                id="sem-label"
                value={nextSemLabelInput}
                onChange={(e) => setNextSemLabelInput(e.target.value)}
                placeholder="Ljetni semestar 2026/2027"
                required
              />
            </div>
          </div>

          {/* Course Selection to Archive */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800">
                Aktivni predmeti za arhiviranje ({selectedArchiveCourseIds.length} /{' '}
                {activeCourses.length}):
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedArchiveCourseIds(activeCourses.map((c) => c.id))}
                  className="text-blue-700 hover:underline cursor-pointer"
                >
                  Označi sve
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedArchiveCourseIds([])}
                  className="text-slate-500 hover:underline cursor-pointer"
                >
                  Poništi izbor
                </button>
              </div>
            </div>

            {activeCourses.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 bg-slate-50 rounded-lg">
                Trenutno nema aktivnih predmeta za arhiviranje (možete samo promijeniti aktivni
                semestar).
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto p-1">
                {activeCourses.map((crs) => {
                  const checked = selectedArchiveCourseIds.includes(crs.id);
                  return (
                    <label
                      key={crs.id}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors',
                        checked
                          ? 'border-blue-300 bg-blue-50/40 text-slate-900'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedArchiveCourseIds((prev) => [...prev, crs.id]);
                          } else {
                            setSelectedArchiveCourseIds((prev) =>
                              prev.filter((id) => id !== crs.id)
                            );
                          }
                        }}
                      />
                      <span className="font-mono font-semibold text-blue-700">{crs.code}</span>
                      <span className="truncate font-medium">{crs.name}</span>
                      <span className="ml-auto font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                        {crs.academicYear}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={cloneCoursesOnRollover}
              onChange={(e) => setCloneCoursesOnRollover(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong>Otvori čiste predmete za novu generaciju:</strong> Kreiraj nove kopije
              arhiviranih predmeta u akademskoj {nextAcadYearInput} (zadržava nastavnike, ECTS i
              kategorije bodova, bez starih bodova i prisustva).
            </span>
          </label>

          <div className="pt-2 flex justify-end">
            <Button type="submit" disabled={archivingBusy}>
              <Archive className="w-4 h-4" />
              {archivingBusy
                ? 'Arhiviranje u toku...'
                : 'Arhiviraj odabrano i otvori novi semestar'}
            </Button>
          </div>
        </form>

        {/* Archived Courses Table */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Arhivirani predmeti iz prethodnih semestara
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Studentima su ovi predmeti i ocjene trajno vidljivi u pregledu starih semestara.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              Ukupno: {archivedCourses.length}
            </span>
          </div>

          {archivedCourses.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Još nema arhiviranih predmeta.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="text-left py-3 px-4">Predmet</th>
                    <th className="text-left py-3 px-4">Program i semestar</th>
                    <th className="text-left py-3 px-4">Akademska godina</th>
                    <th className="text-right py-3 px-4">Upisanih</th>
                    <th className="text-right py-3 px-4">Akcija</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {archivedCourses.map((crs) => {
                    const count = enrollments.filter((e) => e.courseId === crs.id).length;
                    return (
                      <tr key={crs.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">
                            <span className="font-mono text-blue-700 mr-1.5">{crs.code}</span>
                            {crs.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatCourseProfessors(crs)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          <div>{crs.studyProgram || 'Bachelor'}</div>
                          <div className="text-slate-400">{crs.semester}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums">
                          {crs.academicYear}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                          {count}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleCourseArchive(crs, false)}
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" />
                            Vrati u aktivne
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }

  // =========================================================================
  // VIEW: SVI PREDMETI (Faculty-Wide Course Administration)
  // =========================================================================
  if (activeNav === 'predmeti') {
    const filteredCourses = courses.filter((crs) => {
      if (archiveFilter === 'active' && crs.isArchived) return false;
      if (archiveFilter === 'archived' && !crs.isArchived) return false;
      if (programFilter !== 'all' && getCourseProgramCycle(crs) !== programFilter) return false;
      const q = courseSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        crs.name.toLowerCase().includes(q) ||
        crs.code.toLowerCase().includes(q) ||
        (crs.studyProgram || '').toLowerCase().includes(q) ||
        formatCourseProfessors(crs).toLowerCase().includes(q) ||
        formatCourseAssistants(crs).toLowerCase().includes(q)
      );
    });

    return (
      <div className="space-y-5">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={courseSearch}
                onChange={(e) => setCourseSearch(e.target.value)}
                placeholder="Pretraži predmete, šifre, profesore ili asistente..."
                className="pl-9"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={seedBusy}
                onClick={async () => {
                  if (!profile) return;
                  setSeedBusy(true);
                  try {
                    await seedEtfDemoData({
                      adminUid: profile.uid,
                      adminName: profile.fullName,
                      adminIndex: profile.studentIndex || '19001',
                    });
                    toast.success('ETF Sarajevo demo podaci su osvježeni.');
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Greška pri učitavanju.');
                  } finally {
                    setSeedBusy(false);
                  }
                }}
              >
                <Database className="w-3.5 h-3.5" />
                Učitaj demo podatke
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={seedBusy}
                onClick={async () => {
                  if (!profile) return;
                  setSeedBusy(true);
                  try {
                    const cnt = await clearEtfDemoData(profile.uid);
                    toast.success(`Uklonjeno ${cnt} demo zapisa.`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Greška pri brisanju.');
                  } finally {
                    setSeedBusy(false);
                  }
                }}
                className="text-red-700 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Očisti demo
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setCrsLeadProfUid(professorUsers[0]?.uid || profile?.uid || '');
                  setNewCourseOpen(true);
                }}
              >
                <Plus className="w-4 h-4" />
                Kreiraj predmet
              </Button>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
              {(
                [
                  { key: 'all', label: 'Svi ciklusi' },
                  { key: 'strucni_rs', label: 'Stručni RS (2 god.)' },
                  { key: 'bachelor', label: 'Bachelor' },
                  { key: 'master', label: 'Master (RI, AE, EE, TK)' },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setProgramFilter(t.key)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap',
                    programFilter === t.key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { key: 'active', label: `Aktivni (${activeCourses.length})` },
                  { key: 'archived', label: `Arhivirani (${archivedCourses.length})` },
                  { key: 'all', label: `Svi (${courses.length})` },
                ] as const
              ).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setArchiveFilter(f.key)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap tabular-nums',
                    archiveFilter === f.key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filteredCourses.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Nema predmeta koji odgovaraju odabranom filteru.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="text-left py-3 px-4">Predmet</th>
                    <th className="text-left py-3 px-4">Smjer i semestar</th>
                    <th className="text-left py-3 px-4">Profesori i asistenti</th>
                    <th className="text-right py-3 px-4 whitespace-nowrap">Studenti</th>
                    <th className="text-right py-3 px-4">Upravljanje</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCourses.map((crs) => {
                    const enrCount = enrollments.filter((e) => e.courseId === crs.id).length;
                    const assts = formatCourseAssistants(crs);
                    return (
                      <tr key={crs.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{crs.name}</div>
                          <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                            <span className="text-blue-700 font-semibold">{crs.code}</span> ·{' '}
                            {crs.ects} ECTS · {crs.academicYear}
                            {crs.isArchived ? ' · Arhivirano' : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          <div className="font-medium text-slate-800">
                            {crs.studyProgram || 'Bachelor'}
                          </div>
                          <div>{crs.semester}</div>
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <div className="text-slate-800 font-medium">
                            {formatCourseProfessors(crs)}
                          </div>
                          <div className="text-slate-500 mt-0.5">
                            Asistenti: {assts || 'Nisu upisani'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {enrCount}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openStaffEditor(crs)}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Osoblje
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleToggleCourseArchive(crs, !Boolean(crs.isArchived))
                              }
                              className="text-slate-600"
                            >
                              {crs.isArchived ? (
                                <>
                                  <ArchiveRestore className="w-3.5 h-3.5" />
                                  Aktiviraj
                                </>
                              ) : (
                                <>
                                  <Archive className="w-3.5 h-3.5" />
                                  Arhiviraj
                                </>
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Create Course Modal */}
        <Dialog
          open={newCourseOpen}
          onOpenChange={setNewCourseOpen}
          title="Kreiraj novi predmet (Administracija)"
          description="Dodijelite odgovornog profesora, studijski program (Stručni RS 2 god., Bachelor ili Master: RI, AE, EE, TK) i osnovne podatke."
        >
          <form onSubmit={handleAdminCreateCourse} className="space-y-4 text-left">
            <div>
              <Label htmlFor="adm-crs-prof">Odgovorni profesor predmeta</Label>
              <select
                id="adm-crs-prof"
                value={crsLeadProfUid}
                onChange={(e) => setCrsLeadProfUid(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                {professorUsers.map((p) => (
                  <option key={p.uid} value={p.uid}>
                    {p.academicTitle ? `${p.academicTitle} ` : ''}
                    {p.fullName} ({privatesByUid[p.uid]?.email || p.department})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="adm-crs-prog">Studijski program / Smjer</Label>
              <select
                id="adm-crs-prog"
                value={crsProgram}
                onChange={(e) => {
                  const next = e.target.value;
                  setCrsProgram(next);
                  const presets = getSemesterPresetsForProgram(next);
                  if (presets.length > 0) setCrsSemester(presets[0].value);
                }}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                {STUDY_PROGRAM_GROUPS.map((grp) => (
                  <optgroup key={grp.groupLabel} label={grp.groupLabel}>
                    {grp.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="adm-crs-code">Šifra predmeta</Label>
                <Input
                  id="adm-crs-code"
                  value={crsCode}
                  onChange={(e) => setCrsCode(e.target.value)}
                  placeholder={crsProgram === STRUCNI_RS_PROGRAM ? 'RS-BP' : 'TK-MKS'}
                  className="font-mono"
                  required
                />
              </div>
              <div>
                <Label htmlFor="adm-crs-ects">ECTS krediti</Label>
                <Input
                  id="adm-crs-ects"
                  type="number"
                  min="1"
                  max="30"
                  value={crsEcts}
                  onChange={(e) => setCrsEcts(e.target.value)}
                  className="font-mono tabular-nums"
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="adm-crs-name">Naziv predmeta</Label>
              <Input
                id="adm-crs-name"
                value={crsName}
                onChange={(e) => setCrsName(e.target.value)}
                placeholder="npr. Mobilni komunikacijski sistemi"
                required
              />
            </div>

            <div>
              <Label htmlFor="adm-crs-sem">Semestar i godina</Label>
              <Input
                id="adm-crs-sem"
                value={crsSemester}
                onChange={(e) => setCrsSemester(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="adm-crs-coprofs">Dodatni profesori (odvojeno zarezom)</Label>
              <Input
                id="adm-crs-coprofs"
                value={crsCoProfs}
                onChange={(e) => setCrsCoProfs(e.target.value)}
                placeholder="npr. red. prof. dr. Almir Karabegović"
              />
            </div>

            <div>
              <Label htmlFor="adm-crs-assts">Asistenti na predmetu (odvojeno zarezom)</Label>
              <Input
                id="adm-crs-assts"
                value={crsAssistants}
                onChange={(e) => setCrsAssistants(e.target.value)}
                placeholder="npr. mr. Emir Buza, as. Maja Kovač"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setNewCourseOpen(false)}>
                Odustani
              </Button>
              <Button type="submit" disabled={creatingCourse}>
                {creatingCourse ? 'Kreiranje...' : 'Kreiraj predmet'}
              </Button>
            </div>
          </form>
        </Dialog>

        {/* Edit Course Teaching Staff Modal */}
        <Dialog
          open={Boolean(staffEditCourse)}
          onOpenChange={(o) => !o && setStaffEditCourse(null)}
          title={`Nastavno osoblje — ${staffEditCourse?.code || ''}`}
          description="Unesite imena jednog ili više profesora i asistenata odvojena zarezom."
        >
          <form onSubmit={handleSaveCourseStaff} className="space-y-4 text-left">
            <div>
              <Label htmlFor="stf-profs">Profesori na predmetu</Label>
              <Input
                id="stf-profs"
                value={staffProfsInput}
                onChange={(e) => setStaffProfsInput(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="stf-assts">Asistenti na predmetu</Label>
              <Input
                id="stf-assts"
                value={staffAsstsInput}
                onChange={(e) => setStaffAsstsInput(e.target.value)}
                placeholder="npr. mr. Haris Šupić, dipl. ing. Emina Begić"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStaffEditCourse(null)}>
                Odustani
              </Button>
              <Button type="submit" disabled={savingStaff}>
                {savingStaff ? 'Čuvanje...' : 'Sačuvaj osoblje'}
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    );
  }

  // =========================================================================
  // VIEW 1 (DEFAULT): KORISNICI I NALOZI (Create & Manage Professors & Students)
  // =========================================================================
  const filteredUsers = users
    .filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      const q = userSearch.trim().toLowerCase();
      if (!q) return true;
      const email = (privatesByUid[u.uid]?.email || '').toLowerCase();
      return (
        u.fullName.toLowerCase().includes(q) ||
        email.includes(q) ||
        (u.studentIndex || '').toLowerCase().includes(q) ||
        (u.studyTrack || '').toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'bs'));

  const unclaimedProvisioned = provisioned.filter((p) => p.status === 'pending');

  const countProfs = users.filter((u) => u.role === UserRole.PROFESSOR).length;
  const countStudents = users.filter((u) => u.role === UserRole.STUDENT).length;

  return (
    <div className="space-y-6">
      {/* Top KPI Hairline Strip + Quick Provisioning Actions */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-900 text-white p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-blue-300">
              Centralna administracija sistema · VOLTRA ETF Sarajevo
            </div>
            <h2 className="text-xl font-bold mt-0.5">
              Upravljanje korisničkim nalozima, pristupnim šiframa i smjerovima
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl">
              Kreirajte naloge i početne login podatke za profesore i studente, dodijelite broj
              indeksa, ciklus, smjer i godinu studija te upravljajte upisima na predmete.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              size="sm"
              onClick={() => openCreateAccountModal('professor')}
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              <UserPlus className="w-4 h-4" />
              Dodaj profesora
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openCreateAccountModal('student')}
            >
              <UserPlus className="w-4 h-4" />
              Dodaj studenta
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/60">
          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Ukupno naloga</div>
            <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
              {users.length}
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Profesori i osoblje</div>
            <div className="font-mono text-2xl font-bold text-blue-700 tabular-nums mt-1">
              {countProfs}
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Registrovani studenti</div>
            <div className="font-mono text-2xl font-bold text-emerald-700 tabular-nums mt-1">
              {countStudents}
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <div className="text-xs text-slate-500">Aktivni predmeti</div>
            <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
              {activeCourses.length}
            </div>
          </div>
        </div>
      </section>

      {/* Newly Issued Credentials Card (Copyable Login Slip for Professor or Student) */}
      {createdCredentials && (
        <section className="bg-white border border-emerald-300 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-emerald-700">
                Nalog uspješno generisan — Pristupni podaci za predaju korisniku
              </div>
              <h3 className="text-base font-bold text-slate-900 mt-0.5">
                {createdCredentials.fullName} (
                {createdCredentials.role === 'professor'
                  ? 'Profesor'
                  : `Student · Indeks ${createdCredentials.studentIndex}`}
                )
              </h3>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" onClick={handleCopyCredentials}>
                {copiedCreds ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Kopirano
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Kopiraj login podatke
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreatedCredentials(null)}
                className="text-slate-500"
              >
                Zatvori
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 text-xs">
            <div>
              <span className="text-slate-500 block">E-mail za prijavu:</span>
              <span className="font-mono font-semibold text-slate-900">
                {createdCredentials.email}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Generisana početna lozinka:</span>
              <span className="font-mono font-semibold text-blue-700">
                {createdCredentials.password}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Dodijeljeni program / odsjek:</span>
              <span className="font-medium text-slate-800">
                {createdCredentials.role === 'student'
                  ? `${createdCredentials.studyTrack} (${createdCredentials.studyYear})`
                  : createdCredentials.department}
              </span>
            </div>
          </div>

          {!createdCredentials.emailPasswordAuthActive && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <strong>Napomena za direktnu prijavu lozinkom:</strong> U Firebase konzoli projekta
                potrebno je uključiti <strong>Authentication → Sign-in method → Email/Password</strong>{' '}
                kako bi se korisnik mogao prijaviti lozinkom. Svi podaci o ulozi, indeksu i smjeru su
                već sačuvani i automatski se povezuju čim se korisnik prijavi putem Google računa
                ili nakon uključenja Email/Password prijave.
              </div>
            </div>
          )}
        </section>
      )}

      {/* Search & Role Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Pretraži po imenu, e-mailu, indeksu ili smjeru..."
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(
            [
              { key: 'all', label: `Svi nalozi (${users.length})` },
              { key: 'professor', label: `Profesori (${countProfs})` },
              { key: 'student', label: `Studenti (${countStudents})` },
              {
                key: 'admin',
                label: `Administratori (${users.filter((u) => u.role === UserRole.ADMIN).length})`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setRoleFilter(tab.key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap tabular-nums',
                roleFilter === tab.key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pending Provisioned Accounts (if Email/Password provider wasn't enabled yet) */}
      {unclaimedProvisioned.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
            <h3 className="text-xs font-semibold text-slate-700">
              Unaprijed pripremljeni nalozi koji čekaju prvu prijavu ({unclaimedProvisioned.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {unclaimedProvisioned.map((prov) => (
              <div
                key={prov.id}
                className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{prov.fullName}</span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="font-mono text-blue-700">{prov.targetEmail}</span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span>
                    {prov.role === 'professor'
                      ? `Profesor (${prov.department})`
                      : `Student · Indeks ${prov.studentIndex} · ${prov.studyTrack}`}
                  </span>
                </div>
                <span className="text-amber-700 font-medium">Čeka prvu prijavu</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Učitavanje imenika...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Nema korisnika koji odgovaraju kriteriju pretrage.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="text-left py-3 px-4">Korisnik i e-mail</th>
                  <th className="text-left py-3 px-4">Uloga</th>
                  <th className="text-left py-3 px-4">Indeks / Zvanje</th>
                  <th className="text-left py-3 px-4">Smjer / Odsjek i godina</th>
                  <th className="text-right py-3 px-4 whitespace-nowrap">Predmeti</th>
                  <th className="text-right py-3 px-4">Akcija</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => {
                  const priv = privatesByUid[u.uid];
                  const stuEnrCount = (enrollmentsByStudentId[u.uid] || []).filter(
                    (e) => !e.isArchived
                  ).length;
                  const profCrsCount = activeCourses.filter((c) =>
                    c.professorIds.includes(u.uid)
                  ).length;

                  return (
                    <tr key={u.uid} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{u.fullName}</div>
                        <div className="text-xs text-slate-500 font-mono">
                          {priv?.email || (u.isSeed ? 'demo.nalog@etf.unsa.ba' : u.uid.slice(0, 14))}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-medium">
                        {u.role === UserRole.ADMIN ? (
                          <span className="text-slate-900 font-semibold">Administrator</span>
                        ) : u.role === UserRole.PROFESSOR ? (
                          <span className="text-blue-700 font-semibold">Profesor</span>
                        ) : (
                          <span className="text-emerald-700 font-medium">Student</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-700">
                        {u.role === UserRole.STUDENT
                          ? u.studentIndex || '—'
                          : u.academicTitle || 'Nastavnik'}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        {u.role === UserRole.STUDENT ? (
                          <>
                            <div className="font-medium text-slate-800">
                              {normalizeStudyTrack(u.studyTrack) || u.department}
                            </div>
                            <div className="text-slate-500">
                              {u.studyYear || 'I ciklus'} · Akad. {u.academicYear}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium text-slate-800">{u.department}</div>
                            {u.officeLocation && (
                              <div className="text-slate-500">{u.officeLocation}</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {u.role === UserRole.STUDENT ? stuEnrCount : profCrsCount}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {u.role === UserRole.STUDENT && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEnrollManageStudent(u)}
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                              Predmeti
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditUserModal(u)}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Uredi
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal 1: Create New Professor or Student Account with Credentials */}
      <Dialog
        open={createUserOpen}
        onOpenChange={setCreateUserOpen}
        title={
          newRole === 'professor'
            ? 'Kreiraj novi profesorski nalog'
            : 'Kreiraj novi studentski nalog'
        }
        description="Generišite pristupni e-mail i početnu šifru te dodijelite zvanične akademske podatke."
      >
        <form onSubmit={handleCreateUserSubmit} className="space-y-4 text-left">
          {/* Role Switcher */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setNewRole('student')}
              className={cn(
                'py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer',
                newRole === 'student'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Student
            </button>
            <button
              type="button"
              onClick={() => setNewRole('professor')}
              className={cn(
                'py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer',
                newRole === 'professor'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Profesor / Nastavnik
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="crt-name">Ime i prezime</Label>
              <Input
                id="crt-name"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder={newRole === 'professor' ? 'npr. Samir Ribić' : 'npr. Amar Kovačević'}
                required
              />
            </div>

            <div>
              <Label htmlFor="crt-email">Login e-mail adresa</Label>
              <Input
                id="crt-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={
                  newRole === 'professor' ? 'sribic@etf.unsa.ba' : 'akovacevic1@etf.unsa.ba'
                }
                required
              />
            </div>
          </div>

          {/* Password Generator Row */}
          <div>
            <Label htmlFor="crt-pwd">Početna lozinka za prijavu</Label>
            <div className="flex items-center gap-2">
              <Input
                id="crt-pwd"
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="font-mono"
                minLength={6}
                required
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setNewPassword(generateInitialPassword())}
                className="shrink-0 h-9"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Generiši šifru
              </Button>
            </div>
          </div>

          {newRole === 'student' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="crt-idx">Broj indeksa (obavezno)</Label>
                  <Input
                    id="crt-idx"
                    value={newStudentIndex}
                    onChange={(e) => setNewStudentIndex(e.target.value)}
                    placeholder="npr. 19310, RS-245 ili M-1510"
                    className="font-mono tabular-nums"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="crt-ay">Upisana akademska godina</Label>
                  <Input
                    id="crt-ay"
                    value={newAcademicYear}
                    onChange={(e) => setNewAcademicYear(e.target.value)}
                    className="font-mono tabular-nums"
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="crt-track">
                  Studijski program / Smjer (Stručni RS 2 god., Bachelor, Master: RI, AE, EE, TK)
                </Label>
                <select
                  id="crt-track"
                  value={newStudyTrack}
                  onChange={(e) => {
                    const trk = e.target.value;
                    setNewStudyTrack(trk);
                    setNewDepartment(
                      getDefaultDepartmentForTrack(trk) || 'Računarstvo i informatika'
                    );
                    const yrs = getStudyYearsForTrack(trk);
                    setNewStudyYear(yrs[0]);
                  }}
                  className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {STUDY_PROGRAM_GROUPS.map((grp) => (
                    <optgroup key={grp.groupLabel} label={grp.groupLabel}>
                      {grp.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="crt-dept">Matični odsjek</Label>
                  <select
                    id="crt-dept"
                    value={newDepartment}
                    onChange={(e) => setNewDepartment(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    {ETF_DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label htmlFor="crt-yr">Godina studija</Label>
                  <select
                    id="crt-yr"
                    value={newStudyYear}
                    onChange={(e) => setNewStudyYear(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    {getStudyYearsForTrack(newStudyTrack).map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Optional Immediate Course Enrollment */}
              {activeCourses.length > 0 && (
                <div>
                  <Label>Odmah upiši studenta na aktivne predmete (opciono)</Label>
                  <div className="mt-1 max-h-36 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {activeCourses.map((crs) => {
                      const sel = selectedInitialCourseIds.includes(crs.id);
                      return (
                        <label
                          key={crs.id}
                          className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={sel}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedInitialCourseIds((prev) => [...prev, crs.id]);
                              } else {
                                setSelectedInitialCourseIds((prev) =>
                                  prev.filter((id) => id !== crs.id)
                                );
                              }
                            }}
                          />
                          <span className="font-mono font-semibold text-blue-700">{crs.code}</span>
                          <span className="truncate text-slate-800">{crs.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="crt-title">Akademsko zvanje</Label>
                <select
                  id="crt-title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {ACADEMIC_TITLE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="crt-pdept">Matični odsjek / Katedra</Label>
                <select
                  id="crt-pdept"
                  value={newDepartment}
                  onChange={(e) => setNewDepartment(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {ETF_DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="crt-off">Kabinet i lokacija</Label>
                <Input
                  id="crt-off"
                  value={newOffice}
                  onChange={(e) => setNewOffice(e.target.value)}
                  placeholder="npr. Kabinet 3-12"
                />
              </div>

              <div>
                <Label htmlFor="crt-cons">Termini konsultacija</Label>
                <Input
                  id="crt-cons"
                  value={newConsult}
                  onChange={(e) => setNewConsult(e.target.value)}
                  placeholder="npr. Srijeda 11:00–13:00"
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateUserOpen(false)}>
              Odustani
            </Button>
            <Button type="submit" disabled={creatingAccount}>
              <KeyRound className="w-4 h-4" />
              {creatingAccount ? 'Kreiranje naloga...' : 'Generiši nalog i login podatke'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal 2: Edit Existing User Account (Admin Full Override) */}
      <Dialog
        open={Boolean(editUserTarget)}
        onOpenChange={(o) => !o && setEditUserTarget(null)}
        title={`Uredi korisnički nalog — ${editUserTarget?.fullName || ''}`}
        description="Kao administrator možete promijeniti ulogu, broj indeksa, studijski smjer, godinu studija i kabinetske podatke."
      >
        <form onSubmit={handleSaveUserEdit} className="space-y-4 text-left">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edt-name">Ime i prezime</Label>
              <Input
                id="edt-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="edt-role">Sistemska uloga</Label>
              <select
                id="edt-role"
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as UserRole)}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value={UserRole.STUDENT}>Student</option>
                <option value={UserRole.PROFESSOR}>Profesor</option>
                <option value={UserRole.ADMIN}>Administrator</option>
              </select>
            </div>
          </div>

          {editRole === UserRole.STUDENT ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="edt-idx">Broj indeksa</Label>
                  <Input
                    id="edt-idx"
                    value={editIndex}
                    onChange={(e) => setEditIndex(e.target.value)}
                    className="font-mono tabular-nums"
                  />
                </div>
                <div>
                  <Label htmlFor="edt-ay">Akademska godina</Label>
                  <Input
                    id="edt-ay"
                    value={editAcadYear}
                    onChange={(e) => setEditAcadYear(e.target.value)}
                    className="font-mono tabular-nums"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="edt-track">Studijski program / Smjer</Label>
                <select
                  id="edt-track"
                  value={editTrack}
                  onChange={(e) => {
                    const trk = e.target.value;
                    setEditTrack(trk);
                    setEditDept(
                      getDefaultDepartmentForTrack(trk) || 'Računarstvo i informatika'
                    );
                    const yrs = getStudyYearsForTrack(trk);
                    if (!yrs.includes(editStudyYear)) setEditStudyYear(yrs[0]);
                  }}
                  className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {STUDY_PROGRAM_GROUPS.map((grp) => (
                    <optgroup key={grp.groupLabel} label={grp.groupLabel}>
                      {grp.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="edt-dept">Matični odsjek</Label>
                  <select
                    id="edt-dept"
                    value={editDept}
                    onChange={(e) => setEditDept(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    {ETF_DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label htmlFor="edt-yr">Godina studija</Label>
                  <select
                    id="edt-yr"
                    value={editStudyYear}
                    onChange={(e) => setEditStudyYear(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    {getStudyYearsForTrack(editTrack).map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edt-title">Akademsko zvanje</Label>
                <select
                  id="edt-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  <option value="">Bez prefiksa</option>
                  {ACADEMIC_TITLE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="edt-pdept">Odsjek / Katedra</Label>
                <select
                  id="edt-pdept"
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {ETF_DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="edt-off">Kabinet</Label>
                <Input
                  id="edt-off"
                  value={editOffice}
                  onChange={(e) => setEditOffice(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edt-cons">Konsultacije</Label>
                <Input
                  id="edt-cons"
                  value={editConsult}
                  onChange={(e) => setEditConsult(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="edt-phone">Kontakt telefon</Label>
            <Input
              id="edt-phone"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              className="font-mono tabular-nums"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditUserTarget(null)}>
              Odustani
            </Button>
            <Button type="submit" disabled={savingUserEdit}>
              {savingUserEdit ? 'Čuvanje...' : 'Sačuvaj izmjene'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal 3: Manage Student Course Enrollments */}
      <Dialog
        open={Boolean(enrollManageStudent)}
        onOpenChange={(o) => !o && setEnrollManageStudent(null)}
        title={`Upis predmeta — ${enrollManageStudent?.fullName || ''} (${enrollManageStudent?.studentIndex || ''})`}
        description="Jednim klikom dodijelite ili uklonite aktivne predmete za izabranog studenta."
      >
        {enrollManageStudent && (
          <div className="space-y-3 text-left">
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {activeCourses.map((crs) => {
                const isEnrolled = (
                  enrollmentsByStudentId[enrollManageStudent.uid] || []
                ).some((e) => e.courseId === crs.id);
                const busy = enrollBusyId === crs.id;

                return (
                  <div
                    key={crs.id}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        <span className="font-mono text-blue-700 mr-1.5">{crs.code}</span>
                        {crs.name}
                      </div>
                      <div className="text-slate-500 truncate">
                        {crs.studyProgram || 'Bachelor'} · {crs.ects} ECTS
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant={isEnrolled ? 'outline' : 'default'}
                      disabled={busy}
                      onClick={() =>
                        handleToggleStudentCourseEnrollment(enrollManageStudent, crs)
                      }
                      className="shrink-0 h-8"
                    >
                      {isEnrolled ? 'Ukloni upis' : 'Upiši studenta'}
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setEnrollManageStudent(null)}>
                Zatvori
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
