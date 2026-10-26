import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  Check,
  Edit3,
  ListChecks,
  Plus,
  RotateCcw,
  Save,
  Search,
  Table2,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { getTodayIsoLocal, isCourseActivityEnabled } from '../../lib/calculations';
import { cn, formatBosnianDate, formatPoints } from '../../lib/utils';
import { validateActivityAwardInput, validateScoreInput } from '../../lib/validation';
import {
  createActivityAward,
  createGradingItem,
  deleteActivityAward,
  deleteGradingItem,
  saveStudentScore,
  updateActivityAward,
  updateGradingItem,
} from '../../services/zamioService';
import {
  ActivityAward,
  Course,
  Enrollment,
  GradingCategory,
  GradingItem,
  Score,
} from '../../types/zamio';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Label, Textarea } from '../ui/input';

interface GradebookViewProps {
  course: Course;
  professorUid: string;
  enrollments: Enrollment[];
  categories: GradingCategory[];
  items: GradingItem[];
  scores: Score[];
  activityAwards?: ActivityAward[];
}

export function GradebookView({
  course,
  professorUid,
  enrollments,
  categories,
  items,
  scores,
  activityAwards = [],
}: GradebookViewProps) {
  // Memoize sorted arrays so reference identity stays stable across re-renders
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'bs')),
    [categories]
  );

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.order - b.order || a.date.localeCompare(b.date)),
    [items]
  );

  const sortedStudents = useMemo(
    () => [...enrollments].sort((a, b) => a.studentName.localeCompare(b.studentName, 'bs')),
    [enrollments]
  );

  const activityEnabled = isCourseActivityEnabled(course, activityAwards.length);

  // Top-level section switch: Assessments Gradebook vs Activity Marks (+)
  const [activeSection, setActiveSection] = useState<'items' | 'activity'>('items');

  useEffect(() => {
    if (!activityEnabled && activeSection === 'activity') {
      setActiveSection('items');
    }
  }, [activityEnabled, activeSection]);

  // Entry mode inside Assessments Gradebook: Single-student sequential entry vs Tabular sheet
  const [entryMode, setEntryMode] = useState<'single' | 'table'>('table');

  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const prevActiveItemIdRef = useRef<string | null>(null);

  const [draftScores, setDraftScores] = useState<
    Record<string, { pointsStr: string; feedback: string; dirty: boolean }>
  >({});
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  // Single-student entry form state (retains course & item across saves; clears/advances student score cleanly)
  const [singleStudentId, setSingleStudentId] = useState<string>('');
  const [singlePointsStr, setSinglePointsStr] = useState<string>('');
  const [singleFeedback, setSingleFeedback] = useState<string>('');
  const [singleError, setSingleError] = useState<string | null>(null);
  const [singleSaving, setSingleSaving] = useState(false);
  const [autoAdvanceNextStudent, setAutoAdvanceNextStudent] = useState<boolean>(true);
  const singlePointsInputRef = useRef<HTMLInputElement | null>(null);

  // Item Create / Edit Modal
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GradingItem | null>(null);
  const [itemCategoryId, setItemCategoryId] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemMaxPoints, setItemMaxPoints] = useState('10');
  const [itemDate, setItemDate] = useState(getTodayIsoLocal());
  const [itemDescription, setItemDescription] = useState('');
  const [itemSaving, setItemSaving] = useState(false);

  // Delete Item Confirmation
  const [deleteTarget, setDeleteTarget] = useState<GradingItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // =========================================================================
  // Activity Marks (+) & Optional Points State
  // =========================================================================
  const [actRosterSearch, setActRosterSearch] = useState<string>('');
  const [actPointsStr, setActPointsStr] = useState<string>('');
  const [actDate, setActDate] = useState<string>(getTodayIsoLocal());
  const [actDescription, setActDescription] = useState<string>('');
  const [actFormError, setActFormError] = useState<string | null>(null);
  const [addingPlusStudentId, setAddingPlusStudentId] = useState<string | null>(null);
  const [undoingStudentId, setUndoingStudentId] = useState<string | null>(null);
  const [actFilterStudentId, setActFilterStudentId] = useState<string>('all');

  // Edit / Delete Activity Award Modals
  const [editingAward, setEditingAward] = useState<ActivityAward | null>(null);
  const [editAwardPoints, setEditAwardPoints] = useState('');
  const [editAwardMax, setEditAwardMax] = useState('');
  const [editAwardDate, setEditAwardDate] = useState('');
  const [editAwardDesc, setEditAwardDesc] = useState('');
  const [editAwardSaving, setEditAwardSaving] = useState(false);
  const [deletingAwardTarget, setDeletingAwardTarget] = useState<ActivityAward | null>(null);
  const [deletingAwardBusy, setDeletingAwardBusy] = useState(false);

  // Keep selectedItemId valid without resetting when scores update
  useEffect(() => {
    if (sortedItems.length === 0) {
      setSelectedItemId('');
      return;
    }
    setSelectedItemId((prev) => {
      if (prev && sortedItems.some((i) => i.id === prev)) return prev;
      return sortedItems[0].id;
    });
  }, [sortedItems]);

  // Keep singleStudentId valid when course roster loads/changes
  useEffect(() => {
    if (sortedStudents.length === 0) {
      setSingleStudentId('');
      return;
    }
    setSingleStudentId((prev) =>
      prev && sortedStudents.some((s) => s.studentId === prev)
        ? prev
        : sortedStudents[0].studentId
    );
  }, [sortedStudents]);

  const activeItem = useMemo(
    () => sortedItems.find((i) => i.id === selectedItemId) || null,
    [sortedItems, selectedItemId]
  );

  // Sync tabular draftScores WITHOUT wiping unsaved dirty rows when Firestore emits a snapshot
  useEffect(() => {
    if (!activeItem) {
      prevActiveItemIdRef.current = null;
      setDraftScores({});
      return;
    }

    const itemSwitched = prevActiveItemIdRef.current !== activeItem.id;
    prevActiveItemIdRef.current = activeItem.id;

    setDraftScores((prev) => {
      const next: Record<string, { pointsStr: string; feedback: string; dirty: boolean }> = {};
      for (const enr of sortedStudents) {
        const prevRow = prev[enr.studentId];
        // CRITICAL FIX: Preserve unsaved edits on other rows when one score is saved to Firestore
        if (!itemSwitched && prevRow?.dirty) {
          next[enr.studentId] = prevRow;
          continue;
        }
        const existing = scores.find(
          (s) => s.itemId === activeItem.id && s.studentId === enr.studentId
        );
        next[enr.studentId] = {
          pointsStr: existing !== undefined ? String(existing.points) : '',
          feedback: existing?.feedback || '',
          dirty: false,
        };
      }
      return next;
    });
  }, [activeItem?.id, scores, sortedStudents]);

  // Helper to load existing score into single-student form when switching student or item explicitly
  const syncSingleStudentInputs = (targetStuId: string, itemId: string | undefined) => {
    setSingleError(null);
    if (!targetStuId || !itemId) {
      setSinglePointsStr('');
      setSingleFeedback('');
      return;
    }
    const existing = scores.find((s) => s.itemId === itemId && s.studentId === targetStuId);
    setSinglePointsStr(existing !== undefined ? String(existing.points) : '');
    setSingleFeedback(existing?.feedback || '');
  };

  // Sync single-entry inputs ONLY when switching grading item (never overwrite while typing or on failed save)
  useEffect(() => {
    if (!activeItem || !singleStudentId) return;
    syncSingleStudentInputs(singleStudentId, activeItem.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem?.id]);

  const openNewItemModal = () => {
    if (sortedCategories.length === 0) {
      toast.error('Najprije dodajte barem jednu kategoriju u Postavkama predmeta.');
      return;
    }
    setEditingItem(null);
    setItemCategoryId(sortedCategories[0].id);
    setItemName('');
    setItemMaxPoints('10');
    setItemDate(getTodayIsoLocal());
    setItemDescription('');
    setItemDialogOpen(true);
  };

  const openEditItemModal = (item: GradingItem) => {
    setEditingItem(item);
    setItemCategoryId(item.categoryId);
    setItemName(item.name);
    setItemMaxPoints(String(item.maxPoints));
    setItemDate(item.date);
    setItemDescription(item.description);
    setItemDialogOpen(true);
  };

  const handleSaveItemForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (itemSaving) return;
    setItemSaving(true);
    try {
      const maxNum = Number(itemMaxPoints);
      if (editingItem) {
        await updateGradingItem(editingItem.id, course.professorIds, {
          categoryId: itemCategoryId,
          name: itemName,
          maxPoints: maxNum,
          date: itemDate,
          description: itemDescription,
          order: editingItem.order,
        });
        toast.success('Stavka ocjenjivanja je ažurirana.');
      } else {
        const newId = await createGradingItem({
          course,
          categoryId: itemCategoryId,
          name: itemName,
          maxPoints: maxNum,
          date: itemDate,
          description: itemDescription,
          order: items.length + 1,
        });
        setSelectedItemId(newId);
        toast.success('Nova stavka ocjenjivanja je kreirana.');
      }
      setItemDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju stavke.');
    } finally {
      setItemSaving(false);
    }
  };

  const handleConfirmDeleteItem = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const itemScores = scores.filter((s) => s.itemId === deleteTarget.id);
      await deleteGradingItem({
        course,
        itemId: deleteTarget.id,
        itemScores,
      });
      setDeleteTarget(null);
      toast.success('Stavka ocjenjivanja i pripadajući bodovi su obrisani.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri brisanju stavke.');
    } finally {
      setDeleting(false);
    }
  };

  // Single-student sequential form submission
  const handleSaveSingleForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem || !singleStudentId || singleSaving) return;
    setSingleError(null);

    if (singlePointsStr.trim() === '') {
      const msg = 'Unesite broj osvojenih bodova prije čuvanja.';
      setSingleError(msg);
      toast.error(msg);
      return;
    }

    const pts = Number(singlePointsStr);
    const check = validateScoreInput(pts, activeItem.maxPoints, course.allowBonusPoints);
    if (!check.valid) {
      const msg = check.error || 'Neispravan unos bodova.';
      setSingleError(msg);
      toast.error(msg);
      return;
    }

    const targetStu = sortedStudents.find((s) => s.studentId === singleStudentId);
    setSingleSaving(true);
    try {
      const existingScore = scores.find(
        (s) => s.itemId === activeItem.id && s.studentId === singleStudentId
      );
      await saveStudentScore({
        course,
        item: activeItem,
        studentId: singleStudentId,
        points: pts,
        feedback: singleFeedback,
        professorUid,
        existingScore,
      });

      // Keep course & activeItem selected; advance to next ungraded student (or next student) and clear score inputs
      if (autoAdvanceNextStudent && sortedStudents.length > 1) {
        const currentIndex = sortedStudents.findIndex((s) => s.studentId === singleStudentId);
        const orderedCandidates = [
          ...sortedStudents.slice(currentIndex + 1),
          ...sortedStudents.slice(0, currentIndex),
        ];
        const nextUngraded = orderedCandidates.find(
          (cand) =>
            !scores.some((sc) => sc.itemId === activeItem.id && sc.studentId === cand.studentId)
        );
        const nextStu = nextUngraded || orderedCandidates[0];
        if (nextStu) {
          setSingleStudentId(nextStu.studentId);
          const nextExisting = scores.find(
            (sc) => sc.itemId === activeItem.id && sc.studentId === nextStu.studentId
          );
          setSinglePointsStr(nextExisting !== undefined ? String(nextExisting.points) : '');
          setSingleFeedback(nextExisting?.feedback || '');
        }
      } else {
        // Clear score & feedback ready for next manual selection while retaining course & item
        setSinglePointsStr('');
        setSingleFeedback('');
      }

      toast.success(
        `Upisano ${formatPoints(pts)} b za studenta ${targetStu?.studentName || ''}.`
      );
      setTimeout(() => singlePointsInputRef.current?.focus(), 60);
    } catch (err) {
      // Preserve entered values on failure and show clear error
      const msg = err instanceof Error ? err.message : 'Greška pri upisu bodova.';
      setSingleError(msg);
      toast.error(msg);
    } finally {
      setSingleSaving(false);
    }
  };

  const handleSaveSingleRow = async (studentId: string) => {
    if (!activeItem || savingStudentId === studentId || savingAll) return;
    const draft = draftScores[studentId];
    if (!draft || draft.pointsStr.trim() === '') {
      toast.error('Unesite broj osvojenih bodova prije čuvanja.');
      return;
    }

    const pts = Number(draft.pointsStr);
    const check = validateScoreInput(pts, activeItem.maxPoints, course.allowBonusPoints);
    if (!check.valid) {
      toast.error(check.error || 'Neispravan unos bodova.');
      return;
    }

    const stuName = sortedStudents.find((s) => s.studentId === studentId)?.studentName || '';
    setSavingStudentId(studentId);
    try {
      const existingScore = scores.find(
        (s) => s.itemId === activeItem.id && s.studentId === studentId
      );
      await saveStudentScore({
        course,
        item: activeItem,
        studentId,
        points: pts,
        feedback: draft.feedback,
        professorUid,
        existingScore,
      });
      setDraftScores((prev) => ({
        ...prev,
        [studentId]: { ...prev[studentId], dirty: false },
      }));
      toast.success(
        stuName ? `Sačuvani bodovi (${formatPoints(pts)} b) — ${stuName}.` : 'Bodovi su sačuvani.'
      );
    } catch (err) {
      // Entered values remain untouched in draftScores[studentId]
      toast.error(err instanceof Error ? err.message : 'Greška pri upisu bodova.');
    } finally {
      setSavingStudentId(null);
    }
  };

  const handleSaveAllDirty = async () => {
    if (!activeItem || savingAll) return;
    const dirtyEntries = Object.entries(draftScores).filter(
      ([, v]) => v.dirty && v.pointsStr.trim() !== ''
    );
    if (dirtyEntries.length === 0) {
      toast.info('Nema neizmijenjenih unosa za čuvanje.');
      return;
    }

    for (const [stuId, v] of dirtyEntries) {
      const pts = Number(v.pointsStr);
      const check = validateScoreInput(pts, activeItem.maxPoints, course.allowBonusPoints);
      if (!check.valid) {
        const stuName =
          sortedStudents.find((s) => s.studentId === stuId)?.studentName || stuId;
        toast.error(`${stuName}: ${check.error}`);
        return;
      }
    }

    setSavingAll(true);
    try {
      await Promise.all(
        dirtyEntries.map(([studentId, v]) => {
          const existingScore = scores.find(
            (s) => s.itemId === activeItem.id && s.studentId === studentId
          );
          return saveStudentScore({
            course,
            item: activeItem,
            studentId,
            points: Number(v.pointsStr),
            feedback: v.feedback,
            professorUid,
            existingScore,
          });
        })
      );
      setDraftScores((prev) => {
        const updated = { ...prev };
        for (const [studentId] of dirtyEntries) {
          if (updated[studentId]) {
            updated[studentId] = { ...updated[studentId], dirty: false };
          }
        }
        return updated;
      });
      toast.success(`Sačuvani bodovi za ${dirtyEntries.length} studenata.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri grupnom čuvanju bodova.');
    } finally {
      setSavingAll(false);
    }
  };

  // =========================================================================
  // Activity Marks (+) & Optional Points Handlers
  // =========================================================================
  const sortedActivityAwards = useMemo(
    () =>
      [...activityAwards].sort(
        (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
      ),
    [activityAwards]
  );

  const awardsByStudentMap = useMemo(() => {
    const map: Record<string, ActivityAward[]> = {};
    for (const aw of sortedActivityAwards) {
      if (!map[aw.studentId]) map[aw.studentId] = [];
      map[aw.studentId].push(aw);
    }
    return map;
  }, [sortedActivityAwards]);

  const filteredActivityRoster = useMemo(() => {
    const q = actRosterSearch.trim().toLowerCase();
    if (!q) return sortedStudents;
    return sortedStudents.filter(
      (s) =>
        s.studentName.toLowerCase().includes(q) ||
        s.studentIndex.toLowerCase().includes(q) ||
        s.studentDepartment.toLowerCase().includes(q)
    );
  }, [sortedStudents, actRosterSearch]);

  const visibleActivityAwards = useMemo(() => {
    if (actFilterStudentId === 'all') return sortedActivityAwards;
    return sortedActivityAwards.filter((a) => a.studentId === actFilterStudentId);
  }, [sortedActivityAwards, actFilterStudentId]);

  const studentByIdMap = useMemo(() => {
    const map: Record<string, Enrollment> = {};
    for (const enr of sortedStudents) {
      map[enr.studentId] = enr;
    }
    return map;
  }, [sortedStudents]);

  const handleQuickAddPlus = async (studentId: string) => {
    if (addingPlusStudentId === studentId) return;
    setActFormError(null);

    const trimmedPts = actPointsStr.trim();
    const pts = trimmedPts === '' ? 0 : Number(trimmedPts);
    const effectiveDesc = actDescription.trim() || 'Urađena vježba (+)';

    const validation = validateActivityAwardInput({
      points: pts,
      maxPoints: 0,
      date: actDate,
      description: effectiveDesc,
      allowBonusPoints: course.allowBonusPoints,
    });
    if (!validation.valid) {
      const msg = validation.error || 'Provjerite podatke za evidenciju aktivnosti.';
      setActFormError(msg);
      toast.error(msg);
      return;
    }

    const stu = studentByIdMap[studentId];
    setAddingPlusStudentId(studentId);
    try {
      await createActivityAward({
        course,
        studentId,
        points: pts,
        maxPoints: 0,
        date: actDate,
        description: effectiveDesc,
        professorUid,
      });
      toast.success(
        pts > 0
          ? `Evidentiran + (${formatPoints(pts)} b) — ${stu?.studentName || 'student'}.`
          : `Evidentiran plus (+) za aktivnost — ${stu?.studentName || 'student'}.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Greška pri evidenciji plusa (+).';
      setActFormError(msg);
      toast.error(msg);
    } finally {
      setAddingPlusStudentId(null);
    }
  };

  const handleQuickUndoLatestPlus = async (studentId: string) => {
    const latest = awardsByStudentMap[studentId]?.[0];
    if (!latest || undoingStudentId === studentId) return;
    const stu = studentByIdMap[studentId];
    setUndoingStudentId(studentId);
    try {
      await deleteActivityAward(latest.id);
      toast.info(`Poništen zadnji plus (+) — ${stu?.studentName || 'student'}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri poništavanju plusa.');
    } finally {
      setUndoingStudentId(null);
    }
  };

  const openEditAwardModal = (award: ActivityAward) => {
    setEditingAward(award);
    setEditAwardPoints(award.points > 0 ? String(award.points) : '');
    setEditAwardMax(award.maxPoints > 0 ? String(award.maxPoints) : '');
    setEditAwardDate(award.date);
    setEditAwardDesc(award.description);
  };

  const handleSaveEditAward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAward || editAwardSaving) return;
    const pts = editAwardPoints.trim() === '' ? 0 : Number(editAwardPoints);
    const maxPts = editAwardMax.trim() === '' ? 0 : Number(editAwardMax);
    const effectiveDesc = editAwardDesc.trim() || 'Urađena vježba (+)';

    setEditAwardSaving(true);
    try {
      await updateActivityAward({
        awardId: editingAward.id,
        course,
        points: pts,
        maxPoints: maxPts,
        date: editAwardDate,
        description: effectiveDesc,
        professorUid,
      });
      setEditingAward(null);
      toast.success('Zapis o aktivnosti je ažuriran.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri izmjeni zapisa aktivnosti.');
    } finally {
      setEditAwardSaving(false);
    }
  };

  const handleConfirmDeleteAward = async () => {
    if (!deletingAwardTarget || deletingAwardBusy) return;
    setDeletingAwardBusy(true);
    try {
      await deleteActivityAward(deletingAwardTarget.id);
      setDeletingAwardTarget(null);
      toast.success('Zapis o aktivnosti je uklonjen.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri brisanju zapisa.');
    } finally {
      setDeletingAwardBusy(false);
    }
  };

  const dirtyCount = Object.values(draftScores).filter(
    (d) => d.dirty && d.pointsStr.trim() !== ''
  ).length;

  const gradedCountForActiveItem = activeItem
    ? scores.filter((s) => s.itemId === activeItem.id).length
    : 0;

  const parsedQuickPoints =
    actPointsStr.trim() !== '' && Number.isFinite(Number(actPointsStr)) && Number(actPointsStr) > 0
      ? Number(actPointsStr)
      : 0;

  return (
    <div className="space-y-5">
      {/* Top Toolbar: Switch between Grading Items & Activity Marks (+) when enabled on course */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {activityEnabled ? (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
              <button
                type="button"
                onClick={() => setActiveSection('items')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 tabular-nums',
                  activeSection === 'items'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <ListChecks className="w-3.5 h-3.5" />
                Provjere, zadaci i ispiti ({sortedItems.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('activity')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 tabular-nums',
                  activeSection === 'activity'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <Award className="w-3.5 h-3.5" />
                Tačke / Aktivnost (+) ({sortedActivityAwards.length})
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ListChecks className="w-4 h-4 text-blue-700 shrink-0" />
              <span>Provjere, zadaci i ispiti ({sortedItems.length})</span>
            </div>
          )}

          <p className="text-xs text-slate-500">
            {activeSection === 'activity' && activityEnabled
              ? 'Svi studenti sa predmeta su izlistani ispod — jednim klikom dodajte plus (+) za urađenu vježbu (unos bodova nije obavezan).'
              : 'Kontekst predmeta i izabrane stavke ostaje sačuvan između unosa.'}
          </p>
        </div>

        {activeSection === 'items' && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setEntryMode('table')}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5',
                  entryMode === 'table'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <Table2 className="w-3.5 h-3.5" />
                Tabelarni unos
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryMode('single');
                  if (activeItem && singleStudentId) {
                    syncSingleStudentInputs(singleStudentId, activeItem.id);
                  }
                }}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5',
                  entryMode === 'single'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <UserCheck className="w-3.5 h-3.5" />
                Pojedinačni unos
              </button>
            </div>

            <Button onClick={openNewItemModal} size="sm">
              <Plus className="w-4 h-4" />
              Nova stavka
            </Button>
          </div>
        )}
      </div>

      {/* =====================================================================
          SECTION A: TAČKE / AKTIVNOST (+) — Full Roster 1-Click (+) Entry
         ===================================================================== */}
      {activeSection === 'activity' && activityEnabled ? (
        <div className="space-y-5">
          {/* Card 1: Full Enrolled Student Roster for 1-Click (+) Marking */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Evidencija aktivnosti i urađenih vježbi (+)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Kliknite „+ Dodaj plus“ pored studenta koji je uradio vježbu. Polje za bodove
                    ostavite prazno za čistu evidenciju tačke (+).
                  </p>
                </div>
                <div className="font-mono text-xs text-slate-600 tabular-nums shrink-0">
                  Studenti: <strong className="text-slate-900">{sortedStudents.length}</strong> ·
                  Ukupno pluseva:{' '}
                  <strong className="text-emerald-700">{sortedActivityAwards.length}</strong>
                </div>
              </div>

              {actFormError && (
                <div className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-800 font-medium">
                  {actFormError}
                </div>
              )}

              {/* Context Bar for 1-Click (+) Entry (Retained across clicks) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 pt-1">
                <div className="lg:col-span-3">
                  <Label htmlFor="act-roster-q" className="text-[11px]">
                    Pretraga studenta
                  </Label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input
                      id="act-roster-q"
                      value={actRosterSearch}
                      onChange={(e) => setActRosterSearch(e.target.value)}
                      placeholder="Ime ili broj indeksa..."
                      className="pl-8 h-9 text-xs"
                    />
                  </div>
                </div>

                <div className="lg:col-span-4">
                  <Label htmlFor="act-desc" className="text-[11px]">
                    Opis vježbe / napomena uz plus (opciono)
                  </Label>
                  <Input
                    id="act-desc"
                    value={actDescription}
                    onChange={(e) => {
                      setActDescription(e.target.value);
                      if (actFormError) setActFormError(null);
                    }}
                    placeholder="Urađena vježba (+)"
                    maxLength={300}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="lg:col-span-2">
                  <Label htmlFor="act-date" className="text-[11px]">
                    Datum evidencije
                  </Label>
                  <Input
                    id="act-date"
                    type="date"
                    value={actDate}
                    onChange={(e) => setActDate(e.target.value)}
                    className="h-9 font-mono text-xs tabular-nums"
                  />
                </div>

                <div className="lg:col-span-3">
                  <Label htmlFor="act-pts" className="text-[11px]">
                    Bodovi uz plus (opciono)
                  </Label>
                  <Input
                    id="act-pts"
                    type="number"
                    step="0.25"
                    min="0"
                    max="100"
                    value={actPointsStr}
                    onChange={(e) => {
                      setActPointsStr(e.target.value);
                      if (actFormError) setActFormError(null);
                    }}
                    placeholder="Bez bodova (samo +)"
                    className="h-9 font-mono text-xs tabular-nums"
                  />
                </div>
              </div>
            </div>

            {sortedStudents.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Nema upisanih studenata na predmetu {course.name}.
              </div>
            ) : filteredActivityRoster.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Nijedan student ne odgovara pretrazi „{actRosterSearch}“.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="text-left py-2.5 px-4">Student</th>
                      <th className="text-left py-2.5 px-4 whitespace-nowrap">Broj indeksa</th>
                      <th className="text-left py-2.5 px-4">Evidentirani plusevi (+)</th>
                      <th className="text-left py-2.5 px-4">Zadnja evidencija</th>
                      <th className="text-right py-2.5 px-4 whitespace-nowrap">Brza akcija</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredActivityRoster.map((stu) => {
                      const stuAwards = awardsByStudentMap[stu.studentId] || [];
                      const plusCount = stuAwards.length;
                      const ptsSum = stuAwards.reduce((acc, a) => acc + a.points, 0);
                      const latestAward = stuAwards[0] || null;
                      const isAdding = addingPlusStudentId === stu.studentId;
                      const isUndoing = undoingStudentId === stu.studentId;

                      return (
                        <tr key={stu.studentId} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-slate-900">{stu.studentName}</div>
                            <div className="text-xs text-slate-500">{stu.studentDepartment}</div>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-700 whitespace-nowrap tabular-nums">
                            {stu.studentIndex}
                          </td>
                          <td className="py-2.5 px-4">
                            {plusCount === 0 ? (
                              <span className="text-xs text-slate-400">Bez pluseva</span>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                                <span className="text-sm font-bold text-emerald-700 tracking-wider">
                                  {Array.from({ length: Math.min(plusCount, 10) })
                                    .map(() => '+')
                                    .join(' ')}
                                  {plusCount > 10 ? ` …` : ''}
                                </span>
                                <span className="text-xs font-semibold text-slate-700">
                                  ({plusCount} × +
                                  {ptsSum > 0 ? ` · +${formatPoints(ptsSum)} b` : ''})
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-600">
                            {latestAward ? (
                              <button
                                type="button"
                                onClick={() => setActFilterStudentId(stu.studentId)}
                                className="text-left hover:text-blue-700 transition-colors cursor-pointer"
                              >
                                <div className="truncate max-w-xs font-medium text-slate-800">
                                  {latestAward.description}
                                </div>
                                <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                                  {formatBosnianDate(latestAward.date)}
                                  {latestAward.points > 0
                                    ? ` · +${formatPoints(latestAward.points)} b`
                                    : ''}
                                </div>
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {plusCount > 0 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={isAdding || isUndoing}
                                  onClick={() => void handleQuickUndoLatestPlus(stu.studentId)}
                                  className="h-8 px-2 text-xs text-slate-500 hover:text-red-700 hover:bg-red-50"
                                  title="Poništi zadnji dodijeljeni plus (+)"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline">Poništi</span>
                                </Button>
                              )}
                              <Button
                                type="button"
                                size="sm"
                                disabled={isAdding || isUndoing}
                                onClick={() => void handleQuickAddPlus(stu.studentId)}
                                className="h-8 px-3 font-medium"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                {isAdding
                                  ? 'Upis...'
                                  : parsedQuickPoints > 0
                                    ? `Dodaj + (${formatPoints(parsedQuickPoints)} b)`
                                    : 'Dodaj plus'}
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

          {/* Card 2: Chronological Log of Recorded (+) Marks & Activity Awards */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Hronološki dnevnik evidentiranih pluseva ({visibleActivityAwards.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pregled, izmjena i brisanje pojedinačnih zapisa o urađenim vježbama i aktivnosti
                </p>
              </div>

              {sortedStudents.length > 0 && (
                <div className="flex items-center gap-2">
                  {actFilterStudentId !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setActFilterStudentId('all')}
                      className="text-xs text-blue-700 hover:underline cursor-pointer whitespace-nowrap"
                    >
                      Prikaži sve
                    </button>
                  )}
                  <select
                    value={actFilterStudentId}
                    onChange={(e) => setActFilterStudentId(e.target.value)}
                    className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-800"
                  >
                    <option value="all">Svi studenti ({sortedActivityAwards.length})</option>
                    {sortedStudents.map((stu) => (
                      <option key={stu.studentId} value={stu.studentId}>
                        {stu.studentName} ({stu.studentIndex})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {visibleActivityAwards.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Još nema evidentiranih pluseva za aktivnost za izabrani filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="text-left py-2.5 px-4">Student</th>
                      <th className="text-left py-2.5 px-4">Opis vježbe / aktivnosti</th>
                      <th className="text-left py-2.5 px-4 whitespace-nowrap">Datum</th>
                      <th className="text-right py-2.5 px-4 whitespace-nowrap">Evidencija</th>
                      <th className="text-right py-2.5 px-4">Akcija</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleActivityAwards.map((aw) => {
                      const stu = studentByIdMap[aw.studentId];
                      return (
                        <tr key={aw.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-slate-900">
                              {stu?.studentName || aw.studentId}
                            </div>
                            {stu?.studentIndex && (
                              <div className="text-xs font-mono text-slate-500 tabular-nums">
                                {stu.studentIndex}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-700">
                            {aw.description}
                          </td>
                          <td className="py-2.5 px-4 text-xs font-mono text-slate-600 whitespace-nowrap tabular-nums">
                            {formatBosnianDate(aw.date)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-700 whitespace-nowrap tabular-nums">
                            {aw.points > 0
                              ? `+ (${formatPoints(aw.points)}${
                                  aw.maxPoints > 0 ? ` / ${formatPoints(aw.maxPoints)}` : ''
                                } b)`
                              : '+ (tačka)'}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditAwardModal(aw)}
                                className="h-7 w-7 text-slate-500 hover:text-slate-900"
                                aria-label="Uredi zapis aktivnosti"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeletingAwardTarget(aw)}
                                className="h-7 w-7 text-slate-400 hover:text-red-700 hover:bg-red-50"
                                aria-label="Obriši zapis aktivnosti"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-600 mb-4">
            Još nema kreiranih zadataka, vježbi ili ispita za predmet {course.name}.
          </p>
          <Button onClick={openNewItemModal} size="sm">
            <Plus className="w-4 h-4" />
            Kreiraj prvu stavku
          </Button>
        </div>
      ) : (
        /* =====================================================================
           SECTION B: ASSESSMENT ITEMS & SCORE ENTRY (Single or Tabular)
           ===================================================================== */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left 4 Cols: Grading Items List grouped by Category */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              Stavke na predmetu ({sortedItems.length})
            </div>
            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {sortedCategories.map((cat) => {
                const catItems = sortedItems.filter((i) => i.categoryId === cat.id);
                if (catItems.length === 0) return null;
                return (
                  <div key={cat.id} className="p-2.5 space-y-1">
                    <div className="px-2 py-1 text-[11px] font-semibold text-slate-500 flex items-center justify-between">
                      <span>{cat.name}</span>
                      <span className="font-mono tabular-nums">{cat.maxPoints} b</span>
                    </div>
                    {catItems.map((it) => {
                      const isSel = it.id === selectedItemId;
                      const itemScoredCount = scores.filter((s) => s.itemId === it.id).length;
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => setSelectedItemId(it.id)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer flex items-center justify-between gap-2',
                            isSel
                              ? 'bg-blue-50 text-blue-900 font-semibold'
                              : 'text-slate-700 hover:bg-slate-50'
                          )}
                        >
                          <div className="min-w-0">
                            <div className="truncate">{it.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                              {formatBosnianDate(it.date)} · {itemScoredCount}/
                              {sortedStudents.length} ocijenjeno
                            </div>
                          </div>
                          <span className="font-mono text-xs shrink-0 tabular-nums">
                            {formatPoints(it.maxPoints)} b
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right 8 Cols: Active Item Header + Single Entry Form OR Tabular Sheet */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {activeItem && (
              <>
                <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-blue-700">
                        {sortedCategories.find((c) => c.id === activeItem.categoryId)?.name ||
                          'Kategorija'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatBosnianDate(activeItem.date)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-slate-800 tabular-nums">
                        Maks. {formatPoints(activeItem.maxPoints)} bodova
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Ocijenjeno {gradedCountForActiveItem}/{sortedStudents.length}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                      {activeItem.name}
                    </h3>
                    {activeItem.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{activeItem.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditItemModal(activeItem)}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Uredi
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteTarget(activeItem)}
                      className="text-red-700 border-red-200 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Obriši
                    </Button>
                    {entryMode === 'table' && dirtyCount > 0 && (
                      <Button size="sm" onClick={handleSaveAllDirty} disabled={savingAll}>
                        <Save className="w-3.5 h-3.5" />
                        {savingAll ? 'Čuvanje...' : `Sačuvaj sve (${dirtyCount})`}
                      </Button>
                    )}
                  </div>
                </div>

                {sortedStudents.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Nema upisanih studenata na ovom predmetu.
                  </div>
                ) : entryMode === 'single' ? (
                  /* POJEDINAČNI UNOS: Retains course & activeItem; advances or clears score cleanly */
                  <div className="divide-y divide-slate-200">
                    <form onSubmit={handleSaveSingleForm} className="p-5 space-y-4">
                      {singleError && (
                        <div className="rounded-lg border border-red-200 bg-red-50/70 px-3.5 py-2.5 text-xs text-red-800 font-medium">
                          {singleError}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                        <div className="sm:col-span-7">
                          <Label htmlFor="single-stu">Student na predmetu {course.code}</Label>
                          <select
                            id="single-stu"
                            value={singleStudentId}
                            onChange={(e) => {
                              const nextId = e.target.value;
                              setSingleStudentId(nextId);
                              syncSingleStudentInputs(nextId, activeItem.id);
                            }}
                            className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                          >
                            {sortedStudents.map((stu) => {
                              const ex = scores.find(
                                (s) => s.itemId === activeItem.id && s.studentId === stu.studentId
                              );
                              return (
                                <option key={stu.studentId} value={stu.studentId}>
                                  {stu.studentName} ({stu.studentIndex})
                                  {ex !== undefined ? ` — upisano ${formatPoints(ex.points)} b` : ''}
                                </option>
                              );
                            })}
                          </select>
                        </div>

                        <div className="sm:col-span-5">
                          <Label htmlFor="single-pts">
                            Osvojeni bodovi (maks. {formatPoints(activeItem.maxPoints)})
                          </Label>
                          <Input
                            ref={singlePointsInputRef}
                            id="single-pts"
                            type="number"
                            step="0.1"
                            min="0"
                            max={course.allowBonusPoints ? 200 : activeItem.maxPoints}
                            value={singlePointsStr}
                            onChange={(e) => {
                              setSinglePointsStr(e.target.value);
                              if (singleError) setSingleError(null);
                            }}
                            placeholder={`0 – ${activeItem.maxPoints}`}
                            className="font-mono tabular-nums"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="single-fb">Povratni komentar za studenta (opciono)</Label>
                        <Input
                          id="single-fb"
                          value={singleFeedback}
                          onChange={(e) => setSingleFeedback(e.target.value)}
                          placeholder="npr. Odlično riješen drugi zadatak..."
                          maxLength={500}
                        />
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoAdvanceNextStudent}
                            onChange={(e) => setAutoAdvanceNextStudent(e.target.checked)}
                          />
                          <span>
                            Nakon čuvanja zadrži stavku i pređi na sljedećeg neocijenjenog studenta
                          </span>
                        </label>

                        <Button type="submit" disabled={singleSaving} className="shrink-0">
                          <Save className="w-4 h-4" />
                          {singleSaving ? 'Čuvanje...' : 'Sačuvaj rezultat'}
                        </Button>
                      </div>
                    </form>

                    {/* Live Compact Roster Summary below Single-Entry Form */}
                    <div className="px-5 py-3 bg-slate-50/70 text-xs font-semibold text-slate-600">
                      Pregled unesenih rezultata za stavku „{activeItem.name}“
                    </div>
                    <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                      {sortedStudents.map((stu) => {
                        const ex = scores.find(
                          (s) => s.itemId === activeItem.id && s.studentId === stu.studentId
                        );
                        const isActiveRow = stu.studentId === singleStudentId;
                        return (
                          <button
                            key={stu.studentId}
                            type="button"
                            onClick={() => {
                              setSingleStudentId(stu.studentId);
                              syncSingleStudentInputs(stu.studentId, activeItem.id);
                            }}
                            className={cn(
                              'w-full px-5 py-2.5 text-left flex items-center justify-between gap-3 text-xs transition-colors cursor-pointer',
                              isActiveRow ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                            )}
                          >
                            <div className="min-w-0">
                              <span className="font-medium text-slate-900">{stu.studentName}</span>
                              <span className="text-slate-400 mx-1.5" aria-hidden="true">
                                ·
                              </span>
                              <span className="font-mono text-slate-500 tabular-nums">
                                {stu.studentIndex}
                              </span>
                            </div>
                            <span
                              className={cn(
                                'font-mono shrink-0 tabular-nums',
                                ex ? 'font-semibold text-emerald-700' : 'text-slate-400'
                              )}
                            >
                              {ex
                                ? `${formatPoints(ex.points)} / ${formatPoints(activeItem.maxPoints)} b`
                                : 'Nije ocijenjeno'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* TABELARNI UNOS: Preserves unsaved edits across rows when saving any row */
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="text-left py-2.5 px-4">Student</th>
                          <th className="text-left py-2.5 px-4 w-32 whitespace-nowrap">
                            Bodovi (/{activeItem.maxPoints})
                          </th>
                          <th className="text-left py-2.5 px-4">Povratni komentar (opciono)</th>
                          <th className="text-right py-2.5 px-4 w-28">Akcija</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sortedStudents.map((stu) => {
                          const rowDraft = draftScores[stu.studentId] || {
                            pointsStr: '',
                            feedback: '',
                            dirty: false,
                          };
                          const existing = scores.find(
                            (s) => s.itemId === activeItem.id && s.studentId === stu.studentId
                          );
                          const isRowSaving = savingStudentId === stu.studentId;

                          return (
                            <tr key={stu.studentId} className="hover:bg-slate-50/60">
                              <td className="py-2.5 px-4">
                                <div className="font-medium text-slate-900">{stu.studentName}</div>
                                <div className="text-xs font-mono text-slate-500 tabular-nums">
                                  {stu.studentIndex}
                                </div>
                              </td>
                              <td className="py-2.5 px-4">
                                <Input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  max={course.allowBonusPoints ? 200 : activeItem.maxPoints}
                                  value={rowDraft.pointsStr}
                                  disabled={isRowSaving || savingAll}
                                  onChange={(e) => {
                                    const nextVal = e.target.value;
                                    setDraftScores((prev) => ({
                                      ...prev,
                                      [stu.studentId]: {
                                        pointsStr: nextVal,
                                        feedback: prev[stu.studentId]?.feedback ?? rowDraft.feedback,
                                        dirty: true,
                                      },
                                    }));
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      void handleSaveSingleRow(stu.studentId);
                                    }
                                  }}
                                  placeholder="—"
                                  className="h-8 font-mono text-right w-24 tabular-nums"
                                />
                              </td>
                              <td className="py-2.5 px-4">
                                <Input
                                  value={rowDraft.feedback}
                                  disabled={isRowSaving || savingAll}
                                  onChange={(e) => {
                                    const nextFb = e.target.value;
                                    setDraftScores((prev) => ({
                                      ...prev,
                                      [stu.studentId]: {
                                        pointsStr:
                                          prev[stu.studentId]?.pointsStr ?? rowDraft.pointsStr,
                                        feedback: nextFb,
                                        dirty: true,
                                      },
                                    }));
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      void handleSaveSingleRow(stu.studentId);
                                    }
                                  }}
                                  placeholder="Kratka napomena studentu..."
                                  maxLength={500}
                                  className="h-8 text-xs"
                                />
                              </td>
                              <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                {rowDraft.dirty || isRowSaving ? (
                                  <Button
                                    size="sm"
                                    onClick={() => handleSaveSingleRow(stu.studentId)}
                                    disabled={isRowSaving || savingAll}
                                    className="h-8 px-2.5"
                                  >
                                    {isRowSaving ? 'Čuvanje...' : 'Sačuvaj'}
                                  </Button>
                                ) : existing ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium font-mono tabular-nums">
                                    <Check className="w-3.5 h-3.5" />
                                    {formatPoints(existing.points)} b
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">Bez unosa</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: Create / Edit Grading Item */}
      <Dialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        title={editingItem ? 'Uredi stavku ocjenjivanja' : 'Nova stavka ocjenjivanja'}
        description="Definišite naziv, kategoriju, maksimalne bodove i datum održavanja."
      >
        <form onSubmit={handleSaveItemForm} className="space-y-4">
          <div>
            <Label htmlFor="itm-cat">Kategorija ocjenjivanja</Label>
            <select
              id="itm-cat"
              value={itemCategoryId}
              onChange={(e) => setItemCategoryId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              required
            >
              {sortedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (maks. {c.maxPoints} b)
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="itm-name">Naziv stavke</Label>
            <Input
              id="itm-name"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="npr. Intel 386 MMU ili I parcijalni ispit"
              maxLength={120}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="itm-max">Maksimalno bodova</Label>
              <Input
                id="itm-max"
                type="number"
                step="0.5"
                min="0.5"
                max="100"
                value={itemMaxPoints}
                onChange={(e) => setItemMaxPoints(e.target.value)}
                className="font-mono tabular-nums"
                required
              />
            </div>
            <div>
              <Label htmlFor="itm-date">Datum</Label>
              <Input
                id="itm-date"
                type="date"
                value={itemDate}
                onChange={(e) => setItemDate(e.target.value)}
                className="font-mono tabular-nums"
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="itm-desc">Opis (opciono)</Label>
            <Textarea
              id="itm-desc"
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              placeholder="Kratak opis oblasti ili pravila bodovanja..."
              maxLength={500}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
              Odustani
            </Button>
            <Button type="submit" disabled={itemSaving}>
              {itemSaving ? 'Čuvanje...' : 'Sačuvaj stavku'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal: Confirm Delete Item */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Potvrda brisanja stavke"
        description={`Jeste li sigurni da želite obrisati stavku "${deleteTarget?.name}" i sve pripadajuće bodove studenata? Ova radnja je nepovratna.`}
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Odustani
          </Button>
          <Button variant="destructive" onClick={handleConfirmDeleteItem} disabled={deleting}>
            {deleting ? 'Brisanje...' : 'Obriši stavku'}
          </Button>
        </div>
      </Dialog>

      {/* Modal: Edit Activity Award */}
      <Dialog
        open={Boolean(editingAward)}
        onOpenChange={(o) => !o && setEditingAward(null)}
        title="Uredi zapis o aktivnosti (+)"
        description="Izmijenite opis vježbe, datum ili opcione bodove uz plus."
      >
        <form onSubmit={handleSaveEditAward} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="ed-act-pts">Bodovi (opciono)</Label>
              <Input
                id="ed-act-pts"
                type="number"
                step="0.25"
                min="0"
                max="100"
                value={editAwardPoints}
                onChange={(e) => setEditAwardPoints(e.target.value)}
                placeholder="Samo + (0)"
                className="font-mono tabular-nums"
              />
            </div>
            <div>
              <Label htmlFor="ed-act-max">Maks. (opciono)</Label>
              <Input
                id="ed-act-max"
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={editAwardMax}
                onChange={(e) => setEditAwardMax(e.target.value)}
                placeholder="0"
                className="font-mono tabular-nums"
              />
            </div>
            <div>
              <Label htmlFor="ed-act-date">Datum</Label>
              <Input
                id="ed-act-date"
                type="date"
                value={editAwardDate}
                onChange={(e) => setEditAwardDate(e.target.value)}
                className="font-mono tabular-nums"
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="ed-act-desc">Opis vježbe / napomena (opciono)</Label>
            <Input
              id="ed-act-desc"
              value={editAwardDesc}
              onChange={(e) => setEditAwardDesc(e.target.value)}
              placeholder="Urađena vježba (+)"
              maxLength={300}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditingAward(null)}>
              Odustani
            </Button>
            <Button type="submit" disabled={editAwardSaving}>
              {editAwardSaving ? 'Čuvanje...' : 'Sačuvaj izmjene'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal: Delete Activity Award */}
      <Dialog
        open={Boolean(deletingAwardTarget)}
        onOpenChange={(o) => !o && setDeletingAwardTarget(null)}
        title="Brisanje zapisa o aktivnosti"
        description={
          deletingAwardTarget
            ? deletingAwardTarget.points > 0
              ? `Želite li ukloniti zapis „${deletingAwardTarget.description}“ (+${formatPoints(deletingAwardTarget.points)} b)?`
              : `Želite li ukloniti evidentirani plus (+) „${deletingAwardTarget.description}“?`
            : ''
        }
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setDeletingAwardTarget(null)}>
            Odustani
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirmDeleteAward}
            disabled={deletingAwardBusy}
          >
            {deletingAwardBusy ? 'Brisanje...' : 'Ukloni zapis'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
