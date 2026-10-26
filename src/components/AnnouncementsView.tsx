import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  Edit3,
  ExternalLink,
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
  SmartNotificationItem,
} from '../types/zamio';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input, Label } from './ui/input';

export const ANNOUNCEMENT_CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
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

export function formatAnnouncementTimestamp(ts: unknown): string {
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

function formatIsoDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy}. u ${hh}:${min}`;
}

export function getReadAnnouncementsKey(uid: string): string {
  return `voltra_read_announcements_v1_${uid}`;
}

export function readAnnouncementReadMap(uid: string): Record<string, boolean> {
  if (!uid) return {};
  try {
    const raw = localStorage.getItem(getReadAnnouncementsKey(uid));
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function saveAnnouncementReadMap(uid: string, map: Record<string, boolean>): void {
  if (!uid) return;
  try {
    localStorage.setItem(getReadAnnouncementsKey(uid), JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

interface AnnouncementsViewProps {
  /** Only true when Administrator is in Admin Portal or explicitly managing */
  canManage?: boolean;
  /** Viewer audience perspective ('student' | 'professor' | 'admin') */
  viewerMode: 'student' | 'professor' | 'admin';
  /** Optional real-time personal smart notifications feed (for Student / Professor view) */
  smartNotifications?: SmartNotificationItem[];
  onSelectSmartNotification?: (item: SmartNotificationItem) => void;
  onMarkSmartReadOnly?: (itemId: string) => void;
  onMarkAllSmartRead?: () => void;
}

export function AnnouncementsView({
  canManage = false,
  viewerMode,
  smartNotifications = [],
  onSelectSmartNotification,
  onMarkSmartReadOnly,
  onMarkAllSmartRead,
}: AnnouncementsViewProps) {
  const { profile, isAdminUser } = useAuth();
  const effectiveCanManage = Boolean(canManage && isAdminUser);
  const viewerUid = profile?.uid || '';

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | AnnouncementCategory>('all');
  const [activeTab, setActiveTab] = useState<'official' | 'personal'>('official');

  // Read state for official announcements (per user)
  const [readOfficialMap, setReadOfficialMap] = useState<Record<string, boolean>>({});
  const [selectedOfficial, setSelectedOfficial] = useState<Announcement | null>(null);

  // Create / Edit Modal (Admin)
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
    if (!viewerUid) return;
    setReadOfficialMap(readAnnouncementReadMap(viewerUid));
  }, [viewerUid]);

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

  const audienceAnnouncements = useMemo(() => {
    return announcements.filter((item) => {
      if (viewerMode === 'student') {
        return (
          item.audience === AnnouncementAudience.ALL ||
          item.audience === AnnouncementAudience.STUDENTS
        );
      }
      if (viewerMode === 'professor') {
        return (
          item.audience === AnnouncementAudience.ALL ||
          item.audience === AnnouncementAudience.PROFESSORS
        );
      }
      return true;
    });
  }, [announcements, viewerMode]);

  const filteredItems = useMemo(() => {
    return audienceAnnouncements.filter((item) => {
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
  }, [audienceAnnouncements, categoryFilter, searchQuery]);

  const unreadOfficialCount = useMemo(
    () => audienceAnnouncements.filter((a) => !readOfficialMap[a.id]).length,
    [audienceAnnouncements, readOfficialMap]
  );

  const unreadSmartCount = useMemo(
    () => smartNotifications.filter((n) => !n.read).length,
    [smartNotifications]
  );

  const handleMarkOfficialRead = (announcementId: string) => {
    if (!viewerUid || readOfficialMap[announcementId]) return;
    const next = { ...readOfficialMap, [announcementId]: true };
    setReadOfficialMap(next);
    saveAnnouncementReadMap(viewerUid, next);
  };

  const handleMarkAllOfficialRead = () => {
    if (!viewerUid) return;
    const next = { ...readOfficialMap };
    for (const a of audienceAnnouncements) {
      next[a.id] = true;
    }
    setReadOfficialMap(next);
    saveAnnouncementReadMap(viewerUid, next);
  };

  const openOfficialDetails = (item: Announcement) => {
    handleMarkOfficialRead(item.id);
    setSelectedOfficial(item);
  };

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
      {/* Header & Section Switcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {viewerMode === 'student'
                ? 'Obavještenja fakulteta i obavijesti sa predmeta'
                : 'Zvanična oglasna ploča i obavještenja fakulteta'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-700 shrink-0" />
              <span>
                {effectiveCanManage
                  ? 'Kao administrator imate ekskluzivno pravo objave, izmjene i uklanjanja obavještenja za studente i profesore.'
                  : 'Pregled zvaničnih obavještenja uprave fakulteta i ličnih akademskih obavijesti.'}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {viewerMode === 'student' && (
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setActiveTab('official')}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
                    activeTab === 'official'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:text-slate-900'
                  )}
                >
                  Zvanična obavještenja
                  {unreadOfficialCount > 0 ? ` (${unreadOfficialCount})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('personal')}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums',
                    activeTab === 'personal'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:text-slate-900'
                  )}
                >
                  Obavijesti sa predmeta
                  {unreadSmartCount > 0 ? ` (${unreadSmartCount})` : ''}
                </button>
              </div>
            )}

            {effectiveCanManage && (
              <Button size="sm" onClick={openCreateModal} className="shrink-0">
                <Plus className="w-4 h-4" />
                Objavi obavještenje
              </Button>
            )}
          </div>
        </div>

        {activeTab === 'official' && (
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

            <div className="flex flex-wrap items-center gap-2">
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

              {!effectiveCanManage && unreadOfficialCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllOfficialRead}
                  className="text-xs text-blue-700 hover:text-blue-800 whitespace-nowrap"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Označi sve pročitanim
                </Button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'personal' && viewerMode === 'student' && (
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3 text-xs text-slate-600">
            <span>
              Automatske obavijesti kada profesor upiše bodove, bodove za aktivnost, prisustvo,
              ispitni rok ili zaključi ocjenu.
            </span>
            {unreadSmartCount > 0 && onMarkAllSmartRead && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onMarkAllSmartRead}
                className="text-xs text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Označi sve pročitanim
              </Button>
            )}
          </div>
        )}
      </div>

      {/* =====================================================================
          TAB 1: OFFICIAL ANNOUNCEMENTS
          ===================================================================== */}
      {activeTab === 'official' && (
        <>
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
              {filteredItems.map((item) => {
                const isUnread = !effectiveCanManage && !readOfficialMap[item.id];
                return (
                  <article
                    key={item.id}
                    onClick={() => {
                      if (!effectiveCanManage) {
                        openOfficialDetails(item);
                      }
                    }}
                    className={cn(
                      'p-5 sm:p-6 transition-colors',
                      !effectiveCanManage && 'cursor-pointer',
                      isUnread
                        ? 'bg-blue-50/40 hover:bg-blue-50/70'
                        : item.pinned
                          ? 'bg-slate-50/65 hover:bg-slate-50'
                          : 'hover:bg-slate-50/60'
                    )}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                          {isUnread && (
                            <>
                              <span className="font-semibold text-blue-700">Nepročitano</span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          {item.pinned && (
                            <>
                              <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                                <Pin className="w-3 h-3 shrink-0" />
                                Izdvojeno
                              </span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          <span className="font-medium text-slate-700">
                            {ANNOUNCEMENT_CATEGORY_LABELS[item.category] || 'Obavještenje'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{AUDIENCE_LABELS[item.audience]}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {formatAnnouncementTimestamp(item.createdAt)}
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

                      {effectiveCanManage ? (
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
                      ) : isUnread ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkOfficialRead(item.id);
                          }}
                          className="h-8 px-2.5 text-xs text-blue-700 shrink-0 self-start"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Označi pročitanim
                        </Button>
                      ) : null}
                    </div>

                    <p className="mt-2.5 text-sm text-slate-700 leading-relaxed whitespace-pre-line max-w-4xl">
                      {item.body}
                    </p>

                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>
                        Objavio: <strong className="font-medium text-slate-700">{item.authorName}</strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">Akademska {item.academicYear}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* =====================================================================
          TAB 2: PERSONAL COURSE NOTIFICATIONS (Students)
          ===================================================================== */}
      {activeTab === 'personal' && viewerMode === 'student' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {smartNotifications.length === 0 ? (
            <div className="p-10 text-center">
              <Bell className="w-7 h-7 text-slate-400 mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-slate-900">
                Trenutno nemate zabilježenih obavijesti sa predmeta
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
                Kada predmetni profesor objavi rezultate, upiše bodove, bodove za aktivnost,
                evidentira prisustvo ili otvori prijavu ispita, obavijest će biti prikazana ovdje.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {smartNotifications.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors',
                    item.read ? 'bg-white hover:bg-slate-50/70' : 'bg-blue-50/45 hover:bg-blue-50/75'
                  )}
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {!item.read && (
                        <>
                          <span className="font-semibold text-blue-700">Nepročitano</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span className="font-mono tabular-nums">
                        {formatIsoDateTime(item.createdAtIso)}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
                    <p className="text-xs text-slate-700 leading-relaxed">{item.description}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {!item.read && onMarkSmartReadOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onMarkSmartReadOnly(item.id)}
                        className="h-8 text-xs text-slate-600 whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Pročitano
                      </Button>
                    )}
                    {onSelectSmartNotification && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSelectSmartNotification(item)}
                        className="h-8 text-xs whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Otvori
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Official Announcement Reader Modal */}
      <Dialog
        open={Boolean(selectedOfficial)}
        onOpenChange={(o) => !o && setSelectedOfficial(null)}
        title={selectedOfficial?.title || 'Zvanično obavještenje'}
        description={
          selectedOfficial
            ? `${ANNOUNCEMENT_CATEGORY_LABELS[selectedOfficial.category]} · ${formatAnnouncementTimestamp(selectedOfficial.createdAt)}`
            : undefined
        }
      >
        {selectedOfficial && (
          <div className="space-y-4 text-left">
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {selectedOfficial.body}
            </p>
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Objavio: {selectedOfficial.authorName}</span>
              <Button size="sm" variant="outline" onClick={() => setSelectedOfficial(null)}>
                Zatvori
              </Button>
            </div>
          </div>
        )}
      </Dialog>

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
