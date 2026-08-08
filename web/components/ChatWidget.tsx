"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { X, Send, Sparkles } from "lucide-react";
import { useI18n } from "./I18nProvider";
import { chatT } from "@/lib/i18n";
import { resolveCity } from "@/lib/cities";
import { useUserCoords } from "@/lib/profile";

type Msg = { role: "user" | "assistant"; content: string };

// Minimal renderer: turns [text](url) into links, leaves the rest as text.
function renderContent(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a
        key={key++}
        href={m[2]}
        className="font-medium text-brand-ink underline underline-offset-2"
      >
        {m[1]}
      </a>,
    );
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ChatWidget() {
  const { locale } = useI18n();
  const tc = chatT(locale);
  const params = useSearchParams();
  const city = resolveCity(params.get("city"));
  const { coords, request } = useUserCoords();

  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open]);

  function openPanel() {
    setOpen(true);
    request();
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, city, coords, locale }),
      });
      if (!res.body) throw new Error("no body");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs((cur) => {
          const copy = cur.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch {
      setMsgs((cur) => {
        const copy = cur.slice();
        copy[copy.length - 1] = { role: "assistant", content: tc.error };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={openPanel}
          aria-label={tc.button}
          className="pressable fixed bottom-5 right-5 z-50 flex h-14 items-center gap-2 rounded-full bg-brand px-5 font-semibold text-white shadow-xl shadow-brand/25"
        >
          <Sparkles size={20} strokeWidth={2.2} aria-hidden />
          <span className="hidden sm:inline">{tc.button}</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex max-h-[76vh] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-3xl border border-line bg-paper shadow-2xl shadow-ink/10">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles size={18} className="text-brand-ink" aria-hidden />
              {tc.title}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={tc.close}
              className="pressable rounded-lg p-1.5 text-muted"
            >
              <X size={20} aria-hidden />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <p className="text-muted">{tc.greeting}</p>
                <div className="space-y-2">
                  {[tc.s1, tc.s2, tc.s3].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="pressable block w-full rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto w-fit max-w-[85%] rounded-2xl bg-brand px-3.5 py-2 text-white"
                    : "mr-auto w-fit max-w-[92%] whitespace-pre-wrap rounded-2xl bg-surface px-3.5 py-2 text-ink"
                }
              >
                {m.role === "assistant"
                  ? m.content === "" && busy
                    ? tc.thinking
                    : renderContent(m.content)
                  : m.content}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={onSubmit}
            className="flex items-center gap-2 border-t border-line px-3 py-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={tc.placeholder}
              className="min-h-[44px] flex-1 rounded-xl border border-line bg-paper px-3 outline-none focus:border-brand"
            />
            <button
              type="submit"
              disabled={busy || input.trim().length === 0}
              aria-label={tc.send}
              className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white disabled:opacity-40"
            >
              <Send size={18} aria-hidden />
            </button>
          </form>
          <p className="px-4 pb-3 text-center text-xs text-muted">
            {tc.disclaimer}
          </p>
        </div>
      )}
    </>
  );
}
