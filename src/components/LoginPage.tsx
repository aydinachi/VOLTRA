import React from 'react';
import { BookOpen, CheckCircle2, GraduationCap, Lock, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';

export function LoginPage() {
  const { signInWithGoogle, signingIn, authError } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      {/* Clean top institutional header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <div className="w-8 h-8 rounded-lg bg-blue-700 flex items-center justify-center text-white">
              <GraduationCap className="w-4 h-4" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">Zamio</span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600">
            <span className="whitespace-nowrap shrink-0">Univerzitet u Sarajevu</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="whitespace-nowrap shrink-0">Elektrotehnički fakultet</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="font-mono text-xs text-slate-500 whitespace-nowrap shrink-0">
              Akademska 2026/2027
            </span>
          </nav>

          <div className="shrink-0">
            <Button onClick={signInWithGoogle} disabled={signingIn} size="sm">
              <LogIn className="w-4 h-4" />
              {signingIn ? 'Prijava u toku...' : 'Prijava na portal'}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Workspace Sign-In Split */}
      <main className="flex-1 flex items-center py-12 px-6">
        <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          {/* Left Column: Academic System Overview */}
          <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
            <div className="text-xs font-medium text-blue-700 tracking-tight">
              ETF Student Portal · Informacioni sistem nastave
            </div>

            <h1
              className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Pregled bodova, prisustva i konačnih ocjena na jednom mjestu.
            </h1>

            <p className="text-base text-slate-600 leading-relaxed max-w-xl">
              Zamio zadržava poznatu i preglednu strukturu starog Zamger sistema na
              Elektrotehničkom fakultetu u Sarajevu — uz trenutni uvid u prisustvo po
              datumima, bodove sa zadaća i parcijalnih ispita te zaključene ocjene.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm mb-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Automatsko prisustvo</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Proporcionalni obračun bodova na osnovu održanih i prisustvovanih termina.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm mb-1">
                  <BookOpen className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>Struktura predmeta</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Prisustvo, zadaci, vježbe, parcijalni i završni ispiti sa povratnim komentarima.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm mb-1">
                  <ShieldCheck className="w-4 h-4 text-slate-700 shrink-0" />
                  <span>Zaštićen pristup</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Studenti vide isključivo vlastite rezultate, dok profesori uređuju svoje predmete.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Sign-In Card */}
          <div className="lg:col-span-5 flex items-center">
            <div className="w-full bg-white border border-slate-200 rounded-xl p-7 shadow-sm">
              <div className="pb-5 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Prijava u sistem Zamio</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Koristite svoj verifikovani Google račun za pristup studentskom ili profesorskom portalu.
                </p>
              </div>

              <div className="py-6 space-y-4">
                {authError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                    {authError}
                  </div>
                )}

                <Button
                  onClick={signInWithGoogle}
                  disabled={signingIn}
                  size="lg"
                  className="w-full h-11 text-sm font-semibold"
                >
                  <LogIn className="w-4 h-4" />
                  {signingIn ? 'Prijavljivanje...' : 'Prijavi se putem Google računa'}
                </Button>

                <div className="pt-2 space-y-2 text-xs text-slate-500 leading-relaxed">
                  <div className="flex items-start gap-2">
                    <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>
                      Novi nalozi se automatski registruju sa ulogom <strong>Student</strong> (samo za čitanje).
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>
                      Profesorske privilegije se dodjeljuju isključivo putem kontrolisanih pozivnica na stranici Profil.
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                <span>ETF Sarajevo · Zamio</span>
                <span className="font-mono tabular-nums">2026/2027</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>Zamio — ETF Student Portal · Elektrotehnički fakultet Univerziteta u Sarajevu</span>
          <span>Podaci se trajno pohranjuju uz strogu kontrolu pristupa po ulogama</span>
        </div>
      </footer>
    </div>
  );
}
