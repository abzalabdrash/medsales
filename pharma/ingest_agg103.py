"""Загрузка обхода apteka.103.kz в БД: каталог, аптеки и цены по точкам.

Три таблицы за один проход:

  agg_product     каталог агрегатора — товар в городе, с МНН, ATC, дозировкой,
                  фасовкой и признаком «по рецепту». Матчится к эталону МЗ.
  pharmacy        физические аптеки источника: адрес, телефон, график.
                  Рядом с точками из 2GIS, но помечены source='103kz' —
                  смешивать нельзя, у них разное происхождение и разная
                  полнота (у 2GIS есть координаты и рейтинг, здесь — цены).
  pharmacy_offer  цена в конкретной аптеке. То, ради чего всё затевалось.

Запускать после обхода:

    python -m pharma.sources.agg103 catalog --city almaty
    python -m pharma.sources.agg103 stores  --city almaty
    python -m pharma.ingest_agg103
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from .db import chain_key, det_id, get_session, init_db, norm_name
from .ingest_offers import match_offers
from .models import AggProduct, Pharmacy, PharmacyOffer
from .sources import agg103

SOURCE = agg103.SOURCE


def _rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _match_name(p: AggProduct) -> str:
    """Название для матчинга: марка + дозировка + фасовка.

    Матчер сравнивает витрину с торговым наименованием из реестра и отдельно
    сверяет фасовку. У агрегатора всё это лежит по полям, поэтому собираем
    строку в том же виде, в каком она приходит с витрины сети
    («Нимесулид 100 мг № 20»), — и работает один и тот же код.
    """
    parts = [p.name or ""]
    if p.dosage:
        parts.append(str(p.dosage))
    if p.pack_size:
        parts.append(f"№{p.pack_size}")
    return " ".join(x for x in parts if x).strip()


def load_catalog(session, cities: list[str]) -> Counter:
    stats = Counter()
    products: list[AggProduct] = []
    seen: set[str] = set()

    for city in cities:
        rows = _rows(agg103.catalog_path(city))
        stats[f"файл:{city}"] = len(rows)
        for r in rows:
            # ключ позиции — товар + город + фасовка + производитель:
            # у «Ксеникала» один code на три фасовки по разной цене
            pid = det_id("ag", SOURCE, city, r.get("code"),
                         r.get("pack_size"), r.get("producer"), r.get("dosage"))
            if pid in seen:
                stats["дубли"] += 1
                continue
            seen.add(pid)
            name = (r.get("name") or "").strip()
            if not name:
                continue
            products.append(AggProduct(
                id=pid, source=SOURCE, code=r["code"], city=city,
                name=name, name_norm=norm_name(name),
                extended_name=r.get("extended_name"),
                inn=r.get("inn"), inn_norm=norm_name(r.get("inn")),
                atc=r.get("atc"), dosage=r.get("dosage"),
                pack_size=r.get("pack_size"), base_form=r.get("base_form"),
                is_rx=r.get("is_rx"), producer=r.get("producer"),
                producer_country=r.get("producer_country"),
                price_min=r.get("price_min"), price_max=r.get("price_max"),
                price_raw=r.get("price_raw"), category=r.get("category"),
                url=r.get("url"), instruction_url=r.get("instruction_url"),
                picture_url=r.get("picture_url"),
            ))

    if not products:
        return stats

    # матчинг к эталону МЗ РК — тем же кодом, что и витрины сетей
    m = match_offers(session, products, name_of=_match_name)
    stats["позиций"] = len(products)
    stats["сматчено"] = m["matched"]

    session.query(AggProduct).filter(AggProduct.source == SOURCE).delete()
    session.add_all(products)
    session.commit()
    return stats


def load_stores(session, cities: list[str]) -> Counter:
    """Аптеки и цены по точкам. Позиции без аптек в городе пропускаем."""
    stats = Counter()

    # карта «код товара + город + фасовка» -> позиция каталога.
    # Цены на странице относятся к первому варианту, и обходчик кладёт его
    # фасовку рядом с ценой — по ней и связываем.
    catalog = {}
    for p in session.query(AggProduct).filter(AggProduct.source == SOURCE):
        catalog.setdefault((p.code, p.city, p.pack_size), p)
        catalog.setdefault((p.code, p.city, None), p)

    pharmacies: dict[str, Pharmacy] = {}
    offers: list[PharmacyOffer] = []
    seen: set[str] = set()

    for city in cities:
        rows = _rows(agg103.stores_path(city))
        stats[f"файл:{city}"] = len(rows)
        for r in rows:
            sid = str(r.get("store_id") or "")
            if not sid:
                stats["без аптек"] += 1     # маркер «товара нет в этом городе»
                continue

            ph_id = det_id("ph", SOURCE, sid)
            if ph_id not in pharmacies:
                name = (r.get("name") or "").strip()
                pharmacies[ph_id] = Pharmacy(
                    id=ph_id, chain=name, chain_key=chain_key(name),
                    chain_id=r.get("group_id"), name=name, city=city,
                    address=r.get("address"),
                    working_hours="; ".join(r.get("work_schedule") or []) or None,
                    phone=", ".join(r.get("phones") or []) or None,
                    source=SOURCE,
                )

            oid = det_id("po", SOURCE, city, r.get("product_code"), sid)
            if oid in seen:
                stats["дубли"] += 1
                continue
            seen.add(oid)

            prod = (catalog.get((r.get("product_code"), city, r.get("pack_size")))
                    or catalog.get((r.get("product_code"), city, None)))
            offers.append(PharmacyOffer(
                id=oid, source=SOURCE, city=city,
                product_code=r["product_code"],
                agg_product_id=prod.id if prod else None,
                drug_ref_id=prod.drug_ref_id if prod else None,
                pharmacy_id=ph_id, store_id=sid,
                pharmacy_name=r.get("name"), address=r.get("address"),
                price_kzt=r.get("price_kzt"), quantity_raw=r.get("quantity_raw"),
                dosage=r.get("dosage"), pack_size=r.get("pack_size"),
                producer=r.get("producer"),
                updated_label=r.get("updated_label"), updated_on=r.get("updated_on"),
                stores_total=r.get("stores_total"),
                source_url=r.get("url"),
            ))

    session.query(PharmacyOffer).filter(PharmacyOffer.source == SOURCE).delete()
    session.query(Pharmacy).filter(Pharmacy.source == SOURCE).delete()
    session.add_all(list(pharmacies.values()))
    session.add_all(offers)
    session.commit()

    stats["аптек"] = len(pharmacies)
    stats["цен"] = len(offers)
    stats["с ценой"] = sum(1 for o in offers if o.price_kzt)
    stats["к позиции каталога"] = sum(1 for o in offers if o.agg_product_id)
    stats["к эталону МЗ"] = sum(1 for o in offers if o.drug_ref_id)
    return stats


def run(cities: list[str] | None = None) -> dict:
    cities = cities or list(agg103.CITIES)
    init_db()
    session = get_session()

    cat = load_catalog(session, cities)
    st = load_stores(session, cities)

    print("\n" + "=" * 58)
    print(f"  АГРЕГАТОР 103.kz: {', '.join(agg103.CITIES[c] for c in cities)}")
    print("=" * 58)
    print(f"  позиций каталога            {cat['позиций']:>7}")
    print(f"    из них сматчено к МЗ      {cat['сматчено']:>7}")
    print(f"  аптек                       {st['аптек']:>7}")
    print(f"  цен по конкретным аптекам   {st['цен']:>7}")
    print(f"    привязано к каталогу      {st['к позиции каталога']:>7}")
    print(f"    привязано к эталону МЗ    {st['к эталону МЗ']:>7}")
    session.close()
    return {**cat, **st}


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Загрузка обхода 103.kz в БД")
    ap.add_argument("--cities", default=",".join(agg103.CITIES))
    a = ap.parse_args()
    run([c.strip() for c in a.cities.split(",") if c.strip()])
