import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBosnianDate(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return isoDate || '—';
  }
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}.`;
}

export function formatPoints(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2).replace(/\.?0+$/, '');
}

export function getCourseProfessors(
  course?: { professorNames?: string[]; leadProfessorName?: string } | null,
  fallbackLeadName?: string
): string[] {
  if (course?.professorNames && course.professorNames.length > 0) {
    return course.professorNames;
  }
  if (course?.leadProfessorName) {
    return [course.leadProfessorName];
  }
  if (fallbackLeadName) {
    return [fallbackLeadName];
  }
  return [];
}

export function getCourseAssistants(
  course?: { assistantNames?: string[] } | null
): string[] {
  return course?.assistantNames?.filter(Boolean) ?? [];
}

export function formatCourseProfessors(
  course?: { professorNames?: string[]; leadProfessorName?: string } | null,
  fallbackLeadName?: string
): string {
  const list = getCourseProfessors(course, fallbackLeadName);
  return list.length > 0 ? list.join(', ') : '—';
}

export function formatCourseAssistants(
  course?: { assistantNames?: string[] } | null
): string {
  const list = getCourseAssistants(course);
  return list.length > 0 ? list.join(', ') : '';
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ];

  // Include UTF-8 BOM so Bosnian characters (č, ć, ž, š, đ) open cleanly in Excel
  const blob = new Blob([`\uFEFF${csvLines.join('\r\n')}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
