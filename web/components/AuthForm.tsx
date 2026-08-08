"use client";

import { useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { login, register } from "@/lib/auth";
import { useI18n } from "./I18nProvider";
import type { Dict } from "@/lib/i18n";

function errorText(t: Dict, code: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    exists: t.authErrExists,
    bad_phone: t.authErrBadPhone,
    weak_password: t.authErrWeak,
    bad_credentials: t.authErrBadCreds,
  };
  return map[code] ?? t.authErrGeneric;
}

export function AuthForm() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const code =
      mode === "login"
        ? await login(phone, password)
        : await register(phone, password);
    if (code) setErr(code);
    setBusy(false);
  }

  const Icon = mode === "login" ? LogIn : UserPlus;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="mb-4 text-muted">{t.authGuestNote}</p>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          {t.authPhone}
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setErr(null);
            }}
            placeholder="+7 700 000 00 00"
            className="min-h-[52px] rounded-xl border border-line bg-paper px-3 text-base text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          {t.authPassword}
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="min-h-[52px] rounded-xl border border-line bg-paper px-3 text-base text-ink"
          />
        </label>

        {err && <p className="text-sm text-brand-ink">{errorText(t, err)}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={busy || phone.trim().length < 5 || password.length < 4}
          className="pressable inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-40"
        >
          <Icon size={20} aria-hidden />
          {mode === "login" ? t.authLogin : t.authRegister}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "login" ? "register" : "login"));
            setErr(null);
          }}
          className="pressable min-h-[44px] text-sm font-medium text-brand-ink"
        >
          {mode === "login" ? t.authToRegister : t.authToLogin}
        </button>
      </div>
    </div>
  );
}
