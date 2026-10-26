import React, { useState } from 'react';
import { Eye, EyeOff, GraduationCap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Input, Label } from './ui/input';

const ETF_HORIZONTAL_LOGO =
  '/assets/aistudio/ZZZ_Logo_ETF_UNSA_BA_75cbfb3b77_98ab9104.png';
const UNSA_SEAL_LOGO =
  '/assets/aistudio/c25a3f4e5c2e904125f32a691b061303_d15b2c13.png';
const ETF_DARK_MARK = '/assets/aistudio/images__3__ce548d61.jfif';

function GoogleMarkSvg() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

export function LoginPage() {
  const { signInWithGoogle, signInWithCredentials, signingIn, authError, clearAuthError } =
    useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [etfHorizontalFailed, setEtfHorizontalFailed] = useState(false);
  const [unsaSealFailed, setUnsaSealFailed] = useState(false);
  const [etfMarkFailed, setEtfMarkFailed] = useState(false);

  const handleCredentialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithCredentials(email, password);
    } catch {
      // Handled via authError state in AuthContext
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 grid grid-cols-1 lg:grid-cols-12">
      {/* Left Institutional Identity Panel (Desktop) */}
      <aside className="hidden lg:flex lg:col-span-5 relative overflow-hidden bg-[#0B192C] text-white flex-col justify-between p-10 xl:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(30,86,136,0.38),transparent_60%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:44px_44px]"
        />

        {/* Top: Official UNSA Seal */}
        <div className="relative z-10 flex items-center gap-3.5">
          {!unsaSealFailed ? (
            <div className="w-12 h-12 rounded-full bg-white p-0.5 shrink-0 shadow-sm">
              <img
                src={UNSA_SEAL_LOGO}
                alt="Grb Univerziteta u Sarajevu"
                referrerPolicy="no-referrer"
                onError={() => setUnsaSealFailed(true)}
                className="w-full h-full object-contain rounded-full"
              />
            </div>
          ) : (
            <div className="w-11 h-11 rounded-full bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-white">
              Univerzitet u Sarajevu
            </div>
            <div className="text-xs text-slate-300/80">
              Universitas Studiorum Saraievoensis
            </div>
          </div>
        </div>

        {/* Center: Official ETF Emblem & Institutional Title */}
        <div className="relative z-10 my-auto py-12 space-y-6">
          {!etfMarkFailed ? (
            <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/15 bg-[#091526] shadow-sm">
              <img
                src={ETF_DARK_MARK}
                alt="ETF Sarajevo znak"
                referrerPolicy="no-referrer"
                onError={() => setEtfMarkFailed(true)}
                className="w-full h-full object-cover"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <h1
              className="text-3xl xl:text-4xl font-bold tracking-tight text-white leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Elektrotehnički fakultet Sarajevo
            </h1>
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span className="font-semibold text-sky-300">VOLTRA</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-xs text-slate-300/90">
                2026/2027
              </span>
            </div>
          </div>
        </div>

        {/* Bottom: Quiet Institutional Location */}
        <div className="relative z-10 pt-6 border-t border-white/10 flex items-center justify-between gap-4 text-xs text-slate-400">
          <span>Zmaja od Bosne bb, Kampus Univerziteta</span>
          <span className="font-mono tabular-nums shrink-0">71000 Sarajevo</span>
        </div>
      </aside>

      {/* Right Sign-In Workspace */}
      <main className="lg:col-span-7 flex flex-col justify-between min-h-screen bg-slate-50/70 px-6 py-8 sm:px-10">
        {/* Top Mobile Institutional Strip (visible only below lg) */}
        <div className="lg:hidden flex items-center justify-between gap-3 pb-4 border-b border-slate-200/80">
          <div className="flex items-center gap-2.5 min-w-0">
            {!unsaSealFailed && (
              <img
                src={UNSA_SEAL_LOGO}
                alt="Univerzitet u Sarajevu"
                referrerPolicy="no-referrer"
                onError={() => setUnsaSealFailed(true)}
                className="w-8 h-8 object-contain shrink-0"
              />
            )}
            <span className="text-xs font-medium text-slate-600 truncate">
              Univerzitet u Sarajevu
            </span>
          </div>
          <span className="text-xs font-semibold text-[#1E5688] shrink-0">VOLTRA</span>
        </div>

        {/* Spacer for desktop vertical centering */}
        <div className="hidden lg:block" />

        {/* Centered Login Container */}
        <div className="w-full max-w-[420px] mx-auto my-8 space-y-7">
          {/* Official ETF Horizontal Logo */}
          <div className="flex flex-col items-center text-center space-y-4">
            {!etfHorizontalFailed ? (
              <img
                src={ETF_HORIZONTAL_LOGO}
                alt="Univerzitet u Sarajevu — Elektrotehnički fakultet Sarajevo"
                referrerPolicy="no-referrer"
                onError={() => setEtfHorizontalFailed(true)}
                className="h-14 sm:h-16 w-auto object-contain select-none"
              />
            ) : (
              <div className="text-xl font-bold tracking-tight text-slate-900">
                Elektrotehnički fakultet Sarajevo
              </div>
            )}
          </div>

          {/* Single-Elevation Sign-In Card */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xs">
            <div className="mb-6">
              <h2 className="text-xl font-bold tracking-tight text-slate-900">Prijava</h2>
              <p className="text-xs text-slate-500 mt-1">
                Unesite pristupne podatke vašeg naloga
              </p>
            </div>

            {authError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                {authError}
              </div>
            )}

            <form onSubmit={handleCredentialSubmit} className="space-y-4">
              <div>
                <Label htmlFor="login-email">E-mail adresa</Label>
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
                  className="h-11 mt-1"
                  required
                />
              </div>

              <div>
                <Label htmlFor="login-password">Lozinka</Label>
                <div className="relative mt-1">
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (authError) clearAuthError();
                    }}
                    placeholder="Unesite lozinku"
                    className="h-11 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    aria-label={showPassword ? 'Sakrij lozinku' : 'Prikaži lozinku'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={signingIn}
                size="lg"
                className="w-full h-11 text-sm font-semibold bg-[#1E5688] hover:bg-[#164269] text-white whitespace-nowrap"
              >
                {signingIn ? 'Prijava u toku...' : 'Prijavi se'}
              </Button>
            </form>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-slate-400">ili</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={signInWithGoogle}
              disabled={signingIn}
              size="lg"
              className="w-full h-11 text-sm font-medium bg-white border-slate-200 hover:bg-slate-50 text-slate-700 whitespace-nowrap"
            >
              <GoogleMarkSvg />
              <span>Prijava putem Google računa</span>
            </Button>
          </div>
        </div>

        {/* Quiet Copyright Footer */}
        <footer className="text-center text-xs text-slate-400 pt-2">
          © Elektrotehnički fakultet Univerziteta u Sarajevu
        </footer>
      </main>
    </div>
  );
}
