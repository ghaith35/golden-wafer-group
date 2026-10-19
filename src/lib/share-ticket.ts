"use client";

/// Facture PDF save/share for the van phone (replaces the old WhatsApp-text
/// flow — the driver now gets a real A4 facture he can keep or forward).
/// Never throws; returns where the file went for UI feedback.
///
/// 1. native APK: write into the app Cache (the only dir the Share
///    FileProvider grants by default — Documents/public dirs throw
///    "sharing not allowed", which used to surface as a silent "saved"
///    with no chooser) + open the system share sheet via the `files`
///    array (WhatsApp / gallery / Drive / … — the driver picks). The
///    sheet failing still leaves a copy in Documents → "saved".
/// 2. browsers: Web Share API with the file when available.
/// 3. fallback: classic blob download.
/// Fully offline: the blob is built in memory, no network anywhere.

export type PdfShareWhere = "shared" | "saved" | "failed";

function blobToB64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  });
}

export async function sharePdfFile(opts: {
  fileName: string;
  blob: Blob;
  title: string;
}): Promise<PdfShareWhere> {
  const { fileName, blob, title } = opts;
  if (typeof window === "undefined") return "failed";
  // 1. Native first: Cache dir (FileProvider-shareable) + `files` array
  // (the `url`-only + Documents combo is rejected by the Share plugin on
  // Android 10+ scoped storage → silent "saved" with no chooser).
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      try {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const base64 = await blobToB64(blob);
        await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
        try {
          const { Share } = await import("@capacitor/share");
          const uri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
          await Share.share({ title, text: title, dialogTitle: title, files: [uri.uri] });
          return "shared";
        } catch {
          // Chooser failed/dismissed: keep a user-visible copy in Documents
          // so "saved" is truthful (Cache is app-private).
          try {
            await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Documents });
          } catch {
            /* cache copy still exists */
          }
          return "saved";
        }
      } catch {
        /* fall through to browser methods */
      }
    }
  } catch {
    /* not native — fall through */
  }
  // 2. Web Share API with the file.
  try {
    const file = new File([blob], fileName, { type: "application/pdf" });
    const nav = navigator as Navigator & {
      canShare?: (d: { files: File[] }) => boolean;
      share?: (d: { files: File[]; title?: string }) => Promise<void>;
    };
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title });
      return "shared";
    }
  } catch {
    /* dismissed or impossible — fall through to download */
  }
  // 3. Classic download.
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    return "saved";
  } catch {
    return "failed";
  }
}

/// Save-only sibling: writes into Documents (native) or downloads (web),
/// never opens the share sheet. For the viewer's explicit Save button.
export async function savePdfFile(opts: {
  fileName: string;
  blob: Blob;
}): Promise<"saved" | "failed"> {
  const { fileName, blob } = opts;
  if (typeof window === "undefined") return "failed";
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      try {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        await Filesystem.writeFile({
          path: fileName,
          data: await blobToB64(blob),
          directory: Directory.Documents,
        });
        return "saved";
      } catch {
        /* fall through to browser methods */
      }
    }
  } catch {
    /* not native — fall through */
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    return "saved";
  } catch {
    return "failed";
  }
}
