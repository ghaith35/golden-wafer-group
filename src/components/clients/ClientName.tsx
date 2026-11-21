"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { clientLabel, clientMapsUrl } from "@/lib/clients/display";

/// The one way a client name is shown: direction-isolated (<bdi>, so Arabic +
/// Latin names never jumble), truncating, one fallback rule, and — when the
/// client has GPS — a round pin button right beside the name that opens their
/// location in Google Maps (the Maps app on a phone).
/// The pin is a span, not <a>/<button>, so it is valid inside rows that are
/// themselves buttons/links; it stops the click from also opening the row.
export function ClientName({
  name,
  fallback,
  lat,
  lng,
  className,
  map = true,
  mapLabel,
}: {
  name: string | null | undefined;
  /// Text when there is no name (e.g. the localized "walk-in").
  fallback?: string;
  lat?: unknown;
  lng?: unknown;
  className?: string;
  /// false → name only (the surrounding UI already has its own map link).
  map?: boolean;
  mapLabel?: string;
}) {
  const t = useTranslations("common");
  const label = mapLabel ?? t("openMap");
  const url = map ? clientMapsUrl(lat, lng) : null;
  const open = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle">
      <bdi dir="auto" className={cn("min-w-0 truncate", className)}>
        {clientLabel(name, fallback)}
      </bdi>
      {url && (
        <span
          role="link"
          tabIndex={0}
          aria-label={label}
          title={label}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") open(e);
          }}
          className="relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-(--brand-500)/15 text-(--brand-600) transition-transform before:absolute before:-inset-1.5 before:content-[''] hover:bg-(--brand-500)/30 active:scale-90"
        >
          <MapPin size={14} strokeWidth={2.4} />
        </span>
      )}
    </span>
  );
}
