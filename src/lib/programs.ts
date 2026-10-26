import { Course } from '../types/zamio';

export type StudyCycleKey = 'all' | 'strucni_rs' | 'bachelor' | 'master' | 'doktorski';

export const ETF_DEPARTMENTS = [
  'Računarstvo i informatika',
  'Automatika i elektronika',
  'Elektroenergetika',
  'Telekomunikacije',
  'Stručni studij — Razvoj softvera',
] as const;

export interface StudyProgramOption {
  value: string;
  label: string;
  shortLabel: string;
  cycle: Exclude<StudyCycleKey, 'all'>;
  department: string;
}

export interface StudyProgramGroup {
  groupLabel: string;
  cycle: Exclude<StudyCycleKey, 'all'>;
  options: StudyProgramOption[];
}

export const STRUCNI_RS_PROGRAM = 'Stručni studij · Razvoj softvera (2 godine)';

export const MASTER_RI_PROGRAM = 'Master · Računarstvo i informatika';
export const MASTER_AE_PROGRAM = 'Master · Automatika i elektronika';
export const MASTER_EE_PROGRAM = 'Master · Elektroenergetika';
export const MASTER_TK_PROGRAM = 'Master · Telekomunikacije';

export const STUDY_PROGRAM_GROUPS: StudyProgramGroup[] = [
  {
    groupLabel: 'Stručni studij (2 godine · 120 ECTS)',
    cycle: 'strucni_rs',
    options: [
      {
        value: STRUCNI_RS_PROGRAM,
        label: 'Razvoj softvera — Stručni studij (2 godine · 120 ECTS)',
        shortLabel: 'Stručni studij · Razvoj softvera (2 god.)',
        cycle: 'strucni_rs',
        department: 'Stručni studij — Razvoj softvera',
      },
    ],
  },
  {
    groupLabel: 'I ciklus — Bachelor studij (3 godine · 180 ECTS)',
    cycle: 'bachelor',
    options: [
      {
        value: 'Bachelor · Računarstvo i informatika',
        label: 'Računarstvo i informatika (Bachelor · 3 godine)',
        shortLabel: 'Bachelor · Računarstvo i informatika',
        cycle: 'bachelor',
        department: 'Računarstvo i informatika',
      },
      {
        value: 'Bachelor · Automatika i elektronika',
        label: 'Automatika i elektronika (Bachelor · 3 godine)',
        shortLabel: 'Bachelor · Automatika i elektronika',
        cycle: 'bachelor',
        department: 'Automatika i elektronika',
      },
      {
        value: 'Bachelor · Elektroenergetika',
        label: 'Elektroenergetika (Bachelor · 3 godine)',
        shortLabel: 'Bachelor · Elektroenergetika',
        cycle: 'bachelor',
        department: 'Elektroenergetika',
      },
      {
        value: 'Bachelor · Telekomunikacije',
        label: 'Telekomunikacije (Bachelor · 3 godine)',
        shortLabel: 'Bachelor · Telekomunikacije',
        cycle: 'bachelor',
        department: 'Telekomunikacije',
      },
    ],
  },
  {
    groupLabel: 'II ciklus — Master studij (2 godine · 120 ECTS)',
    cycle: 'master',
    options: [
      {
        value: MASTER_RI_PROGRAM,
        label: 'Računarstvo i informatika (Master · 2 godine)',
        shortLabel: MASTER_RI_PROGRAM,
        cycle: 'master',
        department: 'Računarstvo i informatika',
      },
      {
        value: MASTER_AE_PROGRAM,
        label: 'Automatika i elektronika (Master · 2 godine)',
        shortLabel: MASTER_AE_PROGRAM,
        cycle: 'master',
        department: 'Automatika i elektronika',
      },
      {
        value: MASTER_EE_PROGRAM,
        label: 'Elektroenergetika (Master · 2 godine)',
        shortLabel: MASTER_EE_PROGRAM,
        cycle: 'master',
        department: 'Elektroenergetika',
      },
      {
        value: MASTER_TK_PROGRAM,
        label: 'Telekomunikacije (Master · 2 godine)',
        shortLabel: MASTER_TK_PROGRAM,
        cycle: 'master',
        department: 'Telekomunikacije',
      },
    ],
  },
  {
    groupLabel: 'III ciklus — Doktorski studij (3 godine · 180 ECTS)',
    cycle: 'doktorski',
    options: [
      {
        value: 'Doktorski studij · Elektrotehnika i računarstvo',
        label: 'Elektrotehnika i računarstvo — III ciklus (Doktorski studij)',
        shortLabel: 'Doktorski studij · III ciklus',
        cycle: 'doktorski',
        department: 'Računarstvo i informatika',
      },
    ],
  },
];

export const ALL_STUDY_PROGRAMS: StudyProgramOption[] = STUDY_PROGRAM_GROUPS.flatMap(
  (g) => g.options
);

/**
 * Normalizes legacy Master sub-track names to the 4 official ETF Sarajevo Master departments.
 */
export function normalizeStudyTrack(value?: string): string {
  if (!value) return 'Bachelor · Računarstvo i informatika';
  const direct = ALL_STUDY_PROGRAMS.find((opt) => opt.value === value);
  if (direct) return direct.value;

  const low = value.toLowerCase();
  if (low.includes('master')) {
    if (low.includes('(ae)') || low.includes('automatika') || low.includes('elektronika')) {
      return MASTER_AE_PROGRAM;
    }
    if (low.includes('(ee)') || low.includes('elektroenerget')) {
      return MASTER_EE_PROGRAM;
    }
    if (low.includes('(tk)') || low.includes('telekomunikacij') || low.includes('signala')) {
      return MASTER_TK_PROGRAM;
    }
    return MASTER_RI_PROGRAM;
  }
  if (low.includes('stručni') || low.includes('strucni') || low.includes('razvoj softvera')) {
    return STRUCNI_RS_PROGRAM;
  }
  if (low.includes('doktorski') || low.includes('iii ciklus')) {
    return 'Doktorski studij · Elektrotehnika i računarstvo';
  }
  return ALL_STUDY_PROGRAMS[1]?.value || 'Bachelor · Računarstvo i informatika';
}

