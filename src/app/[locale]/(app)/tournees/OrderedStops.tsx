"use client";

import { useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { SILENT_A11Y } from "@/lib/geo";

export type OrderedItem = { id: string; name: string; code: string };

/// Shared visit-order timeline: numbered circles on a progress line,
/// mouse-drag reorder (grip), ✕ to drop. Used by tour create + modify.
export function OrderedStops({
  items,
  onOrder,
  onRemove,
  metaText,
}: {
  items: OrderedItem[];
  onOrder: (ids: string[]) => void;
  onRemove: (id: string) => void;
  metaText?: (id: string) => string | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const activeName = activeId ? items.find((i) => i.id === activeId)?.name ?? "" : "";

  function handleEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onOrder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      accessibility={SILENT_A11Y}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={handleEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ol className="relative space-y-2 ps-1">
          {items.length === 0 && <p className="py-2 ps-4 text-xs opacity-60">—</p>}
          {items.map((item, i) => (
            <SortableRow
              key={item.id}
              id={item.id}
              index={i}
              last={i === items.length - 1}
              name={item.name}
              code={item.code}
              meta={metaText?.(item.id)}
              dimmed={!!activeId && activeId !== item.id}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </ol>
      </SortableContext>
      <DragOverlay>
        {activeId ? (
          <div className="rounded-xl border-2 border-(--brand-500) bg-(--bg-overlay) px-3 py-2 text-xs font-black opacity-90 shadow-xl">
            {activeName}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableRow({
  id,
  index,
  last,
  name,
  code,
  meta,
  dimmed,
  onRemove,
}: {
  id: string;
  index: number;
  last: boolean;
  name: string;
  code: string;
  meta: string | null | undefined;
  dimmed: boolean;
  onRemove: () => void;
}) {
  const {
    attributes: { "aria-describedby": _describedBy, ...safeAttrs },
    listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id });
  void _describedBy;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative flex items-center gap-2 rounded-xl bg-(--bg-sunken) p-2 ps-3", isDragging ? "opacity-40 shadow-lg" : dimmed ? "opacity-50" : "")}
    >
      {!last && (
        <span aria-hidden className="absolute start-[22px] top-full h-2 w-0.5 bg-(--brand-500)/40" />
      )}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--brand-500) text-xs font-black text-(--brand-contrast) shadow">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold leading-tight">{name}</span>
        <span className="block truncate font-mono text-[11px] opacity-50">
          {code}{meta ? <span className="font-bold text-sky-600"> · {meta}</span> : ""}
        </span>
      </span>
      <button
        type="button"
        {...safeAttrs}
        {...listeners}
        aria-label="drag"
        className="touch-none flex h-9 w-9 shrink-0 cursor-grab items-center justify-center rounded-lg opacity-40 hover:bg-(--bg-overlay) hover:opacity-100 active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={15} />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="remove"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg opacity-40 hover:bg-red-500/10 hover:text-red-500 hover:opacity-100"
      >
        ✕
      </button>
    </li>
  );
}
