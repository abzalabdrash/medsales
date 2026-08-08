"""Источник №3: что государство даёт бесплатно (ГОБМП / ОСМС).

Две таблицы, обе с adilet.zan.kz, обе — действующие НПА:

  V2100023885  приказ ҚР ДСМ-75 — Перечень ЛС и МИ для бесплатного и (или)
               льготного амбулаторного обеспечения.
               № | код МКБ-10 | заболевание | категория граждан | показания |
               наименование ЛС | код АТХ
               ★ это самая социально важная таблица во всём проекте: если
                 препарат из назначения тут есть, человеку его покупать НЕ НАДО.

  V2100024253  предельные цены по МНН для ГОБМП/ОСМС.
               № | код АТХ | наименование | характеристика | ед.изм. | цена
               ★ даёт ATC-коды, которыми обогащается основной справочник —
                 без ATC невозможен корректный подбор аналогов.

Особенность вёрстки: внутри таблицы идут строки-заголовки разделов
(«Болезни системы кровообращения») — у них одна ячейка вместо семи.
Их нельзя пропускать: раздел — это контекст для всех строк под ним.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass

from selectolax.parser import HTMLParser

from ._fetch import get_cached
from ._table import column_index, expand_table, find_header

BASE = "https://adilet.zan.kz/rus/docs/{doc}"

DOC_FREE = "V2100023885"
DOC_INN_CAP = "V2100024253"

_ATC_RE = re.compile(r"^[A-Z]\d{2}[A-Z]{2}\d{2}$")


@dataclass
class FreeDrugRow:
    mkb10: str | None
    disease: str | None
    citizen_category: str | None
    indication: str | None
    drug_name: str
    atc: str | None
    section: str | None
    source_doc: str
    source_url: str


@dataclass
class InnCapRow:
    atc: str | None
    name: str
    characteristic: str | None
    unit: str | None
    price_cap: float | None
    kind: str                 # 'drug' | 'device'
    source_doc: str
    source_url: str


def _txt(s: str | None) -> str | None:
    if not s:
        return None
    s = re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()
    return s or None


def _money(s: str | None) -> float | None:
    if not s:
        return None
    t = re.sub(r"[^\d,.]", "", s.replace("\xa0", "").replace(" ", "")).replace(",", ".")
    if not t:
        return None
    if t.count(".") > 1:
        head, _, tail = t.rpartition(".")
        t = head.replace(".", "") + "." + tail
    try:
        v = float(t)
    except ValueError:
        return None
    return v if v > 0 else None


def _fetch(doc: str) -> HTMLParser:
    return HTMLParser(get_cached(BASE.format(doc=doc), key=f"adilet_{doc}"))


def _biggest_table(tree: HTMLParser, must_have: tuple[str, ...]):
    best = None
    for tb in tree.css("table"):
        rows = tb.css("tr")
        if len(rows) < 15:
            continue
        head = " ".join(c.text(strip=True).lower() for c in rows[0].css("td,th"))
        if sum(h in head for h in must_have) >= 2:
            if best is None or len(rows) > len(best.css("tr")):
                best = tb
    return best


# --------------------------------------------------------------------------
def fetch_free_list() -> list[FreeDrugRow]:
    url = BASE.format(doc=DOC_FREE)
    tree = _fetch(DOC_FREE)
    table = _biggest_table(tree, ("мкб-10", "заболевания", "категория граждан"))
    if table is None:
        return []

    grid = expand_table(table)
    hi = find_header(grid, "мкб-10", "категория граждан", "наименование лекарственных")
    if hi is None:
        return []
    header = grid[hi]
    i_mkb = column_index(header, "мкб-10") or 1
    i_dis = column_index(header, "наименование заболевания", "заболевания (состояния") or 2
    i_cat = column_index(header, "категория граждан") or 3
    i_ind = column_index(header, "показания") or 4
    # осторожно: подстрока "лекарственных средств" встречается и в шапке
    # колонки «Показания ... для назначения лекарственных средств», которая
    # идёт РАНЬШЕ. Ищем только по «наименование лекарственных».
    i_drug = column_index(header, "наименование лекарственных") or 5
    i_atc = column_index(header, "анатомо-терапевтическо", "атх", "атc") or 6

    out: list[FreeDrugRow] = []
    section: str | None = None
    for row in grid[hi + 1:]:
        uniq = {c for c in row if c}
        # строка-заголовок раздела: после разворачивания она состоит из одного
        # значения, размноженного colspan'ом на всю ширину
        if len(uniq) == 1:
            section = next(iter(uniq))
            continue
        drug = row[i_drug] if i_drug < len(row) else None
        if not drug or drug.lower().startswith("наименование"):
            continue
        atc_raw = row[i_atc] if i_atc < len(row) else None
        atc = None
        if atc_raw:
            head = atc_raw.strip().upper().split()[0].rstrip(",;")
            atc = head if _ATC_RE.match(head) else atc_raw.strip().upper()
        pick = lambda i: row[i] if i < len(row) else None  # noqa: E731
        out.append(FreeDrugRow(
            mkb10=pick(i_mkb), disease=pick(i_dis), citizen_category=pick(i_cat),
            indication=pick(i_ind), drug_name=drug, atc=atc,
            section=section, source_doc=DOC_FREE, source_url=url,
        ))
    return out


def fetch_inn_caps() -> list[InnCapRow]:
    url = BASE.format(doc=DOC_INN_CAP)
    tree = _fetch(DOC_INN_CAP)
    out: list[InnCapRow] = []

    for tb in tree.css("table"):
        rows = tb.css("tr")
        if len(rows) < 15:
            continue
        head = [(_txt(c.text(strip=True)) or "").lower() for c in rows[0].css("td,th")]
        joined = " ".join(head)
        is_drug = "атх" in joined or "атc" in joined
        is_device = "наименования" in joined and "предельная цена" in joined
        if not (is_drug or is_device):
            continue

        for tr in rows[1:]:
            c = [_txt(x.text(strip=True)) for x in tr.css("td")]
            if len(c) < 5:
                continue
            if is_drug:
                atc, name, char, unit, price = c[1], c[2], c[3], c[4], (c[5] if len(c) > 5 else None)
                kind = "drug"
            else:
                atc, name, char, unit, price = None, c[1], c[2], c[3], c[4]
                kind = "device"
            if not name:
                continue
            out.append(InnCapRow(
                atc=(atc.upper() if atc else None), name=name,
                characteristic=char, unit=unit, price_cap=_money(price),
                kind=kind, source_doc=DOC_INN_CAP, source_url=url,
            ))
    return out


def fetch_all() -> tuple[list[FreeDrugRow], list[InnCapRow]]:
    free: list[FreeDrugRow] = []
    caps: list[InnCapRow] = []
    try:
        free = fetch_free_list()
        print(f"  [льготы] {DOC_FREE}: {len(free):>5} позиций бесплатного обеспечения")
    except Exception as exc:  # noqa: BLE001
        print(f"  [льготы] {DOC_FREE}: FAIL {type(exc).__name__}: {exc}")
    time.sleep(2)
    try:
        caps = fetch_inn_caps()
        drugs = sum(1 for c in caps if c.kind == "drug")
        print(f"  [льготы] {DOC_INN_CAP}: {len(caps):>5} строк "
              f"({drugs} ЛС по МНН + {len(caps)-drugs} медизделий)")
    except Exception as exc:  # noqa: BLE001
        print(f"  [льготы] {DOC_INN_CAP}: FAIL {type(exc).__name__}: {exc}")
    return free, caps


if __name__ == "__main__":
    free, caps = fetch_all()
    print(f"\nс кодом МКБ-10: {sum(1 for f in free if f.mkb10)}")
    print(f"с кодом ATC   : {sum(1 for f in free if f.atc)}")
    print(f"разделов      : {len({f.section for f in free if f.section})}")
    print("\n--- примеры бесплатного обеспечения ---")
    for f in free[:4]:
        print(f"  МКБ {f.mkb10} | {(f.disease or '')[:34]:34} | {f.drug_name[:36]:36} | ATC {f.atc}")
    print("\n--- предельные цены по МНН ---")
    for c in [x for x in caps if x.kind == "drug"][:4]:
        print(f"  {c.atc} | {c.name[:44]:44} | {c.price_cap} ₸/{c.unit}")
