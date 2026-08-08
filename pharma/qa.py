"""QA-валидатор цен. Отвечает на вопрос «этой цене можно верить?».

Зачем: в текущей базе услуг есть «Удаление зуба простое — 8 ₸» и
«Консультация гинеколога» с разбросом от 300 ₸ до 330 000 ₸. Такое на
демо жюри заметит за 10 секунд, и доверие ко всему продукту исчезнет.

Правила (по возрастанию строгости):
  R1 no_price        цены нет вообще -> позиция не показывается в выдаче
  R2 abs_floor       цена ниже физического минимума для категории
  R3 robust_outlier  |цена - медиана| / MAD по канонической группе > K
  R4 above_cap       (только препараты) цена выше предельной розничной МЗ РК
  R5 canon_too_broad каноническая группа слишком широкая (max/min > R) —
                     это дефект НОРМАЛИЗАЦИИ, а не цены: чинить надо справочник

R3 намеренно на медиане и MAD, а не на среднем и σ: одна цена в 800 020 ₸
раздувает σ настолько, что порог перестаёт ловить что-либо.

price_confidence: 1.0 чисто -> 0.0 мусор. В выдачу идёт всё >= 0.5,
остальное скрывается, но остаётся в базе с причиной (объяснимость).
"""
from __future__ import annotations

import sqlite3
import statistics
from collections import defaultdict
from dataclasses import dataclass

# Физический минимум цены, ниже которого позиция — почти наверняка битый парсинг.
# Взято по нижней границе реального рынка РК, не «на глаз»: самый дешёвый
# биохимический показатель в лабораториях — около 400-500 ₸.
ABS_FLOOR = {
    "laboratory": 300,
    "procedure": 500,
    "consultation": 1000,
    "diagnostics": 800,
    "surgery": 3000,
    "dentistry": 500,
    None: 300,
}
ABS_CEILING = {
    "laboratory": 300_000,
    "consultation": 150_000,
    None: 5_000_000,
}

MAD_K = 6.0          # порог робастного z-score
# Пол для MAD как доля медианы. Без него группа с плотными ценами (СОЭ: 600-700 ₸)
# даёт MAD ~50, и честные 990 ₸ получают z=6.8 и летят в мусор. Рынок медуслуг
# РК спокойно расходится в 2-3 раза между эконом- и премиум-клиникой — это норма,
# а не ошибка парсинга. Ловить надо порядки, а не проценты.
MAD_FLOOR_FRAC = 0.35
BROAD_RATIO = 50.0   # max/min внутри каноники, выше которого группа считается кривой
MIN_GROUP = 5        # меньше пяти цен — статистика не имеет смысла


@dataclass
class Verdict:
    flag: str
    confidence: float
    detail: str


def _mad(values: list[float], med: float) -> float:
    return statistics.median([abs(v - med) for v in values]) or 0.0


def judge_group(prices: list[float], category: str | None,
                cap: float | None = None) -> dict[int, Verdict]:
    """Возвращает вердикт по индексу цены в списке."""
    out: dict[int, Verdict] = {}
    floor = ABS_FLOOR.get(category, ABS_FLOOR[None])
    ceil = ABS_CEILING.get(category, ABS_CEILING[None])

    clean = [p for p in prices if p is not None]
    med = statistics.median(clean) if clean else None
    mad = 0.0
    if med is not None and len(clean) >= MIN_GROUP:
        mad = max(_mad(clean, med), MAD_FLOOR_FRAC * med)

    for i, p in enumerate(prices):
        if p is None:
            out[i] = Verdict("no_price", 0.0, "цена отсутствует у источника")
            continue
        if p < floor:
            out[i] = Verdict("suspect_low", 0.0,
                             f"{p:.0f} ₸ ниже физического минимума {floor} ₸ для «{category}»")
            continue
        if p > ceil:
            out[i] = Verdict("suspect_high", 0.0,
                             f"{p:.0f} ₸ выше потолка {ceil} ₸ для «{category}»")
            continue
        if cap and p > cap * 1.02:          # 2% — допуск на округление
            out[i] = Verdict("above_cap", 0.6,
                             f"{p:.0f} ₸ выше предельной розничной МЗ РК {cap:.0f} ₸ "
                             f"(+{100*(p/cap-1):.0f}%)")
            continue
        if mad > 0 and med is not None:
            z = abs(p - med) / mad
            if z > MAD_K:
                side = "suspect_low" if p < med else "suspect_high"
                out[i] = Verdict(side, 0.25,
                                 f"{p:.0f} ₸ при медиане {med:.0f} ₸ по группе "
                                 f"(робастный z={z:.1f})")
                continue
        out[i] = Verdict("ok", 1.0, "")
    return out


