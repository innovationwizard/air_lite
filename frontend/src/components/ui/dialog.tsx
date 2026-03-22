'use client';

import React from 'react';

type DialogProps = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      onClick={() => onOpenChange?.(false)}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

type DialogContentProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

export function DialogContent({ children, className = '', ...rest }: DialogContentProps) {
  return (
    <div
      className={`bg-white rounded-lg shadow-lg border w-full max-w-xl ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

type DialogHeaderProps = { children: React.ReactNode };
export function DialogHeader({ children }: DialogHeaderProps) {
  return (
    <div className="p-6 border-b">
      {children}
    </div>
  );
}

type DialogTitleProps = { children: React.ReactNode; className?: string };
export function DialogTitle({ children, className = '' }: DialogTitleProps) {
  return <h2 className={`text-xl font-semibold ${className}`}>{children}</h2>;
}

type DialogDescriptionProps = { children: React.ReactNode; className?: string };
export function DialogDescription({ children, className = '' }: DialogDescriptionProps) {
  return <p className={`text-sm text-gray-600 mt-1 ${className}`}>{children}</p>;
}

type DialogFooterProps = { children: React.ReactNode; className?: string };
export function DialogFooter({ children, className = '' }: DialogFooterProps) {
  return (
    <div className={`p-6 border-t flex justify-end gap-2 ${className}`}>
      {children}
    </div>
  );
}

