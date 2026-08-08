// Best-effort "open now?" from the human working-hours strings the parser stores
// (e.g. "Ежедневно 08:00–20:00", "Пн–Сб 08:00–20:00, Вс круглосуточно",
// "Круглосуточно, ежедневно"). Returns null when it can't be parsed confidently.
// Evaluated in Almaty time so the answer is correct regardless of the viewer's TZ.

const DAY: Record<string, number> = {
  вс: 0,
  пн: 1,
  вт: 2,
  ср: 3,
  чт: 4,
  пт: 5,
  сб: 6,
};
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun as a sequence for ranges

function almatyNow(now: Date): { day: number; minutes: number } {
  // Asia/Almaty is UTC+5 (no DST). Derive wall-clock parts in that zone.
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Almaty",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return { day: map[wd] ?? now.getDay(), minutes: hh * 60 + mm };
  } catch {
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  }
}

function daysOf(token: string): Set<number> {
  const t = token.toLowerCase();
  if (/ежеднев|кажд|пн\s*[-–]\s*вс|all/.test(t)) return new Set(ORDER);
  const out = new Set<number>();
  // ranges like "пн-сб"
  const range = t.match(/(пн|вт|ср|чт|пт|сб|вс)\s*[-–]\s*(пн|вт|ср|чт|пт|сб|вс)/);
  if (range) {
    const a = ORDER.indexOf(DAY[range[1]]);
    const b = ORDER.indexOf(DAY[range[2]]);
    if (a >= 0 && b >= 0) {
      for (let i = a; ; i = (i + 1) % 7) {
        out.add(ORDER[i]);
        if (i === b) break;
      }
    }
  }
  // standalone day tokens
  for (const m of t.matchAll(/пн|вт|ср|чт|пт|сб|вс/g)) out.add(DAY[m[0]]);
  return out;
}

// returns true (open) / false (closed) / null (unknown)
export function isOpenNow(
  workingHours: string | null | undefined,
  now: Date = new Date(),
): boolean | null {
  if (!workingHours) return null;
  const s = workingHours.replace(/—/g, "–").trim();
  const { day, minutes } = almatyNow(now);

  const segments = s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  let matchedAnyDay = false;

  for (const seg of segments) {
    const low = seg.toLowerCase();
    const days = daysOf(low);
    const appliesToday =
      days.size > 0 ? days.has(day) : /круглосуточно|ежеднев/.test(low);
    if (!appliesToday) continue;
    matchedAnyDay = true;

    if (/круглосуточно|24\s*\/\s*7|00:00\s*[-–]\s*(00:00|23:59|24:00)/.test(low))
      return true;

    const tm = low.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
    if (tm) {
      const open = Number(tm[1]) * 60 + Number(tm[2]);
      let close = Number(tm[3]) * 60 + Number(tm[4]);
      if (close <= open) close += 24 * 60; // crosses midnight
      const m = minutes < open ? minutes + 24 * 60 : minutes;
      if (m >= open && m < close) return true;
    }
  }

  // A whole-string single window with no day tokens (e.g. "08:00–20:00").
  if (!matchedAnyDay) {
    if (/круглосуточно/.test(s.toLowerCase())) return true;
    const tm = s
      .toLowerCase()
      .match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
    if (tm) {
      const open = Number(tm[1]) * 60 + Number(tm[2]);
      let close = Number(tm[3]) * 60 + Number(tm[4]);
      if (close <= open) close += 24 * 60;
      const m = minutes < open ? minutes + 24 * 60 : minutes;
      return m >= open && m < close;
    }
    return null;
  }
  return false;
}

// "3 дн." / "1 день" — analysis turnaround.
export function termDaysLabel(d: number | null | undefined): string | null {
  if (d == null || d <= 0) return null;
  const n = d;
  const m10 = n % 10;
  const m100 = n % 100;
  let word = "дней";
  if (m10 === 1 && m100 !== 11) word = "день";
  else if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) word = "дня";
  return `${n} ${word}`;
}
