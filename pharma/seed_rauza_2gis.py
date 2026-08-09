# -*- coding: utf-8 -*-
"""Рауза из 2GIS (адреса, firm id, рейтинг) + цены демо-SKU на каждую точку.

point_id с rauza-ade.kz без адресов — поэтому берём филиалы из 2GIS API
(наши TWOGIS_KEYS) и вешаем на них цены с сайта Раузы (min по SKU).
"""
from __future__ import annotations

import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pharma.db import det_id, chain_key  # noqa: E402
from pharma.geo.enrich import _read_keys  # noqa: E402
from pharma.geo.twogis import TwoGisClient, firm_url, city_slug  # noqa: E402

MEDSALES = ROOT / "data" / "medsales.db"
CITY = "almaty"


def fetch_rauza_branches(cli: TwoGisClient) -> list:
    out, seen = [], set()
    # 2GIS page ∈ [1, 5]
    for page in range(1, 6):
        places = cli.search("Рауза аптека", CITY, page=page, page_size=10)
        if not places:
            break
        for p in places:
            if p.twogis_id in seen:
                continue
            # только настоящие Рауза
            if "рауз" not in (p.name or "").lower():
                continue
            seen.add(p.twogis_id)
            out.append(p)
    # добивка Навои / Орбита точечным поиском
    for q in ["Рауза Навои", "Рауза Орбита"]:
        for p in cli.search(q, CITY, page_size=5):
            if p.twogis_id in seen:
                continue
            if "рауз" not in (p.name or "").lower():
                continue
            seen.add(p.twogis_id)
            out.append(p)
    return out


def refresh_view(con: sqlite3.Connection) -> None:
    from pharma.merge import _city_case

    con.execute("DROP VIEW IF EXISTS v_drug_price")
    con.execute(
        f"""
        CREATE VIEW v_drug_price AS
        SELECT o.id, o.city, o.price_kzt,
               COALESCE(a.name, o.product_code) AS title,
               a.name_norm, o.product_code,
               a.inn, a.inn_norm, a.atc, a.is_rx, a.producer, a.base_form,
               o.dosage, o.pack_size,
               o.drug_ref_id, r.price_cap_retail, r.price_cap_group_max,
               o.pharmacy_id, o.pharmacy_name, o.address,
               p.chain_key, p.phone, p.working_hours,
               p.lat, p.lng, p.rating, p.reviews_count,
               o.updated_label, o.updated_on, o.stores_total,
               o.source, o.source_url,
               CASE WHEN p.twogis_id IS NOT NULL
                    THEN 'https://2gis.kz/' || {_city_case('o.city')} || '/firm/' || p.twogis_id
                    ELSE NULL
               END AS twogis_url
        FROM pharmacy_offer o
        LEFT JOIN agg_product a ON a.id = o.agg_product_id
        LEFT JOIN drug_ref   r ON r.id = o.drug_ref_id
        LEFT JOIN pharmacy   p ON p.id = o.pharmacy_id
        WHERE o.price_kzt IS NOT NULL
        """
    )


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    keys = [k.strip() for k in _read_keys().split(",") if k.strip()]
    if not keys:
        raise SystemExit("нет TWOGIS_KEYS в .env")
    print(f"keys: {len(keys)}")

    cli = TwoGisClient(keys, use_cache=True)
    branches = fetch_rauza_branches(cli)
    print(f"rauza branches from 2GIS: {len(branches)}")
    for p in branches:
        if p.address and ("навои" in p.address.lower() or "орбит" in p.address.lower()):
            print(f"  ★ {p.rating} {p.address} firm/{p.twogis_id}")

    con = sqlite3.connect(MEDSALES)
    now = datetime.utcnow().isoformat(sep=" ")

    # 1) аптеки Раузы с firm id
    ph_ids = []
    for p in branches:
        ph_id = f"ph2gis_{p.twogis_id}"
        ph_ids.append(ph_id)
        exists = con.execute("SELECT id FROM pharmacy WHERE id=?", (ph_id,)).fetchone()
        if exists:
            con.execute(
                """
                UPDATE pharmacy SET name=?, chain=?, chain_key=?, city=?, address=?,
                  lat=?, lng=?, rating=?, reviews_count=?, twogis_id=?, source='2gis'
                WHERE id=?
                """,
                (
                    p.name, "Рауза", chain_key("Рауза"), city_slug(CITY), p.address,
                    p.lat, p.lng, p.rating, p.reviews_count, p.twogis_id, ph_id,
                ),
            )
        else:
            con.execute(
                """
                INSERT INTO pharmacy (
                  id, chain, chain_key, name, city, address, lat, lng,
                  rating, reviews_count, twogis_id, source, has_compounding
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)
                """,
                (
                    ph_id, "Рауза", chain_key("Рауза"), p.name, city_slug(CITY),
                    p.address, p.lat, p.lng, p.rating, p.reviews_count, p.twogis_id, "2gis",
                ),
            )

    # 2) цены: берём SKU уже спарсенные с сайта Раузы (source=rauza в agg)
    skus = list(
        con.execute(
            """SELECT id, code, name, name_norm, price_min, url FROM agg_product
               WHERE source='rauza' AND city=? AND price_min>0""",
            (CITY,),
        )
    )
    print(f"rauza catalog SKUs: {len(skus)}")

    # убрать старые offers без адреса (source=rauza на пустых pharmacy)
    con.execute("DELETE FROM pharmacy_offer WHERE source='rauza'")

    n_off = 0
    for agg_id, code, name, name_norm, price_min, url in skus:
        for ph_id, p in zip(ph_ids, branches):
            oid = det_id("po", "rauza2gis", CITY, code, p.twogis_id)
            con.execute(
                """
                INSERT INTO pharmacy_offer (
                  id, source, city, product_code, agg_product_id, pharmacy_id,
                  store_id, pharmacy_name, address, price_kzt, stores_total,
                  source_url, parsed_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    oid, "rauza", CITY, code, agg_id, ph_id, p.twogis_id,
                    p.name, p.address, float(price_min), len(branches),
                    url, now,
                ),
            )
            n_off += 1

    refresh_view(con)
    con.commit()

    print(f"offers written: {n_off}")
    # verify navoi
    for r in con.execute(
        """SELECT title, price_kzt, pharmacy_name, address, twogis_url, rating
           FROM v_drug_price
           WHERE city=? AND lower(COALESCE(address,'')) LIKE '%навои%'
           ORDER BY price_kzt LIMIT 8""",
        (CITY,),
    ):
        print(" NAVOI", r)

    print(
        "v_drug with lat",
        con.execute(
            "SELECT COUNT(*) FROM v_drug_price WHERE city=? AND lat IS NOT NULL", (CITY,)
        ).fetchone()[0],
    )
    con.close()
    print("quota:", cli.pool.report())


if __name__ == "__main__":
    main()
