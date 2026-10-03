"use client";

/// Print trigger for server-rendered print pages (a server component cannot
/// carry onClick handlers).
export function PrintButton({ label, className }: { label: string; className?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className={className ?? "rounded-lg bg-black px-4 py-2 text-sm font-bold text-white"}
    >
      {label}
    </button>
  );
}
