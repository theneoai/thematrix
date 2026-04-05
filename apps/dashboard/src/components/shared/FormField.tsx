'use client';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function FormField({ label, htmlFor, error, hint, required, children }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-foreground-subtle">{hint}</p>}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

// Shared input classNames
export const inputClassName =
  'w-full rounded-md border border-border bg-background-tertiary px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent focus:ring-1 focus:ring-accent transition-colors';

export const selectClassName =
  'w-full rounded-md border border-border bg-background-tertiary px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors';
