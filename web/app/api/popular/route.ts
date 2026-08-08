import { NextResponse } from "next/server";
import { getPopularServices } from "@/lib/db";
import { resolveCity } from "@/lib/cities";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const city = resolveCity(new URL(req.url).searchParams.get("city"));
  try {
    return NextResponse.json({ items: getPopularServices(city, 8) });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
