"""Обогащение точек данными 2GIS: координаты, рейтинг, отзывы, twogis_id.

Запускается ОДИН раз на город — результат живёт в БД и в дисковом кэше,
повторный запуск квоту не тратит. Это важно: демо-ключ даёт всего 1000
запросов на сервис и живёт месяц.

Порядок обращения к квоте (сначала то, что даёт больше пользы на запрос):
  1. филиалы клиник без координат  — без них не построить маршрут;
  2. филиалы клиник без рейтинга   — доверие к клинике;
  3. аптеки по городам             — их можно искать пачками по рубрике.
"""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

from rapidfuzz import fuzz

from .twogis import TwoGisClient, firm_url

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB = ROOT / "data" / "medsales.db"

MIN_NAME_SCORE = 70   # ниже — считаем, что 2GIS нашёл не ту организацию


def _ensure_columns(con: sqlite3.Connection, table: str, cols: dict[str, str]) -> None:
    have = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
    for name, decl in cols.items():
        if name not in have:
            con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


def enrich_branches(db: Path, keys: list[str], *, city: str | None = None,
                    limit: int = 200, dry_run: bool = False) -> dict:
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    _ensure_columns(con, "branch", {
        "twogis_id": "TEXT", "twogis_url": "TEXT", "twogis_rating": "REAL",
        "twogis_reviews": "INTEGER", "geo_source": "TEXT",
    })

    where = "WHERE (b.lat IS NULL OR b.rating IS NULL OR b.twogis_id IS NULL)"
    params: list = []
    if city:
        where += " AND b.city = ?"
        params.append(city)

    rows = con.execute(f"""
        SELECT b.id, b.name, b.city, b.address, b.lat, b.lng, b.rating,
               br.name AS brand_name
        FROM branch b LEFT JOIN brand br ON br.id = b.brand_id
        {where} LIMIT ?
    """, (*params, limit)).fetchall()

    print(f"  [2gis] филиалов к обогащению: {len(rows)}")
    if dry_run:
        con.close()
        return {"planned": len(rows), "spent": 0}

    cli = TwoGisClient(keys)
    updated = skipped = 0
    for r in rows:
        query = " ".join(x for x in (r["brand_name"] or r["name"], r["address"]) if x)
        try:
            places = cli.search(query, r["city"], page_size=5)
        except Exception as exc:  # noqa: BLE001
            print(f"    {r['name'][:40]}: {type(exc).__name__} — {exc}")
            break
        if not places:
            skipped += 1
            continue

        # 2GIS вернёт что угодно похожее; берём лучший по названию и
        # отбрасываем, если совпадение слабое — чужой адрес хуже, чем пустой
        target = (r["brand_name"] or r["name"] or "").lower()
        best, best_score = None, -1.0
        for p in places:
            s = fuzz.token_set_ratio(target, p.name.lower())
            if s > best_score:
                best, best_score = p, s
        if best is None or best_score < MIN_NAME_SCORE:
            skipped += 1
            continue

        con.execute("""
            UPDATE branch SET
              lat = COALESCE(lat, ?), lng = COALESCE(lng, ?),
              address = COALESCE(address, ?),
              twogis_id = ?, twogis_url = ?, twogis_rating = ?, twogis_reviews = ?,
              geo_source = '2gis'
            WHERE id = ?
        """, (best.lat, best.lng, best.address, best.twogis_id,
              firm_url(best.twogis_id, r["city"]), best.rating,
              best.reviews_count, r["id"]))
        updated += 1

    con.commit()
    con.close()
    print(f"  [2gis] обновлено {updated}, пропущено {skipped} (слабое совпадение)")
    print(f"  [2gis] квота: {cli.pool.report()}")
    return {"updated": updated, "skipped": skipped}


def enrich_pharmacies(db: Path, keys: list[str], cities: list[str],
                      *, pages: int = 5) -> dict:
    """Аптеки берём пачками по рубрике: один запрос — до 10 организаций."""
    con = sqlite3.connect(db)
    _ensure_columns(con, "pharmacy", {"twogis_url": "TEXT"})
    cli = TwoGisClient(keys)
    added = 0
    for city in cities:
        for page in range(1, pages + 1):
            try:
                places = cli.search("аптека", city, page=page, page_size=10)
            except Exception as exc:  # noqa: BLE001
                print(f"    {city} стр.{page}: {type(exc).__name__} — {exc}")
                break
            if not places:
                break
            for p in places:
                con.execute("""
                    INSERT OR REPLACE INTO pharmacy
                      (id, chain, name, city, address, lat, lng, working_hours,
                       rating, reviews_count, twogis_id, has_compounding, is_24h,
                       source, twogis_url)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (f"ph_2gis_{p.twogis_id}", p.name, p.name, city, p.address,
                      p.lat, p.lng, p.working_hours, p.rating, p.reviews_count,
                      p.twogis_id, 0, 1 if p.is_24h else 0, "2gis", p.url))
                added += 1
        print(f"  [2gis] {city}: всего аптек в базе {added}")
    con.commit()
    con.close()
    print(f"  [2gis] квота: {cli.pool.report()}")
    return {"added": added}


def main() -> None:
    ap = argparse.ArgumentParser(description="Обогащение точек данными 2GIS")
    ap.add_argument("--keys", required=False, default="",
                    help="ключи 2GIS через запятую (или переменная TWOGIS_KEYS)")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--city", default=None)
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--pharmacies", action="store_true",
                    help="дополнительно собрать аптеки по рубрике")
    ap.add_argument("--dry-run", action="store_true",
                    help="показать объём работы, не тратя квоту")
    a = ap.parse_args()

    import os
    raw = a.keys or os.environ.get("TWOGIS_KEYS", "")
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys and not a.dry_run:
        raise SystemExit("нужен хотя бы один ключ: --keys ... или TWOGIS_KEYS=...")

    enrich_branches(Path(a.db), keys, city=a.city, limit=a.limit, dry_run=a.dry_run)
    if a.pharmacies and keys:
        enrich_pharmacies(Path(a.db), keys, [a.city] if a.city else ["Алматы", "Астана"])


if __name__ == "__main__":
    main()
