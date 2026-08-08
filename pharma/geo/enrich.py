"""Обогащение клиник и аптек данными 2GIS: гео, рейтинг, отзывы, deeplink.

Результат пишется в таблицу place_geo в pharma.db — намеренно ОТДЕЛЬНО от
самих точек. Сводная база medsales.db пересобирается из источников, и если
писать прямо в branch, каждая пересборка стирала бы данные, за которые
заплачено квотой ключа. merge.py накладывает place_geo поверх копий.

Квота демо-ключа: 1000 запросов на сервис, месяц. Один запрос — одна точка
(для клиник) или до 10 точек (для аптек по рубрике). Ответы кэшируются на
диск, повторный прогон сеть не трогает.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
from pathlib import Path

from rapidfuzz import fuzz

from ..db import get_session, init_db
from ..models import PlaceGeo
from .twogis import QuotaOrAuthError, TwoGisClient, city_slug, firm_url

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_SOURCE_DB = Path(r"C:\Users\abdra\Projects\med\data\medprice.db")

MIN_NAME_SCORE = 80   # 73 балла давал ложный матч «Bio Clinic» -> «Bio Med»:
                      # разные клиники, а отзывы приклеились бы чужие


def _read_keys() -> str:
    """Ключи из переменной окружения или из .env в корне проекта."""
    if os.environ.get("TWOGIS_KEYS"):
        return os.environ["TWOGIS_KEYS"]
    env = ROOT / ".env"
    if not env.exists():
        return ""
    for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip().lstrip("\ufeff")
        if not line or line.startswith("#"):
            continue
        name, sep, value = line.partition("=")
        if not sep:
            continue
        # оболочки затаскивают кавычки внутрь файла: "'TWOGIS_KEYS=k1,k2'" —
        # обычный результат echo с кавычками. Чистим, а не требуем идеальный файл.
        if name.strip().strip("\"'").lstrip("\ufeff").upper() == "TWOGIS_KEYS":
            return value.strip().strip("\"'")
    return ""


# Кириллица <-> латиница: «KDL Olymp» и «КДЛ Олимп» — одна организация, но
# посимвольно у них нет ничего общего, и любой fuzzy-скор даёт около нуля.
_TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "j", "з": "z", "и": "i", "й": "i", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "c", "ш": "s", "щ": "s", "ъ": "",
    "ы": "y", "ь": "", "э": "e", "ю": "u", "я": "a",
})


def _norm_org(name: str) -> str:
    """Имя организации к сравнимому виду.

    2GIS дописывает рубрику через запятую: «Invitro, медицинский центр».
    При сравнении с нашим «Invitro» лишние слова роняют token_set_ratio до 42,
    и верный матч отбрасывается. Рубрику отрезаем, остальное транслитерируем.
    """
    head = name.split(",")[0].strip().lower()
    head = head.replace("ё", "е")
    return " ".join(head.translate(_TRANSLIT).split())


def _pick_best(places, target: str):
    """Лучший кандидат по нормализованному имени.

    Берём максимум из token_set_ratio и partial_ratio: первый устойчив к
    перестановке слов, второй — к тому, что одно имя является частью другого
    («Invivo» внутри «Invivo VDP»).
    """
    t = _norm_org(target)
    best, score = None, -1.0
    for p in places:
        n = _norm_org(p.name)
        s = max(fuzz.token_set_ratio(t, n), fuzz.partial_ratio(t, n))
        if s > score:
            best, score = p, s
    return best, score


def enrich_clinics(source_db: Path, keys: list[str], *, city: str | None = None,
                   limit: int = 400, dry_run: bool = False) -> dict:
    """Клиники: один запрос на филиал (нужен точный адрес, пачкой не выйдет)."""
    init_db()
    src = sqlite3.connect(source_db)
    src.row_factory = sqlite3.Row
    done = {r[0] for r in get_session().query(PlaceGeo.place_id).filter(
        PlaceGeo.kind == "clinic").all()}

    q = """SELECT b.id, b.name, b.city, b.address, br.name AS brand_name
           FROM branch b LEFT JOIN brand br ON br.id = b.brand_id"""
    params: list = []
    if city:
        # в базе услуг город записан слагом ('almaty'), а с командной строки
        # его удобнее передавать по-русски — принимаем оба варианта
        q += " WHERE b.city = ?"
        params.append(city_slug(city))
    rows = [r for r in src.execute(q, params).fetchall() if r["id"] not in done][:limit]
    src.close()

    print(f"  [2gis] клиник к обогащению: {len(rows)} (уже обработано: {len(done)})")
    if dry_run or not rows:
        return {"planned": len(rows), "spent": 0}

    cli = TwoGisClient(keys)
    session = get_session()
    ok = weak = missing = failed = 0
    for i, r in enumerate(rows, 1):
        target = r["brand_name"] or r["name"] or ""
        query = " ".join(x for x in (target, r["address"]) if x)
        try:
            places = cli.search(query, r["city"], page_size=5)
        except QuotaOrAuthError as exc:
            # только это действительно повод остановиться
            print(f"    остановка на {i}/{len(rows)}: {exc}")
            break
        except Exception as exc:  # noqa: BLE001
            # сеть моргнула или ответ кривой — пропускаем точку, идём дальше
            failed += 1
            print(f"    [{i}] {target[:28]}: {type(exc).__name__}, пропуск")
            continue
        if not places:
            missing += 1
            continue
        best, score = _pick_best(places, target)
        if best is None or score < MIN_NAME_SCORE:
            weak += 1
            continue
        session.merge(PlaceGeo(
            place_id=r["id"], kind="clinic", twogis_id=best.twogis_id,
            twogis_url=firm_url(best.twogis_id, r["city"]), name_2gis=best.name,
            address=best.address, lat=best.lat, lng=best.lng,
            rating=best.rating, reviews_count=best.reviews_count, match_score=score,
        ))
        ok += 1
        if i % 25 == 0:
            session.commit()
            print(f"    [{i}/{len(rows)}] сохранено {ok}, слабых {weak} | {cli.pool.report()}")
    session.commit()
    session.close()
    print(f"  [2gis] клиники: сохранено {ok}, слабое совпадение {weak}, нет в 2GIS {missing}, сбоев {failed}")
    print(f"  [2gis] квота: {cli.pool.report()}")
    return {"clinics_ok": ok, "clinics_weak": weak,
            "clinics_missing": missing, "clinics_failed": failed}


def enrich_pharmacies(keys: list[str], cities: list[str], *, pages: int = 5) -> dict:
    """Аптеки: рубричный поиск, один запрос отдаёт до 10 организаций."""
    init_db()
    cli = TwoGisClient(keys)
    session = get_session()
    added = 0
    for city in cities:
        got = 0
        for page in range(1, pages + 1):
            try:
                places = cli.search("аптека", city, page=page, page_size=10)
            except QuotaOrAuthError as exc:
                print(f"    {city}: квота/ключ — {exc}")
                return {"pharmacies": added}
            except Exception as exc:  # noqa: BLE001
                print(f"    {city} стр.{page}: {type(exc).__name__}, пропуск страницы")
                continue
            if not places:
                break
            for p in places:
                session.merge(PlaceGeo(
                    place_id=f"ph2gis_{p.twogis_id}", kind="pharmacy",
                    twogis_id=p.twogis_id, twogis_url=firm_url(p.twogis_id, city),
                    name_2gis=p.name, address=p.address, lat=p.lat, lng=p.lng,
                    rating=p.rating, reviews_count=p.reviews_count, match_score=100.0,
                ))
                got += 1
            session.commit()
        added += got
        print(f"  [2gis] {city}: аптек получено {got}")
    session.close()
    print(f"  [2gis] квота: {cli.pool.report()}")
    return {"pharmacies": added}


def main() -> None:
    ap = argparse.ArgumentParser(description="Обогащение клиник и аптек через 2GIS")
    ap.add_argument("--keys", default="", help="ключи через запятую (иначе .env / TWOGIS_KEYS)")
    ap.add_argument("--source-db", default=str(DEFAULT_SOURCE_DB),
                    help="база с таблицами branch/brand (medprice.db)")
    ap.add_argument("--city", default=None)
    ap.add_argument("--limit", type=int, default=400)
    ap.add_argument("--clinics", action="store_true")
    ap.add_argument("--pharmacies", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    keys = [k.strip() for k in (a.keys or _read_keys()).split(",") if k.strip()]
    if not keys and not a.dry_run:
        raise SystemExit("нужен ключ: --keys ..., TWOGIS_KEYS=... или строка в .env")
    if keys:
        # ключ целиком не печатаем: логи утекают в репозитории и чаты
        print(f"  [2gis] ключей загружено: {len(keys)} "
              f"({', '.join('...' + k[-4:] for k in keys)})")

    if a.clinics or not (a.clinics or a.pharmacies):
        enrich_clinics(Path(a.source_db), keys, city=a.city,
                       limit=a.limit, dry_run=a.dry_run)
    if a.pharmacies and keys:
        cities = [a.city] if a.city else ["Алматы", "Астана", "Шымкент", "Караганда"]
        enrich_pharmacies(keys, cities)


if __name__ == "__main__":
    main()
