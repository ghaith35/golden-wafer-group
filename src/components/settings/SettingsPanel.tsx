import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

import { ErrText } from "@/components/ui/ErrText";
/// Section header: title + description, like Khiata's SettingsPanel heading.
export function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 flex-1 space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-(--text-primary)">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-(--text-secondary)">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/// Bordered settings card: rows are divided, never boxed (Khiata ui-panel).
export function SettingsCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-[18px] border border-(--border-default) bg-(--bg-overlay) shadow-[0_12px_40px_rgba(15,14,13,0.045)]", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-(--border-default) px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-(--text-primary)">{title}</h3>
          {description && (
            <p className="mt-0.5 max-w-[65ch] text-[11px] font-semibold leading-5 text-(--text-secondary)">{description}</p>
          )}
        </div>
        {action}
      </header>
      <div className="divide-y divide-(--border-default)">{children}</div>
    </section>
  );
}

/// One label + control row: stacked on mobile, label | 280px control on sm+.
export function SettingRow({
  label,
  description,
  error,
  stacked = false,
  children,
}: {
  label: string;
  description?: string;
  error?: string;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("gap-x-6 gap-y-2.5 px-4 py-4 sm:px-5", stacked ? "flex flex-col" : "flex flex-col sm:flex-row sm:items-start sm:justify-between")}>
      <div className="min-w-0 sm:max-w-[58%]">
        <span className="block text-[13px] font-black text-(--text-primary)">{label}</span>
        {description && (
          <span className="mt-1 block max-w-[65ch] text-[11px] font-semibold leading-5 text-(--text-secondary)">{description}</span>
        )}
      </div>
      <div className={stacked ? "w-full" : "w-full sm:w-[280px] sm:shrink-0"}>
        {children}
        {error && <p className="mt-1.5 text-[11px] font-black text-red-500"><ErrText code={error} /></p>}
      </div>
    </div>
  );
}

export function useSectionText(labelKey: string, descriptionKey: string) {
  const t = useTranslations("settings");
  return { title: t(`sections.${labelKey}`), description: t(`sections.${descriptionKey}`) };
}
