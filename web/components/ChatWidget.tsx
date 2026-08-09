"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { X, Send, Sparkles, ImagePlus, Loader2 } from "lucide-react";
import { useI18n } from "./I18nProvider";
import { chatT } from "@/lib/i18n";
import { resolveCity } from "@/lib/cities";
import { AgentCard, PrescriptionCard } from "./agent/AgentCards";
import type { Card } from "@/lib/agent/cards";

/**
 * Помощник.
 *
 * Ответ приходит потоком событий, а не одним текстом: пока модель думает,
 * человек уже видит найденные аптеки. Карточки собирает сервер из строк базы,
 * поэтому цену и адрес в них невозможно выдумать.
 *
 * Главный вход это фотография назначения. Набирать названия препаратов с
 * листа руками никто не станет, а сфотографировать может каждый.
 */

type Block =
  | { type: "text"; text: string }
  | { type: "card"; card: Card }
  | { type: "prescription"; items: PrescriptionItem[] };

type PrescriptionItem = {
  name: string;
  dosage?: string | null;
  timesPerDay?: number | null;
  days?: number | null;
  confidence?: number | null;
};

type Msg =
  | { role: "user"; content: string; image?: string }
  | { role: "assistant"; blocks: Block[] };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function ChatWidget() {
  const { locale } = useI18n();
  const tc = chatT(locale);
  const params = useSearchParams();
  const city = resolveCity(params.get("city"));

  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, status, open]);

  /** История для сервера: только текст, карточки он соберет заново сам. */
  function textHistory(list: Msg[]) {
    return list.map((m) =>
      m.role === "user"
        ? { role: "user" as const, content: m.content }
        : {
            role: "assistant" as const,
            content: m.blocks
              .filter((b): b is { type: "text"; text: string } => b.type === "text")
              .map((b) => b.text)
              .join(""),
          },
    );
  }

  async function send(text: string, image?: string) {
    if (busy) return;
    const q = text.trim();
    if (!q && !image) return;

    const history: Msg[] = [
      ...msgs,
      { role: "user", content: q || "Фото назначения", image },
    ];
    setMsgs([...history, { role: "assistant", blocks: [] }]);
    setInput("");
    setBusy(true);
    setStatus(tc.thinking);

    const pushBlock = (b: Block) =>
      setMsgs((cur) => {
        const copy = cur.slice();
        const last = copy[copy.length - 1];
        if (last?.role !== "assistant") return cur;
        const blocks = last.blocks.slice();
        const tail = blocks[blocks.length - 1];
        // Текст склеиваем в один блок, чтобы поток не рвал абзац на куски
        if (b.type === "text" && tail?.type === "text") {
          blocks[blocks.length - 1] = { type: "text", text: tail.text + b.text };
        } else {
          blocks.push(b);
        }
        copy[copy.length - 1] = { role: "assistant", blocks };
        return copy;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: textHistory(history),
          city,
          locale,
          image,
        }),
      });
      if (!res.body) throw new Error("no body");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let e: { t: string; v?: unknown };
          try {
            e = JSON.parse(line);
          } catch {
            continue;
          }
          if (e.t === "text") pushBlock({ type: "text", text: String(e.v) });
          else if (e.t === "card") pushBlock({ type: "card", card: e.v as Card });
          else if (e.t === "prescription")
            pushBlock({ type: "prescription", items: e.v as PrescriptionItem[] });
          else if (e.t === "status") setStatus(String(e.v));
          else if (e.t === "error") pushBlock({ type: "text", text: String(e.v) });
        }
      }
    } catch {
      pushBlock({ type: "text", text: tc.error });
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setMsgs((cur) => [
        ...cur,
        {
          role: "assistant",
          blocks: [{ type: "text", text: "Снимок слишком большой, нужен файл до 8 МБ." }],
        },
      ]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => send(input, String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={tc.button}
          className="pressable fixed bottom-5 right-5 z-50 flex h-14 items-center gap-2 rounded-full bg-brand px-5 font-semibold text-white shadow-xl shadow-brand/25"
        >
          <Sparkles size={20} strokeWidth={2.2} aria-hidden />
          <span className="hidden sm:inline">{tc.button}</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex max-h-[82vh] w-[min(440px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-3xl border border-line bg-paper shadow-2xl shadow-ink/10">
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
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="pressable flex w-full items-center gap-3 rounded-xl border border-dashed border-brand/40 bg-brand-wash px-3 py-4 text-left"
                >
                  <ImagePlus size={22} className="shrink-0 text-brand-ink" aria-hidden />
                  <span>
                    <span className="block text-sm font-semibold text-ink">
                      Загрузите фото назначения
                    </span>
                    <span className="block text-xs text-muted">
                      Найду, где купить дешевле, и посчитаю курс
                    </span>
                  </span>
                </button>
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

            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-brand px-3.5 py-2 text-white">
                  {m.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.image}
                      alt="Фото назначения"
                      className="mb-1.5 max-h-40 rounded-lg object-cover"
                    />
                  )}
                  {m.content}
                </div>
              ) : (
                <div key={i} className="space-y-2">
                  {m.blocks.map((b, j) =>
                    b.type === "text" ? (
                      <p key={j} className="mr-auto w-fit max-w-[95%] whitespace-pre-wrap rounded-2xl bg-surface px-3.5 py-2 text-ink">
                        {b.text}
                      </p>
                    ) : b.type === "prescription" ? (
                      <PrescriptionCard key={j} items={b.items} />
                    ) : (
                      <AgentCard key={j} card={b.card} />
                    ),
                  )}
                </div>
              ),
            )}

            {busy && status && (
              <p className="flex items-center gap-2 text-xs text-muted">
                <Loader2 size={13} className="animate-spin" aria-hidden />
                {status}
              </p>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-line px-3 py-3"
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onPickFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              aria-label="Прикрепить фото назначения"
              className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted disabled:opacity-40"
            >
              <ImagePlus size={18} aria-hidden />
            </button>
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
          <p className="px-4 pb-3 text-center text-xs text-muted">{tc.disclaimer}</p>
        </div>
      )}
    </>
  );
}
