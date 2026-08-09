"""Загрузка предложений аптек в БД + матчинг к эталонному справочнику."""
from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

from rapidfuzz import fuzz, process

from .db import det_id, get_session, init_db, norm_name
from .models import DrugOffer, DrugRef
from .sources import europharma

RAW_PATH = Path(__file__).resolve().parent.parent / "data" / "raw_offers_europharma.json"

# «Нимесулид 100 мг № 20 табл» -> дозировка и упаковка живут прямо в названии
_PACK_IN_NAME = re.compile(r"[№N]\s*(\d+)", re.IGNORECASE)


BUCKET_LEN = 3

# Мусор, который есть на витрине аптеки и которого нет в торговом наименовании:
# дозировки, фасовки, лекформы. Сравнивать «Клотримазол-Тева крем 1% 30 г крем»
# с «Клотримазол» как есть — значит утопить верный матч до 55 баллов.
_NOISE = re.compile(
    r"\b(?:табл?\w*|капс\w*|амп\w*|фл\w*|шт|уп\w*|пак\w*|саше|гран\w*|"
    r"мазь|крем\w*|гел[ья]?|сироп\w*|р[- ]?р|раствор\w*|сусп\w*|порош\w*|"
    r"супп\w*|свеч\w*|спрей|аэроз\w*|кап(?:ли|ель)?|драже|"
    r"покрыт\w*|плён\w*|плен\w*|оболоч\w*|кишечнораст\w*|п/о|п/плён\w*|"
    r"мг|мкг|мл|гр?|ме|ед|%)\b", re.IGNORECASE)
# Внимание на "no": norm_name прогоняет NFKC, а тот раскладывает знак «№»
# (U+2116) в две буквы «No». Без явной обработки от «№20» оставался хвост
# «no», который портил и марочную часть, и ключ бакета.
_NUMS = re.compile(r"(?:№|no|n)\s*\d+[.,]?\d*|\d+[.,]?\d*\s*%?|%", re.IGNORECASE)


def brand_head(name: str) -> str:
    """Марочная часть названия: без дозировок, фасовок и лекформ.

    «Клотримазол-Тева крем 1% 30 г крем» -> «клотримазол тева»
    «ИБУФЕН, 200 мг, №20 таблетки»       -> «ибуфен»
    Именно это сравнивается с торговым наименованием из реестра.
    """
    n = norm_name(name)
    n = _NUMS.sub(" ", n)
    n = _NOISE.sub(" ", n)
    return " ".join(n.split())


def _brand_key(name: str) -> str:
    """Ключ бакета: первые 3 символа марочной части без пробелов.

    Пять символов брать нельзя: в реестре встречаются короткие марки («Пан®»),
    их ключ выходил трёхсимвольным и никогда не совпадал с пятисимвольным
    ключом витрины («пан40»). Три символа дают бакеты побольше, зато ключ
    одинаковой длины для любого названия, а точность добирается скорингом.
    """
    n = brand_head(name).replace(" ", "")
    return n[:BUCKET_LEN] if n else ""


def match_offers(session, offers, *, threshold: int = 88,
                 name_of: Callable[[object], str] | None = None) -> Counter:
    """Матчинг предложение -> DrugRef по названию + сверка дозировки и упаковки.

    Матч принимается только если совпало И название (fuzz >= threshold),
    И размер упаковки (если он есть у обеих сторон). Дозировка добавляет
    уверенности. Ошибиться дороже, чем не сматчить: неверный матч приведёт
    к неверному расчёту курса и неверному выводу о переплате.

    name_of — как достать название: у DrugOffer оно лежит в name_raw готовой
    строкой, у позиции каталога агрегатора собирается из марки, дозировки и
    фасовки. Логика матчинга при этом одна и та же.
    """
    name_of = name_of or (lambda o: o.name_raw)
    refs = session.query(DrugRef).all()
    by_key: dict[str, list[DrugRef]] = {}
    for r in refs:
        by_key.setdefault(_brand_key(r.tn), []).append(r)

    stats = Counter()
    for o in offers:
        stats["total"] += 1
        name = name_of(o)
        key = _brand_key(name)
        bucket = by_key.get(key) or []
        if not bucket:
            stats["no_bucket"] += 1
            o.drug_ref_id = None
            continue

        # сравниваем марку с маркой: обе стороны очищены от дозировок и форм
        target = brand_head(name)
        best = process.extractOne(
            target, [brand_head(r.tn) for r in bucket], scorer=fuzz.token_set_ratio)
        if not best or best[1] < threshold:
            stats["low_score"] += 1
            o.drug_ref_id = None
            continue

        cand = bucket[best[2]]
        # --- сверка упаковки: защита от «то же название, другая фасовка» ---
        # У агрегатора фасовка приходит отдельным полем и ей можно верить;
        # у витрины сети её приходится выковыривать из названия («… №20»).
        offer_pack = getattr(o, "pack_size", None)
        if not offer_pack:
            pm = _PACK_IN_NAME.search(name)
            offer_pack = int(pm.group(1)) if pm else None
        if offer_pack and cand.pack_size and offer_pack != cand.pack_size:
            same_pack = [r for r in bucket if r.pack_size == offer_pack]
            if same_pack:
                cand = same_pack[0]
            else:
                stats["pack_mismatch"] += 1
                o.drug_ref_id = None
                continue

        o.drug_ref_id = cand.id
        o.match_method = "fuzzy+pack"
        o.match_score = float(best[1])
        stats["matched"] += 1
    return stats


