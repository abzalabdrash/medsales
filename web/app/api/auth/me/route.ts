import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { userFromSession, getUserData, SESSION_COOKIE } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = userFromSession(token);
  if (!user) return NextResponse.json({ user: null, data: null });
  let data: unknown = {};
  try {
    data = JSON.parse(getUserData(user.id));
  } catch {
    data = {};
  }
  return NextResponse.json({ user, data });
}
