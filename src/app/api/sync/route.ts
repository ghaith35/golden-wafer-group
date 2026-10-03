import { NextResponse } from "next/server";
import { syncSchema } from "@/lib/sync/validation";
import { handleSync } from "@/lib/sync/engine";

export async function POST(req: Request) {
  const parsed = syncSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(await handleSync(parsed.data));
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}
