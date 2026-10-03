"use client";

import { useState } from "react";

export function ImageUploader({
  images,
  onChange,
  addLabel,
}: {
  images: string[];
  onChange: (urls: string[]) => void;
  addLabel: string;
}) {
  const [busy, setBusy] = useState(false);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 8 - images.length)) {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        if (!res.ok) throw new Error("upload_failed");
        urls.push((await res.json()).url as string);
      }
      onChange([...images, ...urls]);
    } finally {
      setBusy(false);
    }
  }

  function move(i: number, dir: 1 | -1) {
    const next = [...images];
    const j = (i + dir + next.length) % next.length;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div>
      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {images.map((url, i) => (
          <div key={url} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="aspect-square w-full rounded-lg object-cover" />
            {i === 0 && <span className="absolute start-1 top-1 rounded bg-black/50 px-1 text-[10px] text-white">★</span>}
            <div className="absolute end-1 top-1 flex gap-1">
              <button type="button" onClick={() => move(i, -1)} className="flex min-h-9 min-w-9 items-center justify-center rounded bg-black/50 text-xs text-white">‹</button>
              <button type="button" onClick={() => move(i, 1)} className="flex min-h-9 min-w-9 items-center justify-center rounded bg-black/50 text-xs text-white">›</button>
              <button
                type="button"
                onClick={() => onChange(images.filter((_, j) => j !== i))}
                className="flex min-h-9 min-w-9 items-center justify-center rounded bg-black/50 text-xs text-white"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      <label
        className={
          "inline-flex h-10 cursor-pointer items-center justify-center rounded-lg bg-(--bg-sunken) px-4 text-sm font-semibold" +
          (busy || images.length >= 8 ? " pointer-events-none opacity-50" : "")
        }
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          disabled={busy || images.length >= 8}
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = "";
          }}
        />
        {addLabel} ({images.length}/8)
      </label>
    </div>
  );
}
