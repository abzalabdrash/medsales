# -*- coding: utf-8 -*-
"""Демо-добор SKU на все 2GIS-филиалы Раузы: кальций, гиоксизон, safeguard.

Навои уже имел уголь/аевит/олиго/цинк/санипласт. Без этих трёх one-stop
по рецепту акне невозможен.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pharma.db import det_id  # noqa: E402

MEDSALES = ROOT / "data" / "medsales.db"
CITY = "almaty"

# code, display name, price — берём ориентиры с agg города / демо
EXTRA = [
    ("rauza-demo-ca-d3", "Кальций д3 никомед форте", 2255.0),
    ("rauza-demo-hyoxysone", "Гиоксизон", 700.0),
    ("rauza-demo-safeguard", "Safeguard 100 г мыло с ромашкой", 135.0),
]


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
    con = sqlite3.connect(MEDSALES)
    now = datetime.utcnow().isoformat(sep=" ")
    branches = list(
        con.execute(
            """SELECT id, name, address, twogis_id FROM pharmacy
               WHERE city=? AND source='2gis' AND chain LIKE '%Рауза%'
                 AND twogis_id IS NOT NULL""",
            (CITY,),
        )
    )
    print(f"rauza 2gis branches: {len(branches)}")
    if not branches:
        raise SystemExit("no branches")

    for code, name, price in EXTRA:
        name_norm = name.lower().replace("ё", "е")
        agg_id = det_id("ag", "rauza", CITY, code)
        con.execute("DELETE FROM pharmacy_offer WHERE product_code=?", (code,))
        con.execute("DELETE FROM agg_product WHERE id=?", (agg_id,))
        con.execute(
            """
            INSERT INTO agg_product (
              id, source, code, city, name, name_norm, price_min, price_max,
              parsed_at
            ) VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (agg_id, "rauza", code, CITY, name, name_norm, price, price, now),
        )
        for ph_id, ph_name, addr, twogis_id in branches:
            oid = det_id("po", "rauza2gis", CITY, code, twogis_id)
            con.execute(
                """
                INSERT INTO pharmacy_offer (
                  id, source, city, product_code, agg_product_id, pharmacy_id,
                  store_id, pharmacy_name, address, price_kzt, stores_total,
                  parsed_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    oid, "rauza", CITY, code, agg_id, ph_id, twogis_id,
                    ph_name, addr, price, len(branches), now,
                ),
            )
        print(f"  + {name} @ {price} x {len(branches)}")

    refresh_view(con)
    con.commit()

    navoi = "ph2gis_70000001093481720"
    print("Navoi SKUs now:")
    for r in con.execute(
        "SELECT title, price_kzt FROM v_drug_price WHERE pharmacy_id=? ORDER BY title",
        (navoi,),
    ):
        print(f"  {r[1]} | {r[0]}")
    con.close()


if __name__ == "__main__":
    main()
