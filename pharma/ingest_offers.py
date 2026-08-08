"""Загрузка предложений аптек в БД + матчинг к эталонному справочнику."""
from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from rapidfuzz import fuzz, process

from .db import det_id, get_session, init_db, norm_name
from .models import DrugOffer, DrugRef
from .sources import europharma

RAW_PATH = Path(__file__).resolve().parent.parent / "data" / "raw_offers_europharma.json"

# «Нимесулид 100 мг № 20 табл» -> дозировка и упаковка живут прямо в названии
_PACK_IN_NAME = re.compile(r"[№N]\s*(\d+)", re.IGNORECASE)


def _brand_key(name: str) -> str:
    """Первое слово названия — обычно торговая марка. Грубо, но быстро сужает поиск."""
    n = norm_name(name)
    return n.split(" ")[0] if n else ""


def match_offers(session, offers, *, threshold: int = 88) -> Counter:
    """Матчинг предложение -> DrugRef по названию + сверка дозировки и упаковки.

    Матч принимается только если совпало И название (fuzz >= threshold),
    И размер упаковки (если он есть у обеих сторон). Дозировка добавляет
    уверенности. Ошибиться дороже, чем не сматчить: неверный матч приведёт
    к неверному расчёту курса и неверному выводу о переплате.
    """
    refs = session.query(DrugRef).all()
    by_key: dict[str, list[DrugRef]] = {}
    for r in refs:
        by_key.setdefault(_brand_key(r.tn), []).append(r)

    stats = Counter()
    for o in offers:
        stats["total"] += 1
        # сюда приходят ORM-объекты DrugOffer, у них поле name_raw, а не name
        name = o.name_raw
        key = _brand_key(name)
        bucket = by_key.get(key) or []
        if not bucket:
            stats["no_bucket"] += 1
            o.drug_ref_id = None
            continue

        target = norm_name(name)
        best = process.extractOne(
            target, [norm_name(r.tn) for r in bucket], scorer=fuzz.token_set_ratio)
        if not best or best[1] < threshold:
            stats["low_score"] += 1
            o.drug_ref_id = None
            continue

        cand = bucket[best[2]]
        # --- сверка упаковки: защита от «то же название, другая фасовка» ---
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
        from_cache: bool = False) -> dict:
    init_db()
    session = get_session()

    if from_cache and RAW_PATH.exists():
        raw = _load_raw()
        print(f"  [ingest] загружено из кэша: {len(raw)} предложений (сеть не трогаем)")
    else:
        raw = europharma.scrape(max_categories=max_categories, max_pages=max_pages)
        _dump_raw(raw)
    print(f"\n  [ingest] собрано предложений: {len(raw)}")

    session.query(DrugOffer).filter(DrugOffer.source == "europharma").delete()
    rows: list[DrugOffer] = []
    for o in raw:
        rows.append(DrugOffer(
            id=det_id("of", "europharma", o.sku),
            chain=europharma.CHAIN,
            sku=o.sku, barcode=o.barcode,
            name_raw=o.name, price_kzt=o.price_kzt,
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
    a = ap.parse_args()
    run(max_categories=a.categories, from_cache=a.from_cache)
