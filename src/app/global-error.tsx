"use client";

import { PageRecovery } from "@/components/recovery/PageRecovery";

export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <html><body><PageRecovery {...props} /></body></html>;
}
