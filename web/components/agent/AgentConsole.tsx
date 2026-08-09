"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ImagePlus, Loader2, ArrowUp, Camera, X } from "lucide-react";
import { resolveCity } from "@/lib/cities";
import { useI18n } from "../I18nProvider";
import { AgentCard, PrescriptionCard } from "./AgentCards";
import type { Card } from "@/lib/agent/cards";

/**
 * Помощник как основной экран, а не чат в углу.
 *
 * До первого вопроса на странице почти ничего нет: крупная строка по центру и
 * подсказки. Сервис делается в том числе для пожилых, и рябь из блоков вокруг
 * поля ввода им мешает больше, чем помогает.
 *
 * Ответ приходит потоком карточек: пока модель формулирует, аптеки с ценами
 * уже видны. Карточки собирает сервер из строк базы, поэтому цену и адрес в
 * них невозможно выдумать.
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

const MAX_BYTES = 8 * 1024 * 1024;

const HINTS = [
  "Врач выписал орсотен 120 мг, 1 капсула 3 раза в день, 30 дней. Где дешевле?",
  "Нужен нурофен для ребенка, где подешевле рядом",
  "Высыпания на коже уже месяц, к какому врачу идти",
];

export function AgentConsole() {
  const { locale } = useI18n();
  const params = useSearchParams();
  const city = resolveCity(params.get("city"));

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const started = msgs.length > 0;

  useEffect(() => {
    if (started) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, status, started]);

  // Вставка снимка из буфера. Человек делает скриншот назначения и жмёт
  // Ctrl+V — это самый быстрый путь, и он должен работать.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const file = [...(e.clipboardData?.items ?? [])]
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        readFile(file);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function readFile(file: File) {
    if (file.size > MAX_BYTES) {
      setMsgs((c) => [
        ...c,
        { role: "assistant", blocks: [{ type: "text", text: "Файл больше 8 МБ, нужен поменьше." }] },
      ]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPending(String(reader.result));
    reader.readAsDataURL(file);
  }

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

  async function send() {
    if (busy) return;
    const q = input.trim();
    const image = pending;
    if (!q && !image) return;

    const history: Msg[] = [
      ...msgs,
      { role: "user", content: q || "Фото назначения", image: image ?? undefined },
    ];
    setMsgs([...history, { role: "assistant", blocks: [] }]);
    setInput("");
    setPending(null);
    setBusy(true);
    setStatus("думаю");

    const push = (b: Block) =>
      setMsgs((cur) => {
        const copy = cur.slice();
        const last = copy[copy.length - 1];
        if (last?.role !== "assistant") return cur;
        const blocks = last.blocks.slice();
        const tail = blocks[blocks.length - 1];
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
        body: JSON.stringify({ messages: textHistory(history), city, locale, image }),
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
          if (e.t === "text") push({ type: "text", text: String(e.v) });
          else if (e.t === "card") push({ type: "card", card: e.v as Card });
          else if (e.t === "prescription")
            push({ type: "prescription", items: e.v as PrescriptionItem[] });
          else if (e.t === "status") setStatus(String(e.v));
          else if (e.t === "error") push({ type: "text", text: String(e.v) });
        }
      }
    } catch {
      push({ type: "text", text: "Не удалось получить ответ. Попробуйте еще раз." });
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="rounded-2xl border border-line bg-paper p-2 shadow-sm focus-within:border-brand"
    >
      {pending && (
        <div className="relative mb-2 inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pending} alt="Фото назначения" className="max-h-32 rounded-lg" />
          <button
            type="button"
            onClick={() => setPending(null)}
            aria-label="Убрать фото"
            className="absolute -right-2 -top-2 rounded-full bg-ink p-1 text-paper"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) readFile(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Прикрепить фото назначения"
          className="pressable flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface disabled:opacity-40"
        >
          <ImagePlus size={22} aria-hidden />
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Что назначил врач, или что беспокоит"
          className="max-h-40 min-h-[48px] flex-1 resize-none bg-transparent px-1 py-3 text-base outline-none"
        />
        <button
          type="submit"
          disabled={busy || (input.trim().length === 0 && !pending)}
          aria-label="Отправить"
          className="pressable flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand text-white disabled:opacity-30"
        >
          {busy ? (
            <Loader2 size={20} className="animate-spin" aria-hidden />
          ) : (
            <ArrowUp size={20} aria-hidden />
          )}
        </button>
      </div>
    </form>
  );

  if (!started) {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col justify-center px-4 py-10 sm:py-20">
        <h1 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          Покажите назначение
        </h1>
        <p className="mt-3 text-center text-lg text-muted">
          Найду, где купить дешевле рядом с вами, посчитаю курс и скажу, если
          что-то положено бесплатно
        </p>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="pressable mt-8 flex items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand/40 bg-brand-wash px-6 py-8 text-center"
        >
          <Camera size={28} className="shrink-0 text-brand-ink" aria-hidden />
          <span>
            <span className="block text-lg font-semibold text-ink">
              Сфотографируйте назначение
            </span>
            <span className="block text-sm text-muted">
              Или вставьте снимок из буфера сочетанием Ctrl и V
            </span>
          </span>
        </button>

        <div className="mt-6">{composer}</div>

        <div className="mt-6 space-y-2">
          {HINTS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => {
                setInput(h);
              }}
              className="pressable block w-full rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm text-muted hover:border-brand/40"
            >
              {h}
            </button>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-muted">
          Сервис не ставит диагноз и не заменяет врача. Назначение врача мы не
          меняем, только считаем деньги и маршрут.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col px-4 py-6">
      <div className="flex-1 space-y-4">
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-brand px-4 py-2.5 text-white">
              {m.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.image} alt="Фото назначения" className="mb-2 max-h-48 rounded-lg" />
              )}
              {m.content}
            </div>
          ) : (
            <div key={i} className="space-y-2.5">
              {m.blocks.map((b, j) =>
                b.type === "text" ? (
                  <p key={j} className="whitespace-pre-wrap leading-relaxed text-ink">
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
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            {status}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-4 mt-6 bg-paper/80 backdrop-blur">{composer}</div>
    </div>
  );
}
