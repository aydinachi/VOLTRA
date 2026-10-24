import React, { useState } from 'react';
import {
  Check,
  Copy,
  Database,
  KeyRound,
  Mail,
  Save,
  ShieldCheck,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import {
  clearEtfDemoData,
  createProfessorInvitation,
  redeemProfessorInvitation,
  seedEtfDemoData,
  updateOwnProfile,
} from '../services/zamioService';
import { UserRole } from '../types/zamio';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input, Label } from './ui/input';

const ETF_DEPARTMENTS = [
  'Računarstvo i informatika',
  'Automatika i elektronika',
  'Elektroenergetika',
  'Telekomunikacije',
];

export function ProfileView() {
  const { profile, privateData, isAdminUser, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState(profile?.fullName || '');
  const [studentIndex, setStudentIndex] = useState(profile?.studentIndex || '');
  const [department, setDepartment] = useState(
    profile?.department || 'Računarstvo i informatika'
  );
  const [academicYear, setAcademicYear] = useState(profile?.academicYear || '2026/2027');
  const [savingProfile, setSavingProfile] = useState(false);

  // Invitation Redemption (for Students invited to become Professors)
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  // Admin: Create Professor Invitation
  const [targetProfEmail, setTargetProfEmail] = useState('');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Admin: Seed Data Management
  const [seedBusy, setSeedBusy] = useState(false);
  const [confirmClearSeedOpen, setConfirmClearSeedOpen] = useState(false);

  if (!profile) return null;

  const roleLabel =
    isAdminUser || profile.role === UserRole.ADMIN
      ? 'Administrator / Profesor'
      : profile.role === UserRole.PROFESSOR
        ? 'Profesor'
        : 'Student';

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateOwnProfile(profile.uid, profile.studentIndex, {
        fullName,
        studentIndex,
        department,
        academicYear,
      });
      await refreshProfile();
      toast.success('Profil je uspješno sačuvan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri čuvanju profila.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRedeemInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!privateData?.email) return;
    setRedeeming(true);
    try {
      await redeemProfessorInvitation({
        uid: profile.uid,
        userEmail: privateData.email,
        inviteCode: inviteCodeInput,
      });
      await refreshProfile();
      setInviteCodeInput('');
      toast.success('Pozivnica je prihvaćena! Vaš nalog sada ima ulogu Profesora.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Neuspješna aktivacija pozivnice.');
    } finally {
      setRedeeming(false);
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingInvite(true);
    try {
      const code = await createProfessorInvitation({
        adminUid: profile.uid,
        targetEmail: targetProfEmail,
      });
      setGeneratedCode(code);
      setTargetProfEmail('');
      toast.success('Pozivnica za profesora je kreirana.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri kreiranju pozivnice.');
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleCopyCode = async () => {
    if (!generatedCode) return;
    await navigator.clipboard.writeText(generatedCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleSeedDemo = async () => {
    setSeedBusy(true);
    try {
      await seedEtfDemoData({
        adminUid: profile.uid,
        adminName: profile.fullName,
        adminIndex: profile.studentIndex || '19001',
      });
      toast.success('Razvojni ETF Sarajevo podaci su učitani.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri učitavanju demo podataka.');
    } finally {
      setSeedBusy(false);
    }
  };

  const handleClearSeed = async () => {
    setSeedBusy(true);
    try {
      const removed = await clearEtfDemoData(profile.uid);
      setConfirmClearSeedOpen(false);
      toast.success(`Uklonjeno je ${removed} razvojnih (seed) zapisa.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Greška pri uklanjanju demo podataka.');
    } finally {
      setSeedBusy(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Main Profile Form */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Lični i akademski podaci</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ažurirajte ime, odsjek i broj indeksa radi evidencije upisa na predmete.
            </p>
          </div>
          <div className="text-xs text-slate-600 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" />
            <span>Uloga:</span>
            <strong className="text-slate-900">{roleLabel}</strong>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="pt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="prof-fullname">Ime i prezime</Label>
              <Input
                id="prof-fullname"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={100}
              />
            </div>

            <div>
              <Label htmlFor="prof-email">Verifikovani e-mail (privatno izolovano)</Label>
              <div className="relative">
                <Input
                  id="prof-email"
                  value={privateData?.email || '—'}
                  disabled
                  className="bg-slate-50 text-slate-500"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="prof-index">Broj indeksa (za studente)</Label>
              <Input
                id="prof-index"
                value={studentIndex}
                onChange={(e) => setStudentIndex(e.target.value)}
                placeholder="npr. 18942"
                maxLength={20}
                className="font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Profesori vas upisuju na predmet unosom ovog broja indeksa.
              </p>
            </div>

            <div>
              <Label htmlFor="prof-dept">Odsjek na ETF Sarajevo</Label>
              <select
                id="prof-dept"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                {ETF_DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="prof-year">Akademska godina</Label>
              <Input
                id="prof-year"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                maxLength={20}
                className="font-mono"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" disabled={savingProfile}>
              <Save className="w-4 h-4" />
              {savingProfile ? 'Čuvanje...' : 'Sačuvaj izmjene'}
            </Button>
          </div>
        </form>
      </section>

      {/* Student Only: Redeem Controlled Professor Invitation */}
      {profile.role === UserRole.STUDENT && !isAdminUser && (
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
              <KeyRound className="w-4 h-4 text-blue-700" />
              <span>Aktivacija profesorske pozivnice</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Korisnici ne mogu samostalno dodijeliti profesorske privilegije. Ako vam je administrator
              izdao pozivnicu na vašu e-mail adresu ({privateData?.email}), unesite kod ispod.
            </p>
          </div>

          <form onSubmit={handleRedeemInvite} className="pt-4 flex flex-col sm:flex-row gap-3">
            <Input
              value={inviteCodeInput}
              onChange={(e) => setInviteCodeInput(e.target.value)}
              placeholder="npr. INV-ETF-8K2P9A"
              className="font-mono sm:max-w-xs"
              required
            />
            <Button type="submit" disabled={redeeming || !inviteCodeInput.trim()}>
              <UserCheck className="w-4 h-4" />
              {redeeming ? 'Provjera...' : 'Aktiviraj pozivnicu'}
            </Button>
          </form>
        </section>
      )}

      {/* Admin Only: Issue Controlled Professor Invitations & Seed Data Controls */}
      {isAdminUser && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
                <Mail className="w-4 h-4 text-blue-700" />
                <span>Pozivnica za novog profesora</span>
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Kreirajte jednokratni kod vezan isključivo za e-mail adresu nastavnika ili saradnika.
              </p>

              <form onSubmit={handleCreateInvite} className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="invite-email">E-mail adresa nastavnika</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={targetProfEmail}
                    onChange={(e) => setTargetProfEmail(e.target.value)}
                    placeholder="ime.prezime@etf.unsa.ba"
                    required
                  />
                </div>
                <Button type="submit" disabled={creatingInvite} size="sm">
                  <KeyRound className="w-3.5 h-3.5" />
                  {creatingInvite ? 'Kreiranje...' : 'Generiši pozivnicu'}
                </Button>
              </form>
            </div>

            {generatedCode && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <span className="text-xs text-slate-500 block mb-1.5">
                  Jednokratni aktivacijski kod:
                </span>
                <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <code className="text-sm font-semibold text-slate-900">{generatedCode}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyCode}
                    className="h-7 px-2"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        Kopirano
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Kopiraj
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
                <Database className="w-4 h-4 text-slate-700" />
                <span>Razvojni (seed) podaci</span>
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Svi testni predmeti i demo studenti su označeni zastavicom{' '}
                <code className="text-slate-700">isSeed: true</code> i strogo odvojeni od
                produkcijskih zapisa.
              </p>
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-2.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSeedDemo}
                disabled={seedBusy}
              >
                <Database className="w-3.5 h-3.5" />
                Učitaj ETF demo podatke
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmClearSeedOpen(true)}
                disabled={seedBusy}
                className="text-red-700 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Ukloni demo podatke
              </Button>
            </div>
          </section>
        </div>
      )}

      <Dialog
        open={confirmClearSeedOpen}
        onOpenChange={setConfirmClearSeedOpen}
        title="Uklanjanje razvojnih (seed) podataka"
        description="Ova akcija će obrisati isključivo demo predmete, studente i ocjene označene sa isSeed: true. Produkcijski podaci ostaju netaknuti."
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button variant="outline" onClick={() => setConfirmClearSeedOpen(false)}>
            Odustani
          </Button>
          <Button
            variant="destructive"
            onClick={handleClearSeed}
            disabled={seedBusy}
          >
            {seedBusy ? 'Brisanje...' : 'Potvrdi brisanje demo zapisa'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
