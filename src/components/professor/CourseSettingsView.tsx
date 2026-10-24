import React, { useEffect, useState } from 'react';
import { Edit3, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatPoints } from '../../lib/utils';
import {
  createGradingCategory,
  deleteGradingCategory,
  updateCourseSettings,
  updateGradingCategory,
} from '../../services/zamioService';
import {
  Course,
  GradingCategory,
  GradingItem,
  Score,
} from '../../types/zamio';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input, Label } from '../ui/input';

interface CourseSettingsViewProps {
  course: Course;
  categories: GradingCategory[];
  items: GradingItem[];
  scores: Score[];
}

export function CourseSettingsView({
  course,
  categories,
  items,
  scores,
}: CourseSettingsViewProps) {
  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);

  const [name, setName] = useState(course.name);
  const [semester, setSemester] = useState(course.semester);
  const [academicYear, setAcademicYear] = useState(course.academicYear);
  const [ects, setEcts] = useState(String(course.ects));
  const [leadProfName, setLeadProfName] = useState(course.leadProfessorName);
  const [attendanceEnabled, setAttendanceEnabled] = useState(course.attendanceEnabled);
  const [attendanceMaxPoints, setAttendanceMaxPoints] = useState(
    String(course.attendanceMaxPoints)
  );
  const [allowBonusPoints, setAllowBonusPoints] = useState(course.allowBonusPoints);
  const [g6, setG6] = useState(String(course.grade6Threshold));
  const [g7, setG7] = useState(String(course.grade7Threshold));
  const [g8, setG8] = useState(String(course.grade8Threshold));
  const [g9, setG9] = useState(String(course.grade9Threshold));
  const [g10, setG10] = useState(String(course.grade10Threshold));
  const [savingSettings, setSavingSettings] = useState(false);

  // Category Modal
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<GradingCategory | null>(null);
  const [catName, setCatName] = useState('');
  const [catMaxPoints, setCatMaxPoints] = useState('20');
  const [catOrder, setCatOrder] = useState('1');
  const [savingCat, setSavingCat] = useState(false);

  const [deleteCatTarget, setDeleteCatTarget] = useState<GradingCategory | null>(null);

  useEffect(() => {
    setName(course.name);
    setSemester(course.semester);
    setAcademicYear(course.academicYear);
    setEcts(String(course.ects));
    setLeadProfName(course.leadProfessorName);
    setAttendanceEnabled(course.attendanceEnabled);
    setAttendanceMaxPoints(String(course.attendanceMaxPoints));
    setAllowBonusPoints(course.allowBonusPoints);
    setG6(String(course.grade6Threshold));
    setG7(String(course.grade7Threshold));
    setG8(String(course.grade8Threshold));
    setG9(String(course.grade9Threshold));
    setG10(String(course.grade10Threshold));
  }, [course]);

  const categoriesTotalMax = sortedCategories.reduce((acc, c) => acc + c.maxPoints, 0);
  const configuredCourseMax =
    (attendanceEnabled ? Number(attendanceMaxPoints || 0) : 0) + categoriesTotalMax;

  const handleSaveCourseSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await updateCourseSettings(course.id, {
        name,
        semester,
        academicYear,
        ects: Number(ects),
        leadProfessorName: leadProfName,
        attendanceEnabled,
        attendanceMaxPoints: attendanceEnabled ? Number(attendanceMaxPoints) : 0,
        allowBonusPoints,
        grade6Threshold: Number(g6),
        grade7Threshold: Number(g7),
        grade8Threshold: Number(g8),
        grade9Threshold: Number(g9),
        grade10Threshold: Number(g10),
      });
      toast.success('Postavke predmeta i pragovi ocjena su sačuvani.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju postavki.');
    } finally {
      setSavingSettings(false);
    }
  };

  const openNewCat = () => {
    setEditingCat(null);
    setCatName('');
    setCatMaxPoints('20');
    setCatOrder(String(sortedCategories.length + 1));
    setCatDialogOpen(true);
  };

  const openEditCat = (cat: GradingCategory) => {
    setEditingCat(cat);
    setCatName(cat.name);
    setCatMaxPoints(String(cat.maxPoints));
    setCatOrder(String(cat.order));
    setCatDialogOpen(true);
  };

  const handleSaveCat = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCat(true);
    try {
      if (editingCat) {
        await updateGradingCategory(editingCat.id, course.professorIds, {
          name: catName,
          maxPoints: Number(catMaxPoints),
          order: Number(catOrder),
        });
        toast.success('Kategorija je ažurirana.');
      } else {
        await createGradingCategory({
          course,
          name: catName,
          maxPoints: Number(catMaxPoints),
          order: Number(catOrder),
        });
        toast.success('Nova kategorija ocjenjivanja je dodana.');
      }
      setCatDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju kategorije.');
    } finally {
      setSavingCat(false);
    }
  };

  const handleConfirmDeleteCat = async () => {
    if (!deleteCatTarget) return;
    setSavingCat(true);
    try {
      const itemsInCategory = items.filter((i) => i.categoryId === deleteCatTarget.id);
      const itemIdSet = new Set(itemsInCategory.map((i) => i.id));
      const scoresInCategory = scores.filter((s) => itemIdSet.has(s.itemId));

      await deleteGradingCategory({
        course,
        categoryId: deleteCatTarget.id,
        itemsInCategory,
        scoresInCategory,
      });
      setDeleteCatTarget(null);
      toast.success('Kategorija ocjenjivanja je obrisana.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri brisanju kategorije.');
    } finally {
      setSavingCat(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 7 Cols: Attendance, Thresholds & Course Parameters */}
      <form
        onSubmit={handleSaveCourseSettings}
        className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6"
      >
        <div className="pb-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Pravila bodovanja i pragovi ocjena
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ukupni konfigurisani maksimum predmeta:{' '}
              <strong className="font-mono text-slate-900">
                {formatPoints(configuredCourseMax)} bodova
              </strong>
            </p>
          </div>
          <span className="font-mono text-xs text-blue-700 font-semibold">{course.code}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Label htmlFor="crs-name">Naziv predmeta</Label>
            <Input
              id="crs-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="crs-sem">Semestar i godina studija</Label>
            <Input
              id="crs-sem"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="crs-ects">ECTS krediti</Label>
            <Input
              id="crs-ects"
              type="number"
              min="1"
              max="30"
              value={ects}
              onChange={(e) => setEcts(e.target.value)}
              className="font-mono"
              required
            />
          </div>

          <div>
            <Label htmlFor="crs-prof">Odgovorni nastavnik</Label>
            <Input
              id="crs-prof"
              value={leadProfName}
              onChange={(e) => setLeadProfName(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="crs-year">Akademska godina</Label>
            <Input
              id="crs-year"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="font-mono"
              required
            />
          </div>
        </div>

        {/* Attendance & Bonus Configuration */}
        <div className="pt-4 border-t border-slate-100 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">Prisustvo i bonus bodovi</h3>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={attendanceEnabled}
                onChange={(e) => {
                  setAttendanceEnabled(e.target.checked);
                  if (e.target.checked && Number(attendanceMaxPoints) === 0) {
                    setAttendanceMaxPoints('10');
                  }
                }}
                className="rounded border-slate-300 text-blue-700"
              />
              <span>Uključi automatsko bodovanje prisustva</span>
            </label>

            {attendanceEnabled && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 whitespace-nowrap">Maks. bodova:</span>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  value={attendanceMaxPoints}
                  onChange={(e) => setAttendanceMaxPoints(e.target.value)}
                  className="w-20 h-8 font-mono text-right"
                />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={allowBonusPoints}
              onChange={(e) => setAllowBonusPoints(e.target.checked)}
              className="rounded border-slate-300 text-blue-700"
            />
            <span>
              Dozvoli bonus bodove iznad maksimuma pojedinačnih stavki i kategorija
            </span>
          </label>
        </div>

        {/* Configurable Final Grade Thresholds */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Pragovi za zaključivanje konačne ocjene (6–10)
            </h3>
            <p className="text-xs text-slate-500">
              Minimalan broj ukupno ostvarenih bodova za svaku prolaznu ocjenu.
            </p>
          </div>

          <div className="grid grid-cols-5 gap-2.5">
            {[
              { label: 'Ocjena 6', val: g6, set: setG6 },
              { label: 'Ocjena 7', val: g7, set: setG7 },
              { label: 'Ocjena 8', val: g8, set: setG8 },
              { label: 'Ocjena 9', val: g9, set: setG9 },
              { label: 'Ocjena 10', val: g10, set: setG10 },
            ].map((item) => (
              <div key={item.label}>
                <Label className="text-[11px]">{item.label}</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={item.val}
                  onChange={(e) => item.set(e.target.value)}
                  className="font-mono text-center px-2"
                  required
                />
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <Button type="submit" disabled={savingSettings}>
            <Save className="w-4 h-4" />
            {savingSettings ? 'Čuvanje...' : 'Sačuvaj postavke predmeta'}
          </Button>
        </div>
      </form>

      {/* Right 5 Cols: Grading Categories Manager */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Kategorije ocjenjivanja</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Zbir kategorija: <span className="font-mono font-semibold">{categoriesTotalMax} b</span>
              {attendanceEnabled && (
                <>
                  {' '}
                  + Prisustvo <span className="font-mono">{attendanceMaxPoints} b</span>
                </>
              )}
            </p>
          </div>
          <Button size="sm" onClick={openNewCat}>
            <Plus className="w-3.5 h-3.5" />
            Dodaj
          </Button>
        </div>

        <div className="divide-y divide-slate-100">
          {attendanceEnabled && (
            <div className="px-5 py-3 bg-slate-50/70 flex items-center justify-between text-xs text-slate-600">
              <span>1. Prisustvo (automatska kategorija)</span>
              <span className="font-mono font-semibold text-slate-900">
                {formatPoints(Number(attendanceMaxPoints))} b
              </span>
            </div>
          )}

          {sortedCategories.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Nema definisanih kategorija ocjenjivanja.
            </div>
          ) : (
            sortedCategories.map((cat) => {
              const catItems = items.filter((i) => i.categoryId === cat.id);
              const itemsSum = catItems.reduce((s, i) => s + i.maxPoints, 0);
              return (
                <div
                  key={cat.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/60"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {cat.name}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                      Maks. {formatPoints(cat.maxPoints)} b · Stavki: {catItems.length} (zbir stavki:{' '}
                      {formatPoints(itemsSum)} b)
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditCat(cat)}
                      className="h-8 w-8"
                      aria-label="Uredi kategoriju"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteCatTarget(cat)}
                      className="h-8 w-8 text-red-700 hover:bg-red-50 hover:text-red-800"
                      aria-label="Obriši kategoriju"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Category Modal */}
        <Dialog
          open={catDialogOpen}
          onOpenChange={setCatDialogOpen}
          title={editingCat ? 'Uredi kategoriju' : 'Nova kategorija ocjenjivanja'}
        >
          <form onSubmit={handleSaveCat} className="space-y-4">
            <div>
              <Label htmlFor="cat-name">Naziv kategorije</Label>
              <Input
                id="cat-name"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="npr. Zadaci, Vježbe, I parcijalni ispit"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cat-max">Maksimalno bodova</Label>
                <Input
                  id="cat-max"
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  value={catMaxPoints}
                  onChange={(e) => setCatMaxPoints(e.target.value)}
                  className="font-mono"
                  required
                />
              </div>
              <div>
                <Label htmlFor="cat-ord">Redoslijed prikaza</Label>
                <Input
                  id="cat-ord"
                  type="number"
                  min="1"
                  max="50"
                  value={catOrder}
                  onChange={(e) => setCatOrder(e.target.value)}
                  className="font-mono"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCatDialogOpen(false)}>
                Odustani
              </Button>
              <Button type="submit" disabled={savingCat}>
                Sačuvaj
              </Button>
            </div>
          </form>
        </Dialog>

        {/* Confirm Delete Category */}
        <Dialog
          open={Boolean(deleteCatTarget)}
          onOpenChange={(o) => !o && setDeleteCatTarget(null)}
          title="Potvrda brisanja kategorije"
          description={`Brisanjem kategorije "${deleteCatTarget?.name}" obrisaćete i sve njene stavke ocjenjivanja te upisane bodove studenata u toj kategoriji.`}
        >
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteCatTarget(null)}>
              Odustani
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDeleteCat}
              disabled={savingCat}
            >
              Obriši kategoriju
            </Button>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
