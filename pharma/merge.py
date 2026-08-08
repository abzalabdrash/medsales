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
PHARMA_TABLES = ["drug_ref", "drug_offer", "pharmacy", "free_drug", "inn_price_cap"]

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
               NULL AS twogis_id, 0 AS has_compounding,
               'https://2gis.kz/' || {_city_case('b.city')} || '/search/' ||
                   replace(COALESCE(b.address, b.name), ' ', '%20') AS twogis_search_url
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

    con.commit()
    counts = {
        "v_place": con.execute("SELECT COUNT(*) FROM v_place").fetchone()[0],
        "v_item": con.execute("SELECT COUNT(*) FROM v_item").fetchone()[0],
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
