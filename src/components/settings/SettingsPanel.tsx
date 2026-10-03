import { useTranslations } from "next-intl";

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

export function useSectionText(labelKey: string, descriptionKey: string) {
  const t = useTranslations("settings");
  return { title: t(`sections.${labelKey}`), description: t(`sections.${descriptionKey}`) };
}
