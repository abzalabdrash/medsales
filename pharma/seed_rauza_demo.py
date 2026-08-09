# -*- coding: utf-8 -*-
"""Точечный добор с rauza-ade.kz: поиск → карточка → prices по point_id.

Сеть отдаёт Nuxt payload с позициями по аптекам (price + point_id). Адреса
точек берём из organization в том же payload / с главной.
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pharma.db import det_id, norm_name, chain_key  # noqa: E402

MEDSALES = ROOT / "data" / "medsales.db"
BASE = "https://rauza-ade.kz"
UA = {"User-Agent": "MedRouteKZ/1.0 (hackathon; contact: abdrashabzal.bs@gmail.com)"}
CITY = "almaty"
QUERIES = [
    "олиго цинк",
    "кальций д3 никомед",
    "аевит",
    "гиоксизон",
    "санипласт",
    "цинковая паста",
    "уголь активированный",
]


def resolve(data, idx, depth=0):
    if depth > 12:
        return None
    if not isinstance(idx, int) or idx < 0 or idx >= len(data):
        return idx
    x = data[idx]
    if isinstance(x, (str, int, float, bool)) or x is None:
        return x
    if isinstance(x, list):
        return [resolve(data, i, depth + 1) for i in x]
    if isinstance(x, dict):
        return {k: resolve(data, v, depth + 1) for k, v in x.items()}
    return None


def nuxt_data(html: str):
    m = re.search(r'id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        return None
    return json.loads(m.group(1))


def load_points(cli: httpx.Client) -> dict[str, dict]:
    """point_id -> {name, address, ...} из organization на главной."""
    r = cli.get(BASE + "/")
    data = nuxt_data(r.text)
    if not data:
        return {}
    # organization index varies; walk for dicts with address-like fields
    points: dict[str, dict] = {}
    for x in data:
        if not isinstance(x, dict):
            continue
        # look for objects that have _id and address/title
        keys = set(x.keys())
        if "_id" in keys and ("address" in keys or "addr" in keys or "title" in keys or "name" in keys):
            # unresolved refs — skip, need resolve via parent
            pass

    # Try pinia/state path: find "organization" string then nearby
    # Simpler: fetch a product and also walk resolved organization from home pinia
    # Parse all fully by resolving from known home structure data[3] organization
    try:
        org_ref = data[3].get("organization") if isinstance(data[3], dict) else None
        org = resolve(data, org_ref) if isinstance(org_ref, int) else None
    except Exception:
        org = None

    def absorb(obj, trail=""):
        if isinstance(obj, dict):
            pid = obj.get("_id") or obj.get("id") or obj.get("point_id")
            addr = obj.get("address") or obj.get("addr") or obj.get("fullAddress")
            name = obj.get("name") or obj.get("title") or obj.get("publishName")
            if pid and (addr or name):
                points[str(pid)] = {
                    "name": name or "Рауза-АДЕ",
                    "address": addr,
                    "lat": obj.get("lat") or obj.get("latitude"),
                    "lng": obj.get("lng") or obj.get("lon") or obj.get("longitude"),
                }
            for v in obj.values():
                absorb(v, trail)
        elif isinstance(obj, list):
            for v in obj:
                absorb(v, trail)

    if org:
        absorb(org)
    # also dump search in raw for point-like
    if len(points) < 3:
        # brute: resolve every dict that looks like a pharmacy point
        for i, x in enumerate(data):
            if not isinstance(x, dict):
                continue
            if "address" in x and ("_id" in x or "id" in x):
                try:
                    obj = resolve(data, i)
                    absorb(obj)
                except Exception:
                    continue
    return points


def search_skus(cli: httpx.Client, q: str) -> list[str]:
    url = f"{BASE}/catalog/all?search={quote(q)}"
    r = cli.get(url)
    skus = re.findall(r"/products/(\d+)", r.text)
    # unique preserve order
    out, seen = [], set()
    for s in skus:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out[:8]


def fetch_product(cli: httpx.Client, sku: str) -> dict | None:
    r = cli.get(f"{BASE}/products/{sku}")
    data = nuxt_data(r.text)
    if not data or not isinstance(data[2], dict):
        return None
    key = f"getItemByID_{sku}"
    if key not in data[2]:
        # try any getItemByID_
        key = next((k for k in data[2] if k.startswith("getItemByID_")), None)
        if not key:
            return None
    ref = data[2][key]
    node = resolve(data, ref)
    if not isinstance(node, dict) or "item" not in node:
        return None
    item = node["item"] if isinstance(node["item"], dict) else resolve(data, node["item"])
    if not isinstance(item, dict):
        return None
    return item


def upsert(item: dict, points: dict[str, dict]) -> int:
    name = item.get("name") or item.get("publishName") or ""
    sku = str(item.get("sku") or "")
    positions = item.get("positions") or []
    if not name or not positions:
        return 0

    con = sqlite3.connect(MEDSALES)
    now = datetime.utcnow().isoformat(sep=" ")
    code = f"rauza-{sku}"
    agg_id = det_id("ag", "rauza", CITY, code)
    prices = [p["price"] for p in positions if isinstance(p.get("price"), (int, float)) and p["price"] > 0]
    if not prices:
        con.close()
        return 0

    # wipe previous demo rows for this code
    con.execute("DELETE FROM pharmacy_offer WHERE source='rauza' AND product_code=?", (code,))
    old = con.execute(
        "SELECT id FROM agg_product WHERE source='rauza' AND code=?", (code,)
    ).fetchall()
    for (oid,) in old:
        con.execute("DELETE FROM agg_product WHERE id=?", (oid,))

    con.execute(
        """
        INSERT INTO agg_product (
          id, source, code, city, name, name_norm, extended_name,
          price_min, price_max, category, url, parsed_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            agg_id, "rauza", code, CITY, name, norm_name(name), name,
            min(prices), max(prices), "rauza", f"{BASE}/products/{sku}", now,
        ),
    )

    n = 0
    for pos in positions:
        price = pos.get("price")
        point_id = str(pos.get("point_id") or "")
        if not price or not point_id:
            continue
        pt = points.get(point_id, {})
        ph_name = pt.get("name") or "Рауза-АДЕ"
        address = pt.get("address")
        ph_id = det_id("ph", "rauza", point_id)
        if not con.execute("SELECT id FROM pharmacy WHERE id=?", (ph_id,)).fetchone():
            con.execute(
                """
                INSERT INTO pharmacy (
                  id, chain, chain_key, name, city, address, lat, lng, source, has_compounding
                ) VALUES (?,?,?,?,?,?,?,?,?,0)
                """,
                (
                    ph_id, "Рауза", chain_key("Рауза"), ph_name, CITY, address,
                    pt.get("lat"), pt.get("lng"), "rauza",
                ),
            )
        oid = det_id("po", "rauza", CITY, code, point_id)
        con.execute(
            """
            INSERT INTO pharmacy_offer (
              id, source, city, product_code, agg_product_id, pharmacy_id, store_id,
              pharmacy_name, address, price_kzt, stores_total, source_url, parsed_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                oid, "rauza", CITY, code, agg_id, ph_id, point_id,
                ph_name, address, float(price), len(positions),
                f"{BASE}/products/{sku}", now,
            ),
        )
        n += 1
    con.commit()
    con.close()
    return n


def refresh_view():
    from pharma.merge import _city_case

    con = sqlite3.connect(MEDSALES)
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
                    ELSE 'https://2gis.kz/' || {_city_case('o.city')} || '/search/' ||
                         replace(COALESCE(o.pharmacy_name,'') || ' ' || COALESCE(o.address,''), ' ', '%20')
               END AS twogis_url
        FROM pharmacy_offer o
        LEFT JOIN agg_product a ON a.id = o.agg_product_id
        LEFT JOIN drug_ref   r ON r.id = o.drug_ref_id
        LEFT JOIN pharmacy   p ON p.id = o.pharmacy_id
        WHERE o.price_kzt IS NOT NULL
        """
    )
    con.commit()
    con.close()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with httpx.Client(headers=UA, timeout=60, follow_redirects=True, verify=False) as cli:
        print("loading rauza points...")
        points = load_points(cli)
        print(f"  points: {len(points)}")
        if points:
            sample = next(iter(points.values()))
            print("  sample", sample)

        seen_sku: set[str] = set()
        total = 0
        for q in QUERIES:
            print(f"\n=== search {q!r} ===")
            skus = search_skus(cli, q)
            print("  skus", skus[:6])
            for sku in skus[:4]:
                if sku in seen_sku:
                    continue
                seen_sku.add(sku)
                time.sleep(0.6)
                item = fetch_product(cli, sku)
                if not item:
                    print("  fail", sku)
                    continue
                n = upsert(item, points)
                print(f"  {item.get('name')} -> {n} offers")
                total += n

    refresh_view()
    print("\nTOTAL offers", total)
    con = sqlite3.connect(MEDSALES)
    print("rauza pharmacies", con.execute("SELECT COUNT(*) FROM pharmacy WHERE source='rauza'").fetchone()[0])
    print("rauza offers", con.execute("SELECT COUNT(*) FROM pharmacy_offer WHERE source='rauza'").fetchone()[0])
    for r in con.execute(
        """SELECT title, price_kzt, pharmacy_name, address FROM v_drug_price
           WHERE source='rauza' ORDER BY title, price_kzt LIMIT 8"""
    ):
        print(" ", r)
    con.close()


if __name__ == "__main__":
    main()
