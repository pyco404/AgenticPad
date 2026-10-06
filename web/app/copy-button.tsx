"use client";

import { useState } from "react";

export function CopyButton({ value, label = "Copy", className = "text-accent underline" }: {
  value: string | (() => string); label?: string; className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof value === "function" ? value() : value);
      setState("copied");
    } catch { setState("failed"); }
  };
  return <span className="inline-flex flex-wrap items-center gap-2">
    <button type="button" onClick={() => void copy()} className={className} aria-label={label}>{label}</button>
    <span role="status" className="text-[11px] text-muted">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed. Please try again." : ""}</span>
  </span>;
}
