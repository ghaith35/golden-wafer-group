import { cn } from "@/lib/utils";

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("gw-skel", className)} style={style} />;
}

/// Generic page placeholder used by route `loading.tsx`: header, stat row,
/// then a list of rows — shimmering until the real page streams in.
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6" role="status" aria-busy="true" aria-label="loading">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-10 w-28 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    </div>
  );
}
