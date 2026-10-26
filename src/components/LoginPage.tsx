import React, { useState } from 'react';
import {
  BellRing,
  CalendarClock,
  FileCheck2,
  KeyRound,
  Lock,
  LogIn,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Input, Label } from './ui/input';

export function LoginPage() {
  const { signInWithGoogle, signInWithCredentials, signingIn, authError, clearAuthError } =
    useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleCredentialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithCredentials(email, password);
    } catch {
      // Handled via authError state in AuthContext
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            VOLTRA
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#mogucnosti"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Bodovi i semestri
            </a>
            <a
              href="#mogucnosti"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Raspored i ispiti
            </a>
            <a
              href="#mogucnosti"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Pametne obavijesti
            </a>
            <a
              href="#pristup"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Pristup portalu
            </a>
          </nav>

          <div className="shrink-0">
            <Button
              onClick={signInWithGoogle}
              disabled={signingIn}
              size="sm"
              className="whitespace-nowrap shrink-0"
            >
              <LogIn className="w-4 h-4" />
              {signingIn ? 'Prijava u toku...' : 'Google prijava'}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Workspace Sign-In Split */}
      <main id="top" className="flex-1 flex items-center py-10 sm:py-12 px-6">
        <div className="max-w-6xl mx-auto w-full space-y-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            {/* Left Column: Academic System Overview */}
            <div className="lg:col-span-7 flex flex-col justify-center space-y-5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-blue-700">
                <span>ETF Sarajevo</span>
                <span aria-hidden="true">·</span>
                <span>Univerzitet u Sarajevu</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-600">
                  Akademska 2026/2027
                </span>
              </div>

              <h1
                className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight"
                style={{ textWrap: 'balance' }}
              >
                VOLTRA — objedinjeni akademski portal za studente, profesore i administraciju.
              </h1>

              <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                Savremena akademska platforma Elektrotehničkog fakulteta u Sarajevu za Stručni
                studij Razvoj softvera (2 godine), Bachelor i Master odsjeke (RI, AE, EE, TK).
                Pratite bodove, raspored nastave, prijave ispita, pametne obavijesti i arhivu
                prethodnih semestara na jednom mjestu.
              </p>

              <div className="pt-2 space-y-2 text-xs text-slate-600">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                  <span>
                    <strong>Administracija fakulteta</strong> dodjeljuje naloge profesorima i
                    studentima (indeks, ciklus, smjer i godinu studija) te objavljuje zvanična
                    obavještenja.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <span>
                    <strong>Sigurnost naloga:</strong> Profesori i studenti mogu u svakom trenutku
                    promijeniti lozinku u sekciji Moj profil.
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column: Sign-In Container */}
            <div id="pristup" className="lg:col-span-5 flex items-center">
              <div className="w-full bg-white border border-slate-200 rounded-xl p-6 sm:p-7">
                <div className="pb-4 border-b border-slate-100">
                  <h2 className="text-lg font-bold text-slate-900">Prijava na VOLTRA portal</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Prijavite se pristupnim podacima koje dodjeljuje fakultet ili verifikovanim
                    Google računom.
                  </p>
                </div>

                <div className="py-5 space-y-4">
                  {authError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                      {authError}
                    </div>
                  )}

                  <form onSubmit={handleCredentialSubmit} className="space-y-3.5">
                    <div>
                      <Label htmlFor="login-email">Službeni ili studentski e-mail</Label>
                      <Input
                        id="login-email"
                        type="email"
                        autoComplete="username"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (authError) clearAuthError();
                        }}
                        placeholder="ime.prezime@etf.unsa.ba"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="login-password">Lozinka</Label>
                      <Input
                        id="login-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (authError) clearAuthError();
                        }}
                        placeholder="Unesite vašu lozinku"
                        required
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={signingIn}
                      size="lg"
                      className="w-full h-10 text-sm font-semibold"
                    >
                      <KeyRound className="w-4 h-4" />
                      {signingIn ? 'Prijavljivanje...' : 'Prijavi se e-mailom i lozinkom'}
                    </Button>
                  </form>

                  <div className="relative py-1">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-white px-2.5 text-slate-400">
                        ili putem institucionalnog računa
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={signInWithGoogle}
                    disabled={signingIn}
                    size="lg"
                    className="w-full h-10 text-sm font-semibold"
                  >
                    <LogIn className="w-4 h-4" />
                    Nastavi putem Google računa
                  </Button>
                </div>

                <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <span>VOLTRA · ETF Student Portal</span>
                  <span className="font-mono tabular-nums">2026/2027</span>
                </div>
              </div>
            </div>
          </div>

          {/* Full-Width Single-Elevation Feature Strip Below Hero Split */}
          <section
            id="mogucnosti"
            className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200"
          >
            <div className="p-5">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm mb-1.5">
                <CalendarClock className="w-4 h-4 text-blue-700 shrink-0" />
                <span>Raspored „Danas“ i „Ove sedmice“</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Pregled predavanja, laboratorijskih vježbi, termina ispita i rokova za predaju
                projekata u dnevnom i sedmičnom prikazu.
              </p>
            </div>

            <div className="p-5">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm mb-1.5">
                <BellRing className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Pametne notifikacije po izboru</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Trenutne obavijesti za objavu rezultata, promjenu bodova, unos prisustva i nove
                ispitne rokove — student sam bira šta želi primati.
              </p>
            </div>

            <div className="p-5">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm mb-1.5">
                <FileCheck2 className="w-4 h-4 text-slate-700 shrink-0" />
                <span>Semestri i arhiva rezultata</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Arhiviranje završenih semestara i otvaranje nove akademske godine uz trajan uvid
                studenta u sve ranije položene predmete i ocjene.
              </p>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>VOLTRA — ETF Student Portal · Elektrotehnički fakultet Univerziteta u Sarajevu</span>
          <span>Kontrola pristupa po ulogama: Student · Profesor · Administrator</span>
        </div>
      </footer>
    </div>
  );
}
