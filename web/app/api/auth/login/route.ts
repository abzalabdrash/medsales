import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  verifyUser,
  createSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { phone, password } = await req.json();
    const user = verifyUser(String(phone ?? ""), String(password ?? ""));
    if (!user) {
      return NextResponse.json({ error: "bad_credentials" }, { status: 401 });
    }
    const token = createSession(user.id);
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: "error" }, { status: 400 });
  }
}
