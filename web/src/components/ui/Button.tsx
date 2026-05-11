import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Size = 'md' | 'lg';

interface PrimaryProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size;
  children: ReactNode;
}

export function PrimaryBtn({ size = 'md', className = '', children, ...rest }: PrimaryProps) {
  const big = size === 'lg';
  const sizing = big ? 'h-[60px] min-w-[200px] px-9 text-[15px] tracking-[2px]' : 'h-10 px-5 text-[11px] tracking-[1.5px]';
  return (
    <button
      type="button"
      {...rest}
      className={`${sizing} rounded-md border-0 bg-accent font-headline text-accent-fg shadow-btn-lg disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

interface GhostProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean;
  children: ReactNode;
}

export function GhostBtn({ danger, className = '', children, ...rest }: GhostProps) {
  const color = danger ? 'border-danger text-danger hover:bg-danger/10' : 'border-line text-text hover:bg-panel-2';
  return (
    <button
      type="button"
      {...rest}
      className={`h-10 rounded-md border bg-transparent px-3.5 text-[13px] font-medium ${color} disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}
