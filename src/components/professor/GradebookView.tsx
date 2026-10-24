import React, { useEffect, useState } from 'react';
import { Check, Edit3, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getTodayIsoLocal } from '../../lib/calculations';
import { cn, formatBosnianDate, formatPoints } from '../../lib/utils';
import { validateScoreInput } from '../../lib/validation';
import {
  createGradingItem,
  deleteGradingItem,
  saveStudentScore,
  updateGradingItem,
} from '../../services/zamioService';
import {
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
}

export function GradebookView({
  course,
  professorUid,
  enrollments,
  categories,
  items,
  scores,
}: GradebookViewProps) {
  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
  const sortedItems = [...items].sort(
    (a, b) => a.order - b.order || a.date.localeCompare(b.date)
  );
  const sortedStudents = [...enrollments].sort((a, b) =>
    a.studentName.localeCompare(b.studentName, 'bs')
  );

  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [draftScores, setDraftScores] = useState<
    Record<string, { pointsStr: string; feedback: string; dirty: boolean }>
  >({});
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);

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

  useEffect(() => {
    if (sortedItems.length === 0) {
      setSelectedItemId('');
      return;
    }
    if (!selectedItemId || !sortedItems.some((i) => i.id === selectedItemId)) {
      setSelectedItemId(sortedItems[0].id);
    }
  }, [sortedItems, selectedItemId]);

  const activeItem = sortedItems.find((i) => i.id === selectedItemId) || null;

  // Populate inline draft inputs whenever activeItem or Firestore scores change
  useEffect(() => {
    if (!activeItem) {
      setDraftScores({});
      return;
    }
    const next: Record<string, { pointsStr: string; feedback: string; dirty: boolean }> = {};
    for (const enr of sortedStudents) {
      const existing = scores.find(
        (s) => s.itemId === activeItem.id && s.studentId === enr.studentId
      );
      next[enr.studentId] = {
        pointsStr: existing !== undefined ? String(existing.points) : '',
        feedback: existing?.feedback || '',
        dirty: false,
      };
    }
    setDraftScores(next);
  }, [activeItem?.id, scores, enrollments.length]);

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
    if (!deleteTarget) return;
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

  const handleSaveSingleRow = async (studentId: string) => {
    if (!activeItem) return;
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
      toast.success('Bodovi su sačuvani.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri upisu bodova.');
    } finally {
      setSavingStudentId(null);
    }
  };

  const handleSaveAllDirty = async () => {
    if (!activeItem) return;
    const dirtyEntries = Object.entries(draftScores).filter(
      ([, v]) => v.dirty && v.pointsStr.trim() !== ''
    );
    if (dirtyEntries.length === 0) {
      toast.info('Nema neizmijenjenih unosa za čuvanje.');
      return;
    }

    // Validate all before writing
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
      toast.success(`Sačuvani bodovi za ${dirtyEntries.length} studenata.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri grupnom čuvanju bodova.');
    } finally {
      setSavingAll(false);
    }
  };

  const dirtyCount = Object.values(draftScores).filter(
    (d) => d.dirty && d.pointsStr.trim() !== ''
  ).length;

  return (
    <div className="space-y-5">
      {/* Top Toolbar: Select Grading Item or Create New */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">
            Evidencija bodova i stavke ocjenjivanja
          </h2>
          <p className="text-xs text-slate-500">
            Izaberite zadatak, vježbu ili ispit za brzi tabelarni unos bodova i komentara.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={openNewItemModal} size="sm">
            <Plus className="w-4 h-4" />
            Nova stavka ocjenjivanja
          </Button>
        </div>
      </div>

      {sortedItems.length === 0 ? (
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left 4 Cols: Grading Items List grouped by Category */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              Stavke na predmetu ({sortedItems.length})
            </div>
            <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
              {sortedCategories.map((cat) => {
                const catItems = sortedItems.filter((i) => i.categoryId === cat.id);
                if (catItems.length === 0) return null;
                return (
                  <div key={cat.id} className="p-2.5 space-y-1">
                    <div className="px-2 py-1 text-[11px] font-semibold text-slate-500 flex items-center justify-between">
                      <span>{cat.name}</span>
                      <span className="font-mono">{cat.maxPoints} b</span>
                    </div>
                    {catItems.map((it) => {
                      const isSel = it.id === selectedItemId;
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
                            <div className="text-[11px] text-slate-400 font-mono">
                              {formatBosnianDate(it.date)}
                            </div>
                          </div>
                          <span className="font-mono text-xs shrink-0">
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

          {/* Right 8 Cols: Fast Editable Student Score Table */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {activeItem && (
              <>
                <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-blue-700">
                        {sortedCategories.find((c) => c.id === activeItem.categoryId)?.name ||
                          'Kategorija'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{formatBosnianDate(activeItem.date)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-slate-800">
                        Maks. {formatPoints(activeItem.maxPoints)} bodova
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
                    {dirtyCount > 0 && (
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
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="text-left py-2.5 px-4">Student</th>
                          <th className="text-left py-2.5 px-4 w-32 whitespace-nowrap">
                            Bodovi (/{activeItem.maxPoints})
                          </th>
                          <th className="text-left py-2.5 px-4">Povratni komentar (opciono)</th>
                          <th className="text-right py-2.5 px-4 w-24">Akcija</th>
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
                            (s) =>
                              s.itemId === activeItem.id && s.studentId === stu.studentId
                          );

                          return (
                            <tr key={stu.studentId} className="hover:bg-slate-50/60">
                              <td className="py-2.5 px-4">
                                <div className="font-medium text-slate-900">
                                  {stu.studentName}
                                </div>
                                <div className="text-xs font-mono text-slate-500">
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
                                  onChange={(e) =>
                                    setDraftScores((prev) => ({
                                      ...prev,
                                      [stu.studentId]: {
                                        ...rowDraft,
                                        pointsStr: e.target.value,
                                        dirty: true,
                                      },
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      void handleSaveSingleRow(stu.studentId);
                                    }
                                  }}
                                  placeholder="—"
                                  className="h-8 font-mono text-right w-24"
                                />
                              </td>
                              <td className="py-2.5 px-4">
                                <Input
                                  value={rowDraft.feedback}
                                  onChange={(e) =>
                                    setDraftScores((prev) => ({
                                      ...prev,
                                      [stu.studentId]: {
                                        ...rowDraft,
                                        feedback: e.target.value,
                                        dirty: true,
                                      },
                                    }))
                                  }
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
                              <td className="py-2.5 px-4 text-right">
                                {rowDraft.dirty ? (
                                  <Button
                                    size="sm"
                                    onClick={() => handleSaveSingleRow(stu.studentId)}
                                    disabled={savingStudentId === stu.studentId}
                                    className="h-8 px-2.5"
                                  >
                                    {savingStudentId === stu.studentId ? '...' : 'Sačuvaj'}
                                  </Button>
                                ) : existing ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                                    <Check className="w-3.5 h-3.5" />
                                    Upisano
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
                className="font-mono"
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
                className="font-mono"
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
          <Button
            variant="destructive"
            onClick={handleConfirmDeleteItem}
            disabled={deleting}
          >
            {deleting ? 'Brisanje...' : 'Obriši stavku'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
