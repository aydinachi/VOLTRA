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
  SEMESTER_MAX_LENGTH: 60,
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
  INVITE_CODE_MIN_LENGTH: 6,
  INVITE_CODE_MAX_LENGTH: 64,
  MAX_PROFESSORS_PER_COURSE: 10,
  MAX_CATEGORIES_PER_COURSE: 20,
  MAX_ITEMS_PER_COURSE: 60,
  MAX_SESSIONS_PER_COURSE: 60,
} as const;

export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
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
