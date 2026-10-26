import React, { useEffect, useMemo, useState } from 'react';
import {
  Edit3,
  Megaphone,
  Pin,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import {
  createAnnouncement,
  deleteAnnouncement,
  subscribeAllAnnouncementsForAdmin,
  subscribePublishedAnnouncements,
  updateAnnouncement,
} from '../services/zamioService';
import {
  Announcement,
  AnnouncementAudience,
  AnnouncementCategory,
} from '../types/zamio';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input, Label } from './ui/input';

const CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  [AnnouncementCategory.GENERAL]: 'Opšte obavještenje',
  [AnnouncementCategory.EXAMS]: 'Ispitni rokovi',
  [AnnouncementCategory.TEACHING]: 'Nastava i vježbe',
  [AnnouncementCategory.SEMESTER]: 'Semestar i upis',
};

const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  [AnnouncementAudience.ALL]: 'Svi korisnici (Studenti i Profesori)',
  [AnnouncementAudience.STUDENTS]: 'Samo studenti',
  [AnnouncementAudience.PROFESSORS]: 'Samo profesori i osoblje',
};

function formatTimestampDate(ts: unknown): string {
  const sec = (ts as { seconds?: number })?.seconds;
  if (!sec) return 'Upravo objavljeno';
  const d = new Date(sec * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy}. u ${hh}:${min}`;
}

interface AnnouncementsViewProps {
  /** Only true when Administrator is in Admin Portal or explicitly managing */
  canManage?: boolean;
  /** Viewer audience perspective ('student' | 'professor' | 'admin') */
  viewerMode: 'student' | 'professor' | 'admin';
}

export function AnnouncementsView({
  canManage = false,
  viewerMode,
}: AnnouncementsViewProps) {
  const { profile, isAdminUser } = useAuth();
  const effectiveCanManage = Boolean(canManage && isAdminUser);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | AnnouncementCategory>('all');

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Announcement | null>(null);
  const [titleInput, setTitleInput] = useState('');
  const [bodyInput, setBodyInput] = useState('');
  const [categoryInput, setCategoryInput] = useState<AnnouncementCategory>(
    AnnouncementCategory.GENERAL
  );
  const [audienceInput, setAudienceInput] = useState<AnnouncementAudience>(
    AnnouncementAudience.ALL
  );
  const [pinnedInput, setPinnedInput] = useState(false);
  const [publishedInput, setPublishedInput] = useState(true);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsub = effectiveCanManage
      ? subscribeAllAnnouncementsForAdmin((rows) => {
          setAnnouncements(rows);
          setLoading(false);
        })
      : subscribePublishedAnnouncements((rows) => {
          setAnnouncements(rows);
          setLoading(false);
        });

    return () => unsub();
  }, [effectiveCanManage]);

  const filteredItems = useMemo(() => {
    return announcements.filter((item) => {
      if (viewerMode === 'student') {
        if (
          item.audience !== AnnouncementAudience.ALL &&
          item.audience !== AnnouncementAudience.STUDENTS
        ) {
          return false;
        }
      } else if (viewerMode === 'professor') {
        if (
          item.audience !== AnnouncementAudience.ALL &&
          item.audience !== AnnouncementAudience.PROFESSORS
        ) {
          return false;
        }
      }

      if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false;
      }

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.body.toLowerCase().includes(q) ||
        item.authorName.toLowerCase().includes(q)
      );
    });
  }, [announcements, viewerMode, categoryFilter, searchQuery]);

  const openCreateModal = () => {
    setEditingItem(null);
    setTitleInput('');
    setBodyInput('');
    setCategoryInput(AnnouncementCategory.GENERAL);
    setAudienceInput(AnnouncementAudience.ALL);
    setPinnedInput(false);
    setPublishedInput(true);
    setModalOpen(true);
  };

  const openEditModal = (item: Announcement) => {
    setEditingItem(item);
    setTitleInput(item.title);
    setBodyInput(item.body);
    setCategoryInput(item.category);
    setAudienceInput(item.audience);
    setPinnedInput(item.pinned);
    setPublishedInput(item.isPublished);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    try {
      const authorLabel = profile.fullName
        ? `Administrator · ${profile.fullName}`
        : 'Studentska služba / Administracija ETF-a';

      if (editingItem) {
        await updateAnnouncement(editingItem.id, {
          title: titleInput,
          body: bodyInput,
          category: categoryInput,
          audience: audienceInput,
          pinned: pinnedInput,
          isPublished: publishedInput,
          authorName: editingItem.authorName || authorLabel,
          academicYear: profile.academicYear || '2026/2027',
        });
        toast.success('Obavještenje je ažurirano.');
      } else {
        await createAnnouncement({
          adminUid: profile.uid,
          authorName: authorLabel,
          title: titleInput,
          body: bodyInput,
          category: categoryInput,
          audience: audienceInput,
          pinned: pinnedInput,
          academicYear: profile.academicYear || '2026/2027',
        });
        toast.success('Novo zvanično obavještenje je objavljeno.');
      }
      setModalOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju obavještenja.');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePin = async (item: Announcement) => {
    try {
      await updateAnnouncement(item.id, {
        title: item.title,
        body: item.body,
        category: item.category,
        audience: item.audience,
        pinned: !item.pinned,
        isPublished: item.isPublished,
        authorName: item.authorName,
        academicYear: item.academicYear,
      });
      toast.success(
        !item.pinned
          ? 'Obavještenje je izdvojeno na vrh.'
          : 'Obavještenje je uklonjeno sa vrha.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri izmjeni statusa.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteAnnouncement(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('Obavještenje je obrisano.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri brisanju obavještenja.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Zvanična oglasna ploča i obavještenja fakulteta
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-700 shrink-0" />
              <span>
                {effectiveCanManage
                  ? 'Kao administrator imate ekskluzivno pravo objave, izmjene i uklanjanja obavještenja za studente i profesore.'
                  : 'Zvanična obavještenja objavljuje isključivo administrator Elektrotehničkog fakulteta.'}
              </span>
            </p>
          </div>

          {effectiveCanManage && (
            <Button size="sm" onClick={openCreateModal} className="shrink-0 self-start sm:self-auto">
              <Plus className="w-4 h-4" />
              Objavi obavještenje
            </Button>
          )}
        </div>

        <div className="pt-3 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pretraži obavještenja..."
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
            {(
              [
                { key: 'all', label: 'Sva obavještenja' },
                { key: AnnouncementCategory.SEMESTER, label: 'Semestar i upis' },
                { key: AnnouncementCategory.EXAMS, label: 'Ispiti' },
                { key: AnnouncementCategory.TEACHING, label: 'Nastava' },
                { key: AnnouncementCategory.GENERAL, label: 'Opšte' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setCategoryFilter(tab.key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  categoryFilter === tab.key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Announcements List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 bg-white border border-slate-200 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <Megaphone className="w-7 h-7 text-slate-400 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-slate-900">
            Nema objavljenih obavještenja za odabrani filter
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Sve nove odluke dekanata, studentske službe i administratora pojavit će se ovdje.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden">
          {filteredItems.map((item) => (
            <article
              key={item.id}
              className={cn(
                'p-5 sm:p-6 transition-colors',
                item.pinned ? 'bg-blue-50/35' : 'hover:bg-slate-50/60'
              )}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1.5 min-w-0 flex-1">
                  {/* Unboxed clean metadata line (Zero-Pill Discipline) */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    {item.pinned && (
                      <>
                        <span className="inline-flex items-center gap-1 font-semibold text-blue-700">
                          <Pin className="w-3 h-3 shrink-0" />
                          Izdvojeno
                        </span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span className="font-medium text-slate-700">
                      {CATEGORY_LABELS[item.category] || 'Obavještenje'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{AUDIENCE_LABELS[item.audience]}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatTimestampDate(item.createdAt)}
                    </span>
                    {!item.isPublished && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-amber-700">Sakriveno (nacrt)</span>
                      </>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-slate-900 leading-snug">
                    {item.title}
                  </h3>
                </div>

                {effectiveCanManage && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTogglePin(item)}
                      className="h-8 px-2.5 text-xs text-slate-600"
                    >
                      <Pin className="w-3.5 h-3.5" />
                      {item.pinned ? 'Ukloni sa vrha' : 'Izdvoji'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditModal(item)}
                      className="h-8 px-2.5 text-xs"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Uredi
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(item)}
                      className="h-8 w-8 text-slate-400 hover:text-red-700 hover:bg-red-50"
                      aria-label="Obriši obavještenje"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              <p className="mt-2.5 text-sm text-slate-700 leading-relaxed whitespace-pre-line max-w-4xl">
                {item.body}
              </p>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>Objavio: <strong className="font-medium text-slate-700">{item.authorName}</strong></span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">Akademska {item.academicYear}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Create / Edit Announcement Dialog (Admin Only) */}
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingItem ? 'Uredi zvanično obavještenje' : 'Objavi novo obavještenje'}
        description="Obavještenje će biti odmah prikazano odabranoj ciljnoj grupi (studentima, profesorima ili svim korisnicima)."
      >
        <form onSubmit={handleSave} className="space-y-4 text-left">
          <div>
            <Label htmlFor="ann-title">Naslov obavještenja</Label>
            <Input
              id="ann-title"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="npr. Početak prijave januarsko-februarskih ispitnih rokova"
              maxLength={140}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ann-cat">Kategorija</Label>
              <select
                id="ann-cat"
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value as AnnouncementCategory)}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value={AnnouncementCategory.GENERAL}>Opšte obavještenje</option>
                <option value={AnnouncementCategory.SEMESTER}>Semestar i upis</option>
                <option value={AnnouncementCategory.EXAMS}>Ispitni rokovi</option>
                <option value={AnnouncementCategory.TEACHING}>Nastava i vježbe</option>
              </select>
            </div>

            <div>
              <Label htmlFor="ann-aud">Vidljivost (ciljna grupa)</Label>
              <select
                id="ann-aud"
                value={audienceInput}
                onChange={(e) => setAudienceInput(e.target.value as AnnouncementAudience)}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value={AnnouncementAudience.ALL}>Svi (Studenti i Profesori)</option>
                <option value={AnnouncementAudience.STUDENTS}>Samo studenti</option>
                <option value={AnnouncementAudience.PROFESSORS}>Samo profesori</option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="ann-body">Tekst obavještenja</Label>
            <textarea
              id="ann-body"
              value={bodyInput}
              onChange={(e) => setBodyInput(e.target.value)}
              rows={5}
              maxLength={2000}
              required
              placeholder="Unesite puni sadržaj zvaničnog obavještenja..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            />
          </div>

          <div className="flex flex-wrap items-center gap-5 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={pinnedInput}
                onChange={(e) => setPinnedInput(e.target.checked)}
              />
              <span>Izdvoji na vrh oglasne ploče</span>
            </label>

            {editingItem && (
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={publishedInput}
                  onChange={(e) => setPublishedInput(e.target.checked)}
                />
                <span>Javno objavljeno</span>
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Odustani
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Čuvanje...' : editingItem ? 'Sačuvaj izmjene' : 'Objavi obavještenje'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Brisanje zvaničnog obavještenja"
        description={`Želite li trajno ukloniti obavještenje „${deleteTarget?.title}“?`}
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Odustani
          </Button>
          <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleting}>
            {deleting ? 'Brisanje...' : 'Obriši obavještenje'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
