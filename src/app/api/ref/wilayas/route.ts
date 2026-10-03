import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const wilayas = await prisma.wilaya.findMany({ orderBy: { code: "asc" } });
  return NextResponse.json(wilayas);
}
