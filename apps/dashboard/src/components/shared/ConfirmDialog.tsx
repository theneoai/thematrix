'use client';

import { useRef, useEffect } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';


interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'default',
  loading = false,
}: ConfirmDialogProps) {
  const hasConfirmed = useRef(false);

  // Reset double-click guard when dialog opens
  useEffect(() => {
    if (open) hasConfirmed.current = false;
  }, [open]);

  const handleConfirm = () => {
    if (hasConfirmed.current || loading) return;
    hasConfirmed.current = true;
    onConfirm();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-foreground-muted">{message}</p>
    </Modal>
  );
}
