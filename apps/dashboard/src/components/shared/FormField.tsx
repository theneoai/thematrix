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
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="space-y-1.5" role="group" aria-labelledby={htmlFor ? `${htmlFor}-label` : undefined}>
      <label
        id={htmlFor ? `${htmlFor}-label` : undefined}
        htmlFor={htmlFor}
        className="block text-sm font-medium text-foreground"
      >
        {label}
        {required && <span className="ml-0.5 text-error" aria-hidden="true">*</span>}
      </label>
      {/* Children should use aria-describedby={describedBy} and aria-required={required} */}
      {children}
      {hint && !error && <p id={hintId} className="text-xs text-foreground-subtle">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-error" role="alert">{error}</p>}
    </div>
  );
}

// Shared input classNames
export const inputClassName =
  'w-full rounded-md border border-border bg-background-tertiary px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent focus:ring-1 focus:ring-accent transition-colors';

export const selectClassName =
  'w-full rounded-md border border-border bg-background-tertiary px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors';
