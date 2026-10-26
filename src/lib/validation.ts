/**
 * Centralized validation constants and helpers synchronized verbatim
 * with firebase-blueprint.json and firestore.rules.
 */

export const VALIDATION_CONSTRAINTS = {
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  ID_MAX_LENGTH: 128,
  COURSE_ID_MAX_LENGTH: 60,
  STUDENT_ID_MAX_LENGTH: 64,
  STUDENT_INDEX_PATTERN: /^[a-zA-Z0-9_-]*$/,
  STUDENT_INDEX_REQUIRED_PATTERN: /^[a-zA-Z0-9_-]+$/,
  STUDENT_INDEX_MAX_LENGTH: 20,
  COURSE_CODE_PATTERN: /^[a-zA-Z0-9_-]+$/,
  COURSE_CODE_MAX_LENGTH: 20,
  DATE_PATTERN: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  FULL_NAME_MAX_LENGTH: 100,
  DEPARTMENT_MAX_LENGTH: 80,
  COURSE_NAME_MAX_LENGTH: 120,
  SEMESTER_MAX_LENGTH: 80,
  ACADEMIC_YEAR_MAX_LENGTH: 20,
  CATEGORY_NAME_MAX_LENGTH: 80,
  ITEM_NAME_MAX_LENGTH: 120,
  DESCRIPTION_MAX_LENGTH: 500,
  FEEDBACK_MAX_LENGTH: 500,
  SESSION_TIME_MAX_LENGTH: 20,
  SESSION_TOPIC_MAX_LENGTH: 150,
  ATTENDANCE_NOTE_MAX_LENGTH: 200,
  FINAL_GRADE_COMMENT_MAX_LENGTH: 300,
  EMAIL_MAX_LENGTH: 254,
  PHONE_MAX_LENGTH: 30,
  PERSONAL_NOTE_MAX_LENGTH: 240,
  INVITE_CODE_MIN_LENGTH: 6,
  INVITE_CODE_MAX_LENGTH: 64,
  MAX_PROFESSORS_PER_COURSE: 10,
  MAX_ASSISTANTS_PER_COURSE: 15,
  STAFF_NAME_MAX_LENGTH: 100,
  ACADEMIC_TITLE_MAX_LENGTH: 40,
  OFFICE_LOCATION_MAX_LENGTH: 60,
  CONSULTATION_HOURS_MAX_LENGTH: 100,
  STUDY_YEAR_MAX_LENGTH: 80,
  STUDY_TRACK_MAX_LENGTH: 100,
  STUDY_PROGRAM_MAX_LENGTH: 100,
  MAX_CATEGORIES_PER_COURSE: 20,
  MAX_ITEMS_PER_COURSE: 60,
  MAX_SESSIONS_PER_COURSE: 60,
  MAX_EXAM_TERMS_PER_COURSE: 40,
  MAX_SCHEDULE_EVENTS_PER_COURSE: 80,
  EXAM_TITLE_MAX_LENGTH: 120,
  CLASSROOM_MAX_LENGTH: 60,
  EXAM_NOTES_MAX_LENGTH: 300,
  ANNOUNCEMENT_TITLE_MAX_LENGTH: 140,
  ANNOUNCEMENT_BODY_MAX_LENGTH: 2000,
  SCHEDULE_TITLE_MAX_LENGTH: 140,
  SCHEDULE_TIME_MAX_LENGTH: 10,
  SCHEDULE_LOCATION_MAX_LENGTH: 80,
  SCHEDULE_DESC_MAX_LENGTH: 300,
  SCHEDULE_DESCRIPTION_MAX_LENGTH: 300,
  SEMESTER_LABEL_MAX_LENGTH: 80,
  ACTIVITY_DESC_MAX_LENGTH: 300,
  PASSWORD_MIN_LENGTH: 6,
  PASSWORD_MAX_LENGTH: 64,
} as const;

export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function emailToProvisionId(email: string): string {
  const normalized = email.trim().toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]/g, '_').slice(0, 80);
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) >>> 0;
  }
  return `prov_${slug}_${hash.toString(36)}`.slice(0, 120);
}

export function generateInitialPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const pick = (chars: string, count: number) =>
    Array.from({ length: count }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `Voltra-${pick(upper, 2)}${pick(lower, 2)}${pick(digits, 3)}!`;
}

export function sanitizeStaffList(
  names: string[],
  maxItems: number,
  maxItemLength: number = VALIDATION_CONSTRAINTS.STAFF_NAME_MAX_LENGTH
): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of names) {
    const item = sanitizeText(raw, maxItemLength);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(item);
    if (cleaned.length >= maxItems) break;
  }
  return cleaned;
}

export function isValidResourceId(id: string, maxLen: number = VALIDATION_CONSTRAINTS.ID_MAX_LENGTH): boolean {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= maxLen &&
    VALIDATION_CONSTRAINTS.ID_PATTERN.test(id)
  );
}

