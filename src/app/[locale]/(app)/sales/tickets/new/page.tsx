import { OrderFormLoader } from "../../OrderFormLoader";
import { BackButton } from "@/components/ui/BackButton";

export default async function NewTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ channel?: string; locationId?: string; clientId?: string; tourneeId?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const channel = sp.channel === "POS" ? "POS" : sp.channel === "DEPOT" ? "DEPOT" : "VAN";
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/sales`} />
      <OrderFormLoader
        locale={locale}
        mode="ticket"
        channel={channel}
        preset={{ clientId: sp.clientId, locationId: sp.locationId, tourneeId: sp.tourneeId }}
      />
    </div>
  );
}