def _biosfera_rows() -> list[DrugOffer]:
    """Предложения «Биосферы» в общем виде.

    Вторая сеть — это не «ещё немного строк», а появление самого сравнения:
    до неё у каждого препарата была ровно одна цена, и обещание «покажем, где
    дешевле» держалось на честном слове.
    """
    from .sources import biosfera

    path = RAW_PATH.with_name("raw_offers_biosfera.json")
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        raw = [biosfera.Offer(**d) for d in data]
        print(f"  [biosfera] из кэша: {len(raw)}")
    elif (partial := biosfera.load_checkpoint()):
        # обход ещё идёт или был прерван — берём то, что уже на диске.
        # Половина сети лучше, чем ничего: сравнение цен появляется уже на ней.
        raw = partial
        print(f"  [biosfera] из незаконченного обхода: {len(raw)}")
    else:
        raw = biosfera.scrape()
        path.write_text(json.dumps([asdict(o) for o in raw], ensure_ascii=False),
                        encoding="utf-8")

    # Ключ строится по адресу карточки, а не по артикулу: в карте сайта
    # встречаются разные товары с одним и тем же sku (склеенные коды вида
    # «M-009025M-005262»), и по артикулу они давали одинаковый id.
    rows: dict[str, DrugOffer] = {}
    for o in raw:
        if not o.name:
            continue
        oid = det_id("of", "biosfera", o.url)
        rows.setdefault(oid, DrugOffer(
            id=oid,
            chain=biosfera.CHAIN, sku=o.sku, name_raw=o.name,
            name_norm=norm_name(o.name),
            price_kzt=o.price_kzt, in_stock=o.in_stock,
            source="biosfera", source_url=o.url,
        ))
    return list(rows.values())


def _dump_raw(raw: list) -> None:
    """Сырые предложения на диск СРАЗУ после обхода.

    Обход сети занимает ~40 минут. Любая ошибка на следующем шаге (матчинг,
    запись в БД) не должна стоить этих сорока минут — поэтому сначала дамп,
    потом всё остальное.
    """
    RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    RAW_PATH.write_text(
        json.dumps([asdict(o) for o in raw], ensure_ascii=False), encoding="utf-8")
    print(f"  [ingest] сырые данные сохранены: {RAW_PATH}")


def _load_raw() -> list:
    data = json.loads(RAW_PATH.read_text(encoding="utf-8"))
    return [europharma.Offer(**d) for d in data]


def run(max_categories: int | None = None, max_pages: int = 200,
        from_cache: bool = False, sources: tuple[str, ...] = ("europharma",)) -> dict:
    init_db()
    session = get_session()

    rows: list[DrugOffer] = []
    if "biosfera" in sources:
        rows.extend(_biosfera_rows())
        session.query(DrugOffer).filter(DrugOffer.source == "biosfera").delete()
    if "europharma" not in sources:
        stats = match_offers(session, rows)
        session.add_all(rows)
        session.commit()
        _report(stats)
        session.close()
        return dict(stats)

    if from_cache and RAW_PATH.exists():
        raw = _load_raw()
        print(f"  [ingest] загружено из кэша: {len(raw)} предложений (сеть не трогаем)")
    else:
        raw = europharma.scrape(max_categories=max_categories, max_pages=max_pages)
        _dump_raw(raw)
    print(f"\n  [ingest] собрано предложений: {len(raw)}")

    session.query(DrugOffer).filter(DrugOffer.source == "europharma").delete()
    for o in raw:
        rows.append(DrugOffer(
            id=det_id("of", "europharma", o.sku),
            chain=europharma.CHAIN,
            sku=o.sku, barcode=o.barcode,
            name_raw=o.name, name_norm=norm_name(o.name), price_kzt=o.price_kzt,
            is_rx=o.is_rx, category_raw=o.category_raw,
            manufacturer=o.manufacturer,
            in_stock=True if o.price_kzt else None,
            source="europharma", source_url=o.url,
        ))

    stats = match_offers(session, rows)
    session.add_all(rows)
    session.commit()

    total = stats["total"] or 1
    print("\n" + "=" * 58)
    print(f"  ПРЕДЛОЖЕНИЙ В БАЗЕ: {total}")
    print("=" * 58)
    print(f"  сматчено к эталону МЗ           {stats['matched']:>6}  ({100*stats['matched']//total}%)")
    print(f"  нет бренда в справочнике        {stats['no_bucket']:>6}   (БАД/косметика/FMCG — ожидаемо)")
    print(f"  низкий score                    {stats['low_score']:>6}")
    print(f"  отклонено по фасовке            {stats['pack_mismatch']:>6}   (защита от неверного курса)")
    session.close()
    return dict(stats)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Сбор и загрузка предложений аптек")
    ap.add_argument("--categories", type=int, default=None,
                    help="ограничить число категорий (для быстрой проверки)")
    ap.add_argument("--from-cache", action="store_true",
                    help="взять прошлый обход из raw_offers_*.json, не ходя в сеть")
    ap.add_argument("--sources", default="europharma",
                    help="через запятую: europharma, biosfera")
    a = ap.parse_args()
    run(max_categories=a.categories, from_cache=a.from_cache,
        sources=tuple(s.strip() for s in a.sources.split(",") if s.strip()))