export function findStudyProgramOption(value?: string): StudyProgramOption | undefined {
  if (!value) return undefined;
  const direct = ALL_STUDY_PROGRAMS.find((opt) => opt.value === value);
  if (direct) return direct;
  const normalized = normalizeStudyTrack(value);
  return ALL_STUDY_PROGRAMS.find((opt) => opt.value === normalized);
}

export function getCycleFromProgramString(value?: string): Exclude<StudyCycleKey, 'all'> {
  if (!value) return 'bachelor';
  const low = value.toLowerCase();
  if (low.includes('stručni') || low.includes('strucni') || low.includes('razvoj softvera')) {
    return 'strucni_rs';
  }
  if (low.includes('master') || low.includes('ii ciklus')) {
    return 'master';
  }
  if (low.includes('doktorski') || low.includes('iii ciklus')) {
    return 'doktorski';
  }
  const found = ALL_STUDY_PROGRAMS.find((opt) => opt.value === value);
  return found ? found.cycle : 'bachelor';
}

export function getCourseProgramCycle(
  course?: Pick<Course, 'studyProgram' | 'code' | 'semester'> | null
): Exclude<StudyCycleKey, 'all'> {
  if (!course) return 'bachelor';
  if (course.studyProgram) {
    return getCycleFromProgramString(course.studyProgram);
  }
  const codeUp = (course.code || '').toUpperCase();
  if (codeUp.startsWith('RS-')) return 'strucni_rs';
  const semLow = (course.semester || '').toLowerCase();
  if (semLow.includes('master')) return 'master';
  if (semLow.includes('stručni') || semLow.includes('strucni')) return 'strucni_rs';
  return 'bachelor';
}

export function getStudyYearsForTrack(studyTrack?: string): string[] {
  const cycle = getCycleFromProgramString(studyTrack);
  if (cycle === 'strucni_rs') {
    return [
      'I godina · Stručni studij Razvoj softvera (2 god.)',
      'II godina · Stručni studij Razvoj softvera (2 god.)',
    ];
  }
  if (cycle === 'master') {
    return [
      'I godina · II ciklus (Master studij)',
      'II godina · II ciklus (Master studij)',
    ];
  }
  if (cycle === 'doktorski') {
    return [
      'I godina · III ciklus (Doktorski studij)',
      'II godina · III ciklus (Doktorski studij)',
      'III godina · III ciklus (Doktorski studij)',
    ];
  }
  return [
    'I godina · I ciklus (Bachelor)',
    'II godina · I ciklus (Bachelor)',
    'III godina · I ciklus (Bachelor)',
  ];
}

export function getDefaultDepartmentForTrack(studyTrack?: string): string | null {
  const opt = findStudyProgramOption(studyTrack);
  return opt ? opt.department : null;
}

export function formatStudentRosterProgramLabel(
  department: string,
  studyTrack?: string
): string {
  if (studyTrack && studyTrack.trim()) {
    const normalized = normalizeStudyTrack(studyTrack);
    const opt = ALL_STUDY_PROGRAMS.find((o) => o.value === normalized);
    if (opt) return opt.shortLabel.slice(0, 80);
    return normalized.slice(0, 80);
  }
  return (department || 'Računarstvo i informatika').trim().slice(0, 80);
}

export function getSemesterPresetsForProgram(studyProgram?: string): Array<{
  short: string;
  value: string;
}> {
  const cycle = getCycleFromProgramString(studyProgram);
  if (cycle === 'strucni_rs') {
    return [
      { short: 'I god · 1. sem', value: 'Zimski semestar · I godina (1. semestar)' },
      { short: 'I god · 2. sem', value: 'Ljetni semestar · I godina (2. semestar)' },
      { short: 'II god · 3. sem', value: 'Zimski semestar · II godina (3. semestar)' },
      { short: 'II god · 4. sem', value: 'Ljetni semestar · II godina (4. semestar)' },
    ];
  }
  if (cycle === 'master') {
    return [
      { short: 'I god Master · Zimski', value: 'Zimski semestar · I godina Mastera' },
      { short: 'I god Master · Ljetni', value: 'Ljetni semestar · I godina Mastera' },
      { short: 'II god Master · Zimski', value: 'Zimski semestar · II godina Mastera' },
      { short: 'II god Master · Ljetni', value: 'Ljetni semestar · II godina Mastera' },
    ];
  }
  if (cycle === 'doktorski') {
    return [
      { short: 'I god · Zimski', value: 'Zimski semestar · I godina (III ciklus)' },
      { short: 'II god · Zimski', value: 'Zimski semestar · II godina (III ciklus)' },
    ];
  }
  return [
    { short: 'I god · Zimski', value: 'Zimski semestar · I godina' },
    { short: 'I god · Ljetni', value: 'Ljetni semestar · I godina' },
    { short: 'II god · Zimski', value: 'Zimski semestar · II godina' },
    { short: 'II god · Ljetni', value: 'Ljetni semestar · II godina' },
    { short: 'III god · Zimski', value: 'Zimski semestar · III godina' },
    { short: 'III god · Ljetni', value: 'Ljetni semestar · III godina' },
  ];
}
