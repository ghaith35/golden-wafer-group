/// Smooth height expand/collapse (grid-rows 0fr→1fr — no JS measuring).
/// Children stay mounted but `inert` while closed.
export function Collapse({ open, children, className }: { open: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={`gw-collapse ${className ?? ""}`} data-open={open ? "true" : "false"} inert={!open} aria-hidden={!open}>
      <div>{children}</div>
    </div>
  );
}
