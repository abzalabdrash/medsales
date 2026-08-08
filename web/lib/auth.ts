"use client";

import { useSyncExternalStore } from "react";
import {
  setServerSync,
  hydrateFromServer,
  clearLocal,
} from "./profile";

export type AuthUser = { id: string; phone: string };
type AuthState = { user: AuthUser | null; loading: boolean };

let _state: AuthState = { user: null, loading: true };
const _listeners = new Set<() => void>();
let _started = false;

function emit() {
  for (const l of _listeners) l();
}
function set(next: Partial<AuthState>) {
  _state = { ..._state, ...next };
  emit();
}

async function applyUser(user: AuthUser | null) {
  if (user) {
    setServerSync(true);
    await hydrateFromServer();
  } else {
    setServerSync(false);
  }
  set({ user, loading: false });
}

async function bootstrap() {
  try {
    const r = await fetch("/api/auth/me");
    const { user } = await r.json();
    await applyUser(user ?? null);
  } catch {
    set({ user: null, loading: false });
  }
}

export async function login(phone: string, password: string): Promise<string | null> {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return body.error || "error";
  await applyUser(body.user);
  return null;
}

export async function register(
  phone: string,
  password: string,
): Promise<string | null> {
  const r = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return body.error || "error";
  await applyUser(body.user);
  return null;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  clearLocal();
  await applyUser(null);
}

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  if (!_started) {
    _started = true;
    bootstrap();
  }
  return () => _listeners.delete(cb);
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    subscribe,
    () => _state,
    () => ({ user: null, loading: true }),
  );
}