# --------------------------------------------------------------------------
# Прогон по базе услуг medprice.db — проверка на реальных данных
# --------------------------------------------------------------------------
def audit_services(db_path: str, apply: bool = False) -> dict:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    rows = con.execute("""
        SELECT p.id, p.price_kzt, p.category, p.service_name_raw,
               p.canonical_service_id, cs.name_ru
        FROM price p LEFT JOIN canonical_service cs ON cs.id = p.canonical_service_id
    """).fetchall()

    groups: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for r in rows:
        groups[r["canonical_service_id"] or f"__raw::{r['service_name_raw']}"].append(r)

    counts: dict[str, int] = defaultdict(int)
    examples: dict[str, list[str]] = defaultdict(list)
    broad: list[tuple[str, float, float, float, int]] = []
    updates: list[tuple[str, float, str]] = []

    for gid, grp in groups.items():
        prices = [r["price_kzt"] for r in grp]
        cat = grp[0]["category"]
        verdicts = judge_group(prices, cat)

        real = [p for p in prices if p]
        if len(real) >= MIN_GROUP:
            ratio = max(real) / min(real)
            if ratio > BROAD_RATIO:
                broad.append((grp[0]["name_ru"] or grp[0]["service_name_raw"],
                              ratio, min(real), max(real), len(real)))

        shown: set[str] = set()   # не более одного примера на группу — иначе
        for i, r in enumerate(grp):  # весь список забивает одна услуга
            v = verdicts[i]
            counts[v.flag] += 1
            if v.flag != "ok" and len(examples[v.flag]) < 5 and v.flag not in shown:
                shown.add(v.flag)
                examples[v.flag].append(
                    f"{(r['name_ru'] or r['service_name_raw'])[:44]:44} — {v.detail}")
            updates.append((r["id"], v.confidence, v.flag))

    if apply:
        con.execute("ALTER TABLE price ADD COLUMN price_confidence REAL") if not any(
            c[1] == "price_confidence" for c in con.execute("PRAGMA table_info(price)")) else None
        con.execute("ALTER TABLE price ADD COLUMN qa_flag TEXT") if not any(
            c[1] == "qa_flag" for c in con.execute("PRAGMA table_info(price)")) else None
        con.executemany("UPDATE price SET price_confidence=?, qa_flag=? WHERE id=?",
                        [(c, f, i) for i, c, f in updates])
        con.commit()

    con.close()
    broad.sort(key=lambda x: -x[1])
    return {"counts": dict(counts), "examples": dict(examples), "broad": broad[:10],
            "total": len(rows)}


if __name__ == "__main__":
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\abdra\Projects\med\data\medprice.db"
    apply = "--apply" in sys.argv
    res = audit_services(path, apply=apply)
    t = res["total"]
    print("=" * 66)
    print(f"  QA ЦЕН ПО БАЗЕ УСЛУГ: {t} записей")
    print("=" * 66)
    for flag, n in sorted(res["counts"].items(), key=lambda x: -x[1]):
        print(f"  {flag:14} {n:>6}  ({100*n/t:.1f}%)")
    for flag, ex in res["examples"].items():
        print(f"\n  --- {flag} ---")
        for e in ex:
            print("   ", e)
    print("\n  --- КАНОНИКИ, СКЛЕЕННЫЕ СЛИШКОМ ШИРОКО (дефект нормализации) ---")
    for name, ratio, lo, hi, n in res["broad"]:
        print(f"   ×{ratio:>9,.0f}  {name[:42]:42} {lo:>9,.0f} .. {hi:>10,.0f} ₸  (n={n})")
    if apply:
        print("\n  [applied] проставлены price_confidence и qa_flag")
