"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ImagePlus,
  Loader2,
  ArrowUp,
  Camera,
  X,
  FileText,
  LocateFixed,
  MapPin,
} from "lucide-react";
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

/** Вложение: в API всегда уходит картинка (PDF рендерим в JPEG на клиенте). */
type Attachment = {
  /** data-URL для vision / превью фото */
  dataUrl: string;
  kind: "image" | "pdf";
  name: string;
};

type SessionNear = { label: string; lat: number; lng: number };

const MAX_BYTES = 8 * 1024 * 1024;
const NEAR_KEY = "medprice.session.near.v1";

const HINTS = [
  "Врач выписал орсотен 120 мг, 1 капсула 3 раза в день, 30 дней. Где дешевле?",
  "Нужен нурофен для ребенка, где подешевле рядом",
  "Высыпания на коже уже месяц, к какому врачу идти",
];

function readSessionNear(): SessionNear | null {
  try {
    const raw = sessionStorage.getItem(NEAR_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SessionNear;
    if (
      typeof p.label === "string" &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng)
    ) {
      return p;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeSessionNear(near: SessionNear | null) {
  try {
    if (near) sessionStorage.setItem(NEAR_KEY, JSON.stringify(near));
    else sessionStorage.removeItem(NEAR_KEY);
  } catch {
    /* ignore */
  }
}

async function pdfFirstPageToJpeg(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Worker с CDN той же версии — иначе Next не резолвит worker из node_modules.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas.toDataURL("image/jpeg", 0.92);
}

export function AgentConsole() {
  const { locale, t } = useI18n();
  const params = useSearchParams();
  const city = resolveCity(params.get("city"));

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [statusOpen, setStatusOpen] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [near, setNear] = useState<SessionNear | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "loading" | "denied">("idle");
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const started = msgs.length > 0;

  useEffect(() => {
    setNear(readSessionNear());
  }, []);

  useEffect(() => {
    if (started) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, status, started]);

  // Поле растёт под текст. Без этого длинная подсказка или вставка из
  // буфера выглядят как однострочная полоска — хотя это textarea.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input, started, pending]);

  // Вставка снимка из буфера. Человек делает скриншот назначения и жмёт
  // Ctrl+V — это самый быстрый путь, и он должен работать.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const file = [...(e.clipboardData?.items ?? [])]
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        void readFile(file);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function shareGeo() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("loading");
    // Без high accuracy: иначе браузер ждёт GPS до timeout (до 10 с).
    // Для «аптека рядом» хватает сети/Wi‑Fi за доли секунды.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: SessionNear = {
          label: t.shareLocation,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        writeSessionNear(next);
        setNear(next);
        setGeoState("idle");
      },
      () => setGeoState("denied"),
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 120_000 },
    );
  }

  function clearGeo() {
    writeSessionNear(null);
    setNear(null);
    setGeoState("idle");
  }

  async function readFile(file: File) {
    if (file.size > MAX_BYTES) {
      setMsgs((c) => [
        ...c,
        { role: "assistant", blocks: [{ type: "text", text: "Файл больше 8 МБ, нужен поменьше." }] },
      ]);
      return;
    }
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    try {
      if (isPdf) {
        const dataUrl = await pdfFirstPageToJpeg(file);
        setPending({ dataUrl, kind: "pdf", name: file.name || "назначение.pdf" });
        return;
      }
      if (!file.type.startsWith("image/")) {
        setMsgs((c) => [
          ...c,
          {
            role: "assistant",
            blocks: [{ type: "text", text: "Нужно фото или PDF назначения." }],
          },
        ]);
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      setPending({ dataUrl, kind: "image", name: file.name || "фото" });
    } catch {
      setMsgs((c) => [
        ...c,
        {
          role: "assistant",
          blocks: [{ type: "text", text: "Не удалось прочитать файл. Попробуйте фото или другой PDF." }],
        },
      ]);
    }
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
    const image = pending?.dataUrl ?? null;
    if (!q && !image) return;

    const history: Msg[] = [
      ...msgs,
      { role: "user", content: q || "Фото назначения", image: image ?? undefined },
    ];
    setMsgs([...history, { role: "assistant", blocks: [] }]);
    setInput("");
    setPending(null);
    setBusy(true);
    setStatus(image ? "распознаю текст на фото" : "думаю");
    setStatusLog(image ? ["распознаю текст на фото"] : ["думаю"]);
    setStatusOpen(false);

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
        body: JSON.stringify({
          messages: textHistory(history),
          city,
          locale,
          image,
          // Только сессионная геопозиция — в кабинет / localStorage не пишем.
          address: near,
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
          if (e.t === "text") push({ type: "text", text: String(e.v) });
          else if (e.t === "card") push({ type: "card", card: e.v as Card });
          else if (e.t === "prescription")
            push({ type: "prescription", items: e.v as PrescriptionItem[] });
          else if (e.t === "status") {
            const s = String(e.v);
            setStatus(s);
            setStatusLog((prev) => (prev[prev.length - 1] === s ? prev : [...prev, s]));
          }
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

  const geoBar = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {near ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-brand-wash px-3 py-1.5 text-xs font-medium text-brand-ink">
            <MapPin size={14} aria-hidden />
            Рядом с вами
          </span>
          <button
            type="button"
            onClick={clearGeo}
            className="pressable inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-line bg-paper px-2.5 text-xs font-medium text-muted hover:text-ink"
          >
            <X size={12} aria-hidden />
            Сбросить
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={shareGeo}
          disabled={geoState === "loading"}
          className="pressable inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-brand/35 bg-brand-wash px-3 text-sm font-medium text-brand-ink hover:border-brand/55 disabled:opacity-50"
        >
          {geoState === "loading" ? (
            <Loader2 size={16} className="animate-spin" aria-hidden />
          ) : (
            <LocateFixed size={16} aria-hidden />
          )}
          {t.shareLocation}
        </button>
      )}
      {geoState === "denied" && (
        <span className="text-xs text-brand-ink">{t.locationDenied}</span>
      )}
    </div>
  );

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="agent-composer rounded-2xl border border-line bg-paper p-3 shadow-sm focus-within:border-brand [&_textarea]:focus-visible:outline-none [&_button]:focus-visible:outline-none"
    >
      {geoBar}
      {pending && (
        <div className="relative mb-3 inline-flex max-w-full items-center gap-3 rounded-xl bg-surface px-3 py-2">
          {pending.kind === "pdf" ? (
            <>
              <FileText size={28} className="shrink-0 text-brand-ink" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{pending.name}</p>
                <p className="text-xs text-muted">PDF · первая страница готова к разбору</p>
              </div>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pending.dataUrl} alt="Фото назначения" className="max-h-40 rounded-lg" />
          )}
          <button
            type="button"
            onClick={() => setPending(null)}
            aria-label="Убрать файл"
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
          accept="image/*,application/pdf,.pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void readFile(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Прикрепить фото или PDF назначения"
          className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface disabled:opacity-40"
        >
          <ImagePlus size={22} aria-hidden />
        </button>
        <textarea
          ref={taRef}
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
          className="max-h-[220px] min-h-[44px] w-full flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2.5 text-base leading-relaxed outline-none focus:outline-none focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={busy || (input.trim().length === 0 && !pending)}
          aria-label="Отправить"
          className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white disabled:opacity-30"
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
      <div className="mx-auto flex w-full max-w-[720px] flex-col px-4 pb-10 pt-6 sm:pt-8">
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
          className="pressable mt-6 flex items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand/40 bg-brand-wash px-6 py-7 text-center"
        >
          <Camera size={28} className="shrink-0 text-brand-ink" aria-hidden />
          <span>
            <span className="block text-lg font-semibold text-ink">
              Сфотографируйте или загрузите PDF
            </span>
            <span className="block text-sm text-muted">
              Фото, PDF или вставка из буфера сочетанием Ctrl и V
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
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[720px] flex-col px-4 py-6">
      <div className="min-h-0 flex-1 space-y-4">
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
                  <PrescriptionCard key={j} items={b.items} showRaw={showReasoning} />
                ) : (
                  <AgentCard key={j} card={b.card} />
                ),
              )}
            </div>
          ),
        )}
        {busy && status && (
          <div className="text-sm text-muted">
            <button
              type="button"
              onClick={() => setStatusOpen((v) => !v)}
              className="flex items-center gap-2 hover:text-ink"
            >
              <Loader2 size={14} className="animate-spin" aria-hidden />
              <span>{status}</span>
              {statusLog.length > 1 && (
                <span className="text-[11px] opacity-70">
                  {statusOpen ? "свернуть" : "ход работы"}
                </span>
              )}
            </button>
            {statusOpen && (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
                {statusLog.map((s, i) => (
                  <li key={`${i}-${s}`}>{s}</li>
                ))}
              </ol>
            )}
          </div>
        )}
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={showReasoning}
            onChange={(e) => setShowReasoning(e.target.checked)}
            className="rounded border-line"
          />
          Показ рассуждений (OCR по строкам)
        </label>
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-4 mt-auto bg-paper/90 pb-2 backdrop-blur">{composer}</div>
    </div>
  );
}
