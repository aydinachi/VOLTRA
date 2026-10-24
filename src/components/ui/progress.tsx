import * as React from 'react';
import { cn } from '../../lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  indicatorClassName?: string;
}

export function Progress({ value, className, indicatorClassName, ...props }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200/80', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      {...props}
    >
      <div
        className={cn(
          'h-full w-full flex-1 bg-blue-700 transition-transform duration-200 ease-out origin-left',
          indicatorClassName
        )}
        style={{ transform: `scaleX(${clamped / 100})` }}
      />
    </div>
  );
}
