import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createUser,
  createSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { phone, password } = await req.json();
    const user = createUser(String(phone ?? ""), String(password ?? ""));
    const token = createSession(user.id);
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return NextResponse.json({ user });
  } catch (e) {
    const code = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
