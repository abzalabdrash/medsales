import { DatabaseSync } from "node:sqlite";
import { randomUUID, scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import path from "node:path";

// Real, lightweight account store in a SEPARATE writable SQLite file (the parser's
// medprice.db stays read-only). Phone + password, scrypt-hashed, server sessions.
// Runs fine on a long-lived local Node server — the file lives next to the app.
let _db: DatabaseSync | null = null;
function db(): DatabaseSync {
  if (!_db) {
    const p =
      process.env.MEDPRICE_USERS_DB ||
      path.resolve(process.cwd(), "..", "data", "users.db");
    _db = new DatabaseSync(p);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS user (
        id TEXT PRIMARY KEY,
        phone TEXT UNIQUE NOT NULL,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        data TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS session (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires INTEGER NOT NULL
      );
    `);
  }
  return _db;
}

const SESSION_DAYS = 30;

export type PublicUser = { id: string; phone: string };

// Normalize a KZ phone to 11 digits starting 77...; null if it doesn't look valid.
export function normalizePhone(raw: string): string | null {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length === 10 && d.startsWith("7")) d = "7" + d; // 7XXXXXXXXX -> 77...
  if (d.length === 11 && d[0] === "7" && d[1] === "7") return d;
  return null;
}

function hash(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function createUser(phone: string, password: string): PublicUser {
  const norm = normalizePhone(phone);
  if (!norm) throw new Error("bad_phone");
  if (password.length < 4) throw new Error("weak_password");
  const exists = db().prepare("SELECT id FROM user WHERE phone = ?").get(norm);
  if (exists) throw new Error("exists");
  const id = randomUUID();
  const salt = randomBytes(16).toString("hex");
  db()
    .prepare(
      "INSERT INTO user(id, phone, pass_hash, salt, data, created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(id, norm, hash(password, salt), salt, "{}", new Date().toISOString());
  return { id, phone: norm };
}

export function verifyUser(phone: string, password: string): PublicUser | null {
  const norm = normalizePhone(phone);
  if (!norm) return null;
  const row = db()
    .prepare("SELECT id, phone, pass_hash, salt FROM user WHERE phone = ?")
    .get(norm) as
    | { id: string; phone: string; pass_hash: string; salt: string }
    | undefined;
  if (!row) return null;
  const a = Buffer.from(hash(password, row.salt), "hex");
  const b = Buffer.from(row.pass_hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: row.id, phone: row.phone };
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  db()
    .prepare("INSERT INTO session(token, user_id, expires) VALUES(?,?,?)")
    .run(token, userId, expires);
  return token;
}

export function userFromSession(token: string | undefined): PublicUser | null {
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT u.id, u.phone, s.expires FROM session s
       JOIN user u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as { id: string; phone: string; expires: number } | undefined;
  if (!row) return null;
  if (row.expires < Date.now()) {
    deleteSession(token);
    return null;
  }
  return { id: row.id, phone: row.phone };
}

export function deleteSession(token: string | undefined): void {
  if (!token) return;
  db().prepare("DELETE FROM session WHERE token = ?").run(token);
}

export function getUserData(userId: string): string {
  const row = db().prepare("SELECT data FROM user WHERE id = ?").get(userId) as
    | { data: string | null }
    | undefined;
  return row?.data || "{}";
}

export function setUserData(userId: string, data: string): void {
  db().prepare("UPDATE user SET data = ? WHERE id = ?").run(data, userId);
}

export const SESSION_COOKIE = "mp_session";
export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;
