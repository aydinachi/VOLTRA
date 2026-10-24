import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'Došlo je do neočekivane greške.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed.error === 'string') {
        if (parsed.error.includes('Quota exceeded')) {
          readable =
            'Dnevna kvota baze podataka je privremeno prekoračena. Kvota se automatski obnavlja narednog dana.';
        } else {
          readable = `Greška pristupa podacima (${parsed.operationType || 'upit'}): ${parsed.error}`;
        }
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, errorMessage: readable };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-3 text-red-700 mb-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="text-base font-semibold text-slate-900">
                Greška u radu aplikacije
              </h1>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-5">
              {this.state.errorMessage}
            </p>
            <Button
              onClick={() => window.location.reload()}
              className="w-full"
            >
              <RefreshCw className="w-4 h-4" />
              Osvježi stranicu
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
