"use client";

/// Print trigger for server-rendered print pages (a server component cannot
/// carry onClick handlers).
/// printScope: isolate a `.ticket-print-scope` subtree for printing (hides
/// the app shell/sidebar — needed on pages rendered inside the staff layout
/// and in preview popups). Plain window.print() otherwise.
export function PrintButton({ label, className, printScope }: { label: string; className?: string; printScope?: boolean }) {
  const onPrint = () => {
    if (!printScope) {
      window.print();
      return;
    }
    document.body.classList.add("ticket-printing");
    const done = () => document.body.classList.remove("ticket-printing");
    window.addEventListener("afterprint", done, { once: true });
    window.setTimeout(done, 2500);
    window.print();
  };
  return (
    <button
      onClick={onPrint}
      className={className ?? "rounded-lg bg-black px-4 py-2 text-sm font-bold text-white"}
    >
      {label}
    </button>
  );
}
