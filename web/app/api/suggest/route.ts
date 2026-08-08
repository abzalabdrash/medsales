import { NextResponse } from "next/server";
import { searchServices } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ items: searchServices(q, 8) });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
