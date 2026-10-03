import crypto from "node:crypto";
import { prisma } from "@/lib/db";

/// Resolve the van an APK report belongs to.
/// - deviceToken: provisioned device (Settings → Devices)
/// - qrToken: staff QR login token (account card)
/// Returns company + van (van may be null when nothing is assigned).
export async function resolveTrackVan(deviceToken?: string | null, qrToken?: string | null): Promise<{
  companyId: string;
  vanId: string | null;
  deviceId: string | null;
} | null> {
  if (deviceToken) {
    const tokenHash = crypto.createHash("sha256").update(deviceToken).digest("hex");
    const device = await prisma.device.findFirst({
      where: { tokenHash, isActive: true },
      include: { location: { select: { id: true, kind: true, companyId: true } } },
    });
    if (!device) return null;
    let vanId: string | null = null;
    if (device.location && device.location.kind === "VAN") {
      vanId = device.location.id;
    } else if (device.userId) {
      const assigned = await prisma.store.findFirst({
        where: { userId: device.userId, companyId: device.companyId, kind: "VAN", isActive: true },
        select: { id: true },
      });
      vanId = assigned?.id ?? null;
    }
    return { companyId: device.companyId, vanId, deviceId: device.id };
  }
  if (qrToken) {
    const user = await prisma.user.findFirst({
      where: { qrToken, isActive: true },
      select: { id: true, companyId: true },
    });
    if (!user) return null;
    const assigned = await prisma.store.findFirst({
      where: { userId: user.id, companyId: user.companyId, kind: "VAN", isActive: true },
      select: { id: true },
    });
    return { companyId: user.companyId, vanId: assigned?.id ?? null, deviceId: null };
  }
  return null;
}
