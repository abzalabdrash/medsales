"""Склейка двух баз в одну: data/medsales.db.

Было: medprice.db (услуги, клиники, отзывы) и pharma.db (препараты, льготы).
Стало: одна база, которую можно отдать разработчику агента без объяснений,
какой файл к чему.

Помимо копирования таблиц создаются два представления, вокруг которых
удобно строить и RAG, и выдачу:

  v_place  единая точка на карте — и клиника, и аптека, с рейтингом и
           готовым deeplink'ом в 2GIS;
  v_item   единая позиция чека — и медуслуга, и препарат, с ценой и городом.

Благодаря им агент задаёт один вопрос к одной таблице вместо ветвления
«это услуга или лекарство» на каждом шаге.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "medsales.db"
PHARMA_DB = DATA / "pharma.db"
DEFAULT_MEDPRICE = Path(r"C:\Users\abdra\Projects\med\data\medprice.db")

SERVICE_TABLES = ["brand", "branch", "canonical_service", "price", "review", "price_snapshot"]
PHARMA_TABLES = ["drug_ref", "drug_offer", "pharmacy", "free_drug",
                 "inn_price_cap", "place_geo", "place_review"]

CITY_SLUG = {
    "Алматы": "almaty", "Астана": "astana", "Шымкент": "shymkent",
    "Караганда": "karaganda", "Актобе": "aktobe", "Тараз": "taraz",
    "Павлодар": "pavlodar", "Костанай": "kostanay", "Атырау": "atyrau",
    "Актау": "aktau", "Кызылорда": "kyzylorda", "Петропавловск": "petropavlovsk",
    "Талдыкорган": "taldykorgan",
}


def _copy_tables(con: sqlite3.Connection, alias: str, tables: list[str]) -> dict[str, int]:
    done: dict[str, int] = {}
    for t in tables:
        exists = con.execute(
            f"SELECT name FROM {alias}.sqlite_master WHERE type='table' AND name=?", (t,)
        ).fetchone()
        if not exists:
            done[t] = -1
            continue
        con.execute(f"DROP TABLE IF EXISTS main.{t}")
        con.execute(f"CREATE TABLE main.{t} AS SELECT * FROM {alias}.{t}")
        done[t] = con.execute(f"SELECT COUNT(*) FROM main.{t}").fetchone()[0]
    return done


def _city_case(col: str) -> str:
    whens = " ".join(f"WHEN '{ru}' THEN '{lat}'" for ru, lat in CITY_SLUG.items())
    return f"CASE {col} {whens} ELSE 'almaty' END"


def build(medprice_db: Path = DEFAULT_MEDPRICE, out: Path = OUT) -> dict:
    if not PHARMA_DB.exists():
        raise FileNotFoundError(f"нет {PHARMA_DB} — сначала запустите ingest_ref")
    out.unlink(missing_ok=True)

    con = sqlite3.connect(out)
    stats: dict[str, int] = {}

    con.execute("ATTACH DATABASE ? AS ph", (str(PHARMA_DB),))
    stats.update(_copy_tables(con, "ph", PHARMA_TABLES))
    con.execute("DETACH DATABASE ph")

    if medprice_db.exists():
        con.execute("ATTACH DATABASE ? AS sv", (str(medprice_db),))
        stats.update(_copy_tables(con, "sv", SERVICE_TABLES))
        con.execute("DETACH DATABASE sv")
    else:
        print(f"  [merge] {medprice_db} не найдена — база собрана только из препаратов")
        for t in SERVICE_TABLES:
            stats[t] = -1

    # --- наложение обогащения 2GIS --------------------------------------
    # place_geo собрано за квоту ключа и живёт отдельно, чтобы пересборка
    # сводной базы его не стирала. Здесь оно накладывается на копии таблиц.
    if stats.get("place_geo", -1) > 0 and stats.get("branch", -1) > 0:
        for col, decl in [("twogis_id", "TEXT"), ("twogis_url", "TEXT"),
                          ("twogis_rating", "REAL"), ("twogis_reviews", "INTEGER")]:
            try:
                con.execute(f"ALTER TABLE branch ADD COLUMN {col} {decl}")
            except sqlite3.OperationalError:
                pass
        con.execute("""
            UPDATE branch SET
              lat = COALESCE(lat, (SELECT g.lat FROM place_geo g WHERE g.place_id = branch.id)),
              lng = COALESCE(lng, (SELECT g.lng FROM place_geo g WHERE g.place_id = branch.id)),
              address = COALESCE(address, (SELECT g.address FROM place_geo g WHERE g.place_id = branch.id)),
              twogis_id     = (SELECT g.twogis_id     FROM place_geo g WHERE g.place_id = branch.id),
              twogis_url    = (SELECT g.twogis_url    FROM place_geo g WHERE g.place_id = branch.id),
              twogis_rating = (SELECT g.rating        FROM place_geo g WHERE g.place_id = branch.id),
              twogis_reviews= (SELECT g.reviews_count FROM place_geo g WHERE g.place_id = branch.id)
            WHERE EXISTS (SELECT 1 FROM place_geo g WHERE g.place_id = branch.id)
        """)
        # рейтинг из 2GIS используем только там, где своего нет:
        # 103.kz и 2GIS считают по-разному, смешивать их в одном поле нельзя
        con.execute("UPDATE branch SET rating = twogis_rating "
                    "WHERE rating IS NULL AND twogis_rating IS NOT NULL")
        con.execute("UPDATE branch SET reviews_count = twogis_reviews "
                    "WHERE reviews_count IS NULL AND twogis_reviews IS NOT NULL")
        stats["branch_enriched"] = con.execute(
            "SELECT COUNT(*) FROM branch WHERE twogis_id IS NOT NULL").fetchone()[0]

    # аптеки из 2GIS переносим в таблицу pharmacy
    if stats.get("place_geo", -1) > 0:
        con.execute("""
            INSERT OR REPLACE INTO pharmacy
              (id, chain, name, city, address, lat, lng, rating, reviews_count,
               twogis_id, has_compounding, source)
            SELECT g.place_id,
                   TRIM(SUBSTR(g.name_2gis, 1, COALESCE(NULLIF(INSTR(g.name_2gis, ','), 0) - 1, LENGTH(g.name_2gis)))),
                   g.name_2gis, COALESCE(g.city, ''), g.address, g.lat, g.lng, g.rating, g.reviews_count,
                   g.twogis_id, 0, '2gis'
            FROM place_geo g WHERE g.kind = 'pharmacy'
        """)
        stats["pharmacy"] = con.execute("SELECT COUNT(*) FROM pharmacy").fetchone()[0]

    # --- индексы: без них джойн препаратов к предложениям ползёт ---------
    for stmt in [
        "CREATE INDEX IF NOT EXISTS ix_offer_ref   ON drug_offer(drug_ref_id)",
        "CREATE INDEX IF NOT EXISTS ix_offer_bc    ON drug_offer(barcode)",
        "CREATE INDEX IF NOT EXISTS ix_ref_inn     ON drug_ref(inn_norm)",
        "CREATE INDEX IF NOT EXISTS ix_ref_atc     ON drug_ref(atc)",
        "CREATE INDEX IF NOT EXISTS ix_free_atc    ON free_drug(atc)",
    ]:
        try:
            con.execute(stmt)
        except sqlite3.OperationalError:
            pass
    if stats.get("price", -1) > 0:
        for stmt in [
            "CREATE INDEX IF NOT EXISTS ix_price_branch ON price(branch_id)",
            "CREATE INDEX IF NOT EXISTS ix_price_canon  ON price(canonical_service_id)",
        ]:
            try:
                con.execute(stmt)
            except sqlite3.OperationalError:
                pass

    # --- v_place: клиники и аптеки в одной таблице ----------------------
    has_branch = stats.get("branch", -1) > 0
    clinic_part = f"""
        SELECT 'clinic' AS kind, b.id AS place_id, br.name AS org_name,
               b.name AS place_name, b.city, b.address, b.lat, b.lng,
               b.rating, b.reviews_count, b.working_hours, b.phone,
               b.twogis_id, 0 AS has_compounding,
               COALESCE(b.twogis_url,
                        'https://2gis.kz/' || {_city_case('b.city')} || '/search/' ||
                        replace(COALESCE(b.address, b.name), ' ', '%20')) AS twogis_search_url
        FROM branch b LEFT JOIN brand br ON br.id = b.brand_id
    """ if has_branch else ""

    pharmacy_part = f"""
        SELECT 'pharmacy' AS kind, p.id AS place_id, p.chain AS org_name,
               COALESCE(p.name, p.chain) AS place_name, p.city, p.address, p.lat, p.lng,
               p.rating, p.reviews_count, p.working_hours, p.phone,
               p.twogis_id, p.has_compounding,
               CASE WHEN p.twogis_id IS NOT NULL
                    THEN 'https://2gis.kz/' || {_city_case('p.city')} || '/firm/' || p.twogis_id
                    ELSE NULL END AS twogis_search_url
        FROM pharmacy p
    """
    body = f"{clinic_part} UNION ALL {pharmacy_part}" if has_branch else pharmacy_part
    con.execute(f"CREATE VIEW v_place AS {body}")

    # --- v_item: услуги и препараты в одной таблице ----------------------
    service_part = """
        SELECT 'service' AS kind, p.id AS item_id,
               COALESCE(cs.name_ru, p.service_name_raw) AS title,
               NULL AS inn, NULL AS atc, p.price_kzt AS price,
               b.city, b.id AS place_id, br.name AS org_name,
               NULL AS pack_size, NULL AS price_cap_retail, NULL AS is_rx,
               p.source_url
        FROM price p
        JOIN branch b ON b.id = p.branch_id
        LEFT JOIN brand br ON br.id = b.brand_id
        LEFT JOIN canonical_service cs ON cs.id = p.canonical_service_id
    """ if stats.get("price", -1) > 0 else ""

    drug_part = """
        SELECT 'drug' AS kind, o.id AS item_id,
               COALESCE(r.tn, o.name_raw) AS title,
               r.inn, r.atc, o.price_kzt AS price,
               o.city, o.pharmacy_id AS place_id, o.chain AS org_name,
               r.pack_size, r.price_cap_retail, o.is_rx,
               o.source_url
        FROM drug_offer o LEFT JOIN drug_ref r ON r.id = o.drug_ref_id
    """
    body = f"{service_part} UNION ALL {drug_part}" if service_part else drug_part
    con.execute(f"CREATE VIEW v_item AS {body}")

    # --- v_review: отзывы обоих источников, но источник виден всегда ------
    # Шкалы и базы у 103.kz и 2GIS разные, поэтому не усредняем и не смешиваем —
    # просто складываем рядом с пометкой, откуда взято.
    parts = []
    if stats.get("review", -1) > 0:
        parts.append("""
            SELECT '103kz' AS source, r.brand_id AS place_id, 'clinic' AS kind,
                   r.rating, r.text, r.author, r.created_at
            FROM review r
        """)
    if stats.get("place_review", -1) > 0:
        parts.append("""
            SELECT pr.source, pr.place_id, pr.kind,
                   pr.rating, pr.text, pr.author, pr.created_at
            FROM place_review pr
        """)
    if parts:
        con.execute("CREATE VIEW v_review AS " + " UNION ALL ".join(parts))
        con.execute("CREATE INDEX IF NOT EXISTS ix_prev_place ON place_review(place_id)")

    con.commit()
    counts = {
        "v_place": con.execute("SELECT COUNT(*) FROM v_place").fetchone()[0],
        "v_item": con.execute("SELECT COUNT(*) FROM v_item").fetchone()[0],
        "v_review": (con.execute("SELECT COUNT(*) FROM v_review").fetchone()[0]
                     if parts else 0),
    }
    con.close()
    return {**stats, **counts}


if __name__ == "__main__":
    import sys
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MEDPRICE
    s = build(src)
    print("\n" + "=" * 56)
    print(f"  ЕДИНАЯ БАЗА: {OUT}")
    print("=" * 56)
    for t in PHARMA_TABLES + SERVICE_TABLES:
        n = s.get(t, -1)
        print(f"  {t:20} {'—' if n < 0 else n:>8}")
    print("  " + "-" * 30)
    print(f"  {'v_place (view)':20} {s['v_place']:>8}")
    print(f"  {'v_item  (view)':20} {s['v_item']:>8}")
    print(f"  {'v_review (view)':20} {s['v_review']:>8}")
