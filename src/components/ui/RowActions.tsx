"use client";

import Link from "next/link";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/// Colored row actions (proformat-style tinted icon buttons):
/// details = sky, modify = amber, delete = red. Dark-mode safe.
export function RowActions({
  detailsHref,
  onDetails,
  onEdit,
  onDelete,
  labels,
  size = "sm",
}: {
  detailsHref?: string;
  onDetails?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  labels: { details: string; edit: string; delete: string };
  size?: "sm" | "md";
}) {
  const btn = cn(
    "flex shrink-0 items-center justify-center rounded-lg transition-colors",
    size === "sm" ? "h-11 w-11 lg:h-8 lg:w-8" : "h-11 w-11 lg:h-10 lg:w-10"
  );
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {detailsHref ? (
        <Link
          href={detailsHref}
          title={labels.details}
          aria-label={labels.details}
          className={cn(btn, "bg-sky-500/15 text-sky-600 hover:bg-sky-500/25")}
        >
          <FileText size={15} />
        </Link>
      ) : (
        onDetails && (
          <button
            type="button"
            title={labels.details}
            aria-label={labels.details}
            onClick={onDetails}
            className={cn(btn, "bg-sky-500/15 text-sky-600 hover:bg-sky-500/25")}
          >
            <FileText size={15} />
          </button>
        )
      )}
      <button
        type="button"
        title={labels.edit}
        aria-label={labels.edit}
        onClick={onEdit}
        className={cn(btn, "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25")}
      >
        <Pencil size={15} />
      </button>
      <button
        type="button"
        title={labels.delete}
        aria-label={labels.delete}
        onClick={onDelete}
        className={cn(btn, "bg-red-500/15 text-red-500 hover:bg-red-500/25")}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
