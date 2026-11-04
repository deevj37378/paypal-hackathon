"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Two-step inline confirmation (no native confirm() dialogs). */
export function ConfirmButton({
  label,
  confirmLabel,
  question,
  onConfirm,
  disabled,
  ariaLabel,
}: {
  label: string;
  confirmLabel: string;
  question: string;
  onConfirm: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="destructive" size="sm" disabled={disabled} onClick={() => setAsking(true)} aria-label={ariaLabel}>
        {label}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={question} className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="text-xs text-muted-foreground">{question}</span>
      <Button
        size="sm"
        variant="destructive"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </div>
  );
}
