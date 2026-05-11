import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

interface FieldShellProps {
  label?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function FieldShell({ label, hint, error, children, className = '' }: FieldShellProps) {
  return (
    <label className={`block ${className}`}>
      {label && <div className="mb-1.5 text-[11px] font-medium text-dim">{label}</div>}
      {children}
      {hint && !error && <div className="mt-1 text-[11px] text-sub">{hint}</div>}
      {error && <div className="mt-1 text-[11px] text-danger">{error}</div>}
    </label>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

// forwardRef is REQUIRED here — react-hook-form's `register()` returns a ref
// that needs to land on the underlying <input>. Without it RHF can't read
// the input's value at submit time and every field shows "Required".
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ mono, className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        {...rest}
        className={`w-full rounded-md border border-line bg-panel-2 px-3 py-2.5 text-[13px] text-text placeholder-sub outline-none focus:border-accent ${
          mono ? 'font-mono' : ''
        } ${className}`}
      />
    );
  },
);

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string }>;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField({ options, className = '', ...rest }, ref) {
    return (
      <select
        ref={ref}
        {...rest}
        className={`w-full rounded-md border border-line bg-panel-2 px-3 py-2.5 text-[13px] text-text outline-none focus:border-accent ${className}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  },
);
