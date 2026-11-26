import { haptic } from "@/lib/motion";

export type ToastKind = "success" | "error" | "info";
export type ToastDetail = { id: number; kind: ToastKind; msg: string; ms: number };

let seq = 0;
/// Fire-and-forget toast from anywhere (client code). Rendered by <Toaster/>.
function emit(kind: ToastKind, msg: string, ms = 3800) {
  if (typeof window === "undefined" || !msg) return;
  haptic(kind === "success" ? "success" : kind === "error" ? "error" : "tap");
  window.dispatchEvent(new CustomEvent<ToastDetail>("gw-toast", { detail: { id: ++seq, kind, msg, ms } }));
}

export const toast = Object.assign((msg: string, ms?: number) => emit("info", msg, ms), {
  success: (msg: string, ms?: number) => emit("success", msg, ms),
  error: (msg: string, ms?: number) => emit("error", msg, ms ?? 5000),
  info: (msg: string, ms?: number) => emit("info", msg, ms),
});
