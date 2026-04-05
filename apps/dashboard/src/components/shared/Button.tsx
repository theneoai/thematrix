'use client';

import { clsx } from 'clsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: React.ReactNode;
}

const variants = {
  primary: 'bg-accent text-white hover:bg-accent/80 border-accent',
  secondary: 'bg-background-tertiary text-foreground border-border hover:bg-background-tertiary/80 hover:border-border-hover',
  danger: 'bg-error text-white hover:bg-error/80 border-error',
  ghost: 'text-foreground-muted hover:bg-background-tertiary hover:text-foreground border-transparent',
};

const sizes = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-1.5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors',
        variants[variant],
        sizes[size],
        (disabled || loading) && 'pointer-events-none opacity-50',
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : icon ? (
        <span className="text-sm">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