export function isValidIsoDate(dateStr: string): boolean {
  if (!VALIDATION_CONSTRAINTS.DATE_PATTERN.test(dateStr)) {
    return false;
  }
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

export interface ScoreValidationResult {
  valid: boolean;
  error?: string;
}

export function validateExamTermDates(params: {
  registrationOpenDate: string;
  registrationCloseDate: string;
  examDate: string;
}): ScoreValidationResult {
  const { registrationOpenDate, registrationCloseDate, examDate } = params;
  if (!isValidIsoDate(registrationOpenDate)) {
    return { valid: false, error: 'Unesite ispravan datum početka prijave.' };
  }
  if (!isValidIsoDate(registrationCloseDate)) {
    return { valid: false, error: 'Unesite ispravan datum isteka prijave.' };
  }
  if (!isValidIsoDate(examDate)) {
    return { valid: false, error: 'Unesite ispravan datum održavanja ispita.' };
  }
  if (registrationOpenDate > registrationCloseDate) {
    return {
      valid: false,
      error: 'Datum početka prijave ne može biti nakon datuma isteka prijave.',
    };
  }
  if (registrationCloseDate > examDate) {
    return {
      valid: false,
      error: 'Datum isteka prijave mora biti prije ili na dan održavanja ispita.',
    };
  }
  return { valid: true };
}

export function validateScoreInput(
  points: number,
  itemMaxPoints: number,
  allowBonusPoints: boolean
): ScoreValidationResult {
  if (typeof points !== 'number' || Number.isNaN(points) || !Number.isFinite(points)) {
    return { valid: false, error: 'Broj bodova mora biti ispravan broj.' };
  }
  if (points < 0) {
    return { valid: false, error: 'Broj bodova ne može biti negativan.' };
  }
  if (!allowBonusPoints && points > itemMaxPoints) {
    return {
      valid: false,
      error: `Broj bodova (${points}) ne može preći maksimum stavke (${itemMaxPoints}) dok bonus bodovi nisu uključeni.`,
    };
  }
  if (points > 200) {
    return { valid: false, error: 'Broj bodova ne može preći 200.' };
  }
  return { valid: true };
}

export function validateGradeThresholds(thresholds: {
  grade6Threshold: number;
  grade7Threshold: number;
  grade8Threshold: number;
  grade9Threshold: number;
  grade10Threshold: number;
}): ScoreValidationResult {
  const {
    grade6Threshold: g6,
    grade7Threshold: g7,
    grade8Threshold: g8,
    grade9Threshold: g9,
    grade10Threshold: g10,
  } = thresholds;

  const vals = [g6, g7, g8, g9, g10];
  if (vals.some((v) => typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v))) {
    return { valid: false, error: 'Svi pragovi ocjena moraju biti brojevi.' };
  }
  if (g6 < 0) {
    return { valid: false, error: 'Prag za ocjenu 6 ne može biti negativan.' };
  }
  if (!(g6 < g7 && g7 < g8 && g8 < g9 && g9 < g10)) {
    return {
      valid: false,
      error: 'Pragovi ocjena moraju strogo rasti (Ocjena 6 < 7 < 8 < 9 < 10).',
    };
  }
  if (g10 > 200) {
    return { valid: false, error: 'Prag za ocjenu 10 ne može preći 200 bodova.' };
  }
  return { valid: true };
}

export function validateActivityAwardInput(params: {
  points: number;
  maxPoints: number;
  date: string;
  description: string;
  allowBonusPoints: boolean;
}): ScoreValidationResult {
  const { points, maxPoints, date, description, allowBonusPoints } = params;
  if (typeof points !== 'number' || Number.isNaN(points) || !Number.isFinite(points)) {
    return { valid: false, error: 'Broj bodova za aktivnost mora biti ispravan broj.' };
  }
  if (points < 0) {
    return { valid: false, error: 'Bodovi za aktivnost ne mogu biti negativni.' };
  }
  if (points > 100) {
    return { valid: false, error: 'Pojedinačni unos aktivnosti ne može preći 100 bodova.' };
  }
  if (typeof maxPoints !== 'number' || Number.isNaN(maxPoints) || !Number.isFinite(maxPoints) || maxPoints < 0 || maxPoints > 100) {
    return { valid: false, error: 'Maksimalni broj bodova mora biti između 0 i 100.' };
  }
  if (maxPoints > 0 && !allowBonusPoints && points > maxPoints) {
    return {
      valid: false,
      error: `Osvojeni bodovi (${points}) ne mogu preći maksimalni iznos (${maxPoints}) dok bonus bodovi nisu uključeni na predmetu.`,
    };
  }
  if (!isValidIsoDate(date)) {
    return { valid: false, error: 'Unesite ispravan datum aktivnosti (YYYY-MM-DD).' };
  }
  const cleanDesc = sanitizeText(description, VALIDATION_CONSTRAINTS.ACTIVITY_DESC_MAX_LENGTH);
  if (!cleanDesc) {
    return { valid: false, error: 'Unesite kratak opis ili razlog dodjele bodova za aktivnost.' };
  }
  return { valid: true };
}

export function validatePasswordChangeInput(params: {
  requireCurrentPassword: boolean;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): ScoreValidationResult {
  const { requireCurrentPassword, currentPassword, newPassword, confirmPassword } = params;

  if (requireCurrentPassword && currentPassword.length === 0) {
    return { valid: false, error: 'Unesite trenutnu šifru radi sigurnosne potvrde identiteta.' };
  }
  if (newPassword.length < VALIDATION_CONSTRAINTS.PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      error: `Nova šifra mora sadržavati najmanje ${VALIDATION_CONSTRAINTS.PASSWORD_MIN_LENGTH} karaktera.`,
    };
  }
  if (newPassword.length > VALIDATION_CONSTRAINTS.PASSWORD_MAX_LENGTH) {
    return {
      valid: false,
      error: `Nova šifra ne može imati više od ${VALIDATION_CONSTRAINTS.PASSWORD_MAX_LENGTH} karaktera.`,
    };
  }
  if (requireCurrentPassword && newPassword === currentPassword) {
    return {
      valid: false,
      error: 'Nova šifra mora biti različita od trenutne šifre.',
    };
  }
  if (confirmPassword.length === 0) {
    return { valid: false, error: 'Potvrdite novu šifru u drugom polju.' };
  }
  if (newPassword !== confirmPassword) {
    return { valid: false, error: 'Polja za novu šifru i potvrdu šifre se ne podudaraju.' };
  }
  return { valid: true };
}

