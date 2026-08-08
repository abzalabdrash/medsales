import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  userFromSession,
  getUserData,
  setUserData,
  SESSION_COOKIE,
} from "@/lib/users";

export const dynamic = "force-dynamic";

async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userFromSession(token);
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let data: unknown = {};
  try {
    data = JSON.parse(getUserData(user.id));
  } catch {
    data = {};
  }
  return NextResponse.json({ data });
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { data } = await req.json();
    // store as-is (the client owns the Profile shape); cap size defensively
    const json = JSON.stringify(data ?? {});
    if (json.length > 200_000) throw new Error("too_large");
    setUserData(user.id, json);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
}
