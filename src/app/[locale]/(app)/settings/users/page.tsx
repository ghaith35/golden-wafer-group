import { redirect } from "next/navigation";

// Users moved out of Settings → standalone /[locale]/users section.
// Keep old deep links working (e.g. ?new=Livreur).
export default async function SettingsUsersRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = (await searchParams) ?? {};
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v) && v[0] !== undefined) qs.set(k, v[0]);
  }
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  redirect(`/${locale}/users${suffix}`);
}
