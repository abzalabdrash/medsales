"""Тексты отзывов о клиниках и аптеках из 2GIS.

ВАЖНО ПРО ДОСТУП. Проверено на живых ключах:
  * Places API (демо-ключ) отдаёт по отзывам ТОЛЬКО агрегаты —
    general_rating и general_review_count. Текстов там нет.
  * Тот же демо-ключ на public-api.reviews.2gis.com даёт 403 FORBIDDEN:
    отзывы — отдельный продукт, в демо-доступ не входят.
  * Страница 2gis.kz/{city}/firm/{id}/tab/reviews — SPA-оболочка на 11 КБ,
    отзывы подгружаются скриптом, в HTML их нет.

Остаётся ключ, который 2GIS публикует в своём веб-клиенте. Он лежит в
открытом виде на их сайте, данные тоже публичные, но ключ НЕ НАШ: его могут
сменить в любой момент, и на такой основе нельзя строить продакшн.
Поэтому:
  * ключ вынесен в настройку TWOGIS_REVIEWS_KEY — как только появится
    собственный доступ, меняется одна строка в .env;
  * задержка между запросами 1 секунда, ответы кэшируются на диск;
  * модуль опционален: без него в базе остаются 1 260 отзывов из 103.kz.

Для продакшна правильный путь — запросить доступ к Reviews API у 2GIS.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import httpx

from ..db import get_session, init_db
from ..models import PlaceGeo, PlaceReview
from .enrich import _read_keys  # noqa: F401  (единый способ чтения .env)

ROOT = Path(__file__).resolve().parent.parent.parent
CACHE = ROOT / "data" / "cache" / "2gis_reviews"
CACHE.mkdir(parents=True, exist_ok=True)

API = "https://public-api.reviews.2gis.com/2.0/branches/{fid}/reviews"
# Ключ веб-клиента 2GIS. Замените на собственный, когда получите доступ.
DEFAULT_KEY = "6e7e1929-4ea9-4a5d-8c05-d601860389bd"
DELAY = 1.0
UA = {"User-Agent": "MedRouteKZ/1.0 (hackathon research)", "Accept-Language": "ru-RU,ru;q=0.9"}


def _key() -> str:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
            name, sep, value = line.strip().partition("=")
            if sep and name.strip().strip("\"'").upper() == "TWOGIS_REVIEWS_KEY":
                return value.strip().strip("\"'")
    return DEFAULT_KEY


def fetch_reviews(fid: str, *, limit: int = 20, key: str | None = None) -> list[dict]:
    """Отзывы одного филиала. Пустой список — нормальный результат."""
    cp = CACHE / f"{fid}.json"
    if cp.exists():
        return json.loads(cp.read_text(encoding="utf-8"))

    params = {"limit": limit, "is_advertiser": "false", "key": key or _key(),
              "locale": "ru_KZ", "sort_by": "friends"}
    time.sleep(DELAY)
    r = httpx.get(API.format(fid=fid), params=params, timeout=25,
                  verify=False, headers=UA)
    if r.status_code == 403:
        raise PermissionError(
            "403 от Reviews API — ключ не даёт доступа к отзывам. "
            "Укажите TWOGIS_REVIEWS_KEY в .env или запросите доступ у 2GIS.")
    if r.status_code == 404:
        cp.write_text("[]", encoding="utf-8")
        return []
    r.raise_for_status()
    items = r.json().get("reviews") or []
    out = [{
        "review_id": str(x.get("id") or ""),
        "rating": x.get("rating"),
        "text": (x.get("text") or "").strip(),
        "created_at": x.get("date_created"),
        "author": ((x.get("user") or {}).get("name") or None),
        "likes": x.get("likes_count"),
    } for x in items if (x.get("text") or "").strip()]
    cp.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def run(*, kind: str | None = None, limit_places: int = 500,
        per_place: int = 20) -> dict:
    init_db()
    session = get_session()
    q = session.query(PlaceGeo).filter(PlaceGeo.twogis_id.isnot(None))
    if kind:
        q = q.filter(PlaceGeo.kind == kind)
    places = q.limit(limit_places).all()
    print(f"  [отзывы] точек к обходу: {len(places)}")

    saved = empty = failed = 0
    for i, p in enumerate(places, 1):
        try:
            items = fetch_reviews(p.twogis_id, limit=per_place)
        except PermissionError as exc:
            print(f"    остановка: {exc}")
            break
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"    [{i}] {p.twogis_id}: {type(exc).__name__}, пропуск")
            continue
        if not items:
            empty += 1
            continue
        for it in items:
            session.merge(PlaceReview(
                id=f"2gis_{p.twogis_id}_{it['review_id']}",
                place_id=p.place_id, kind=p.kind, twogis_id=p.twogis_id,
                rating=it["rating"], text=it["text"], author=it["author"],
                created_at=it["created_at"], likes=it["likes"], source="2gis",
            ))
            saved += 1
        if i % 25 == 0:
            session.commit()
            print(f"    [{i}/{len(places)}] отзывов сохранено {saved}")
    session.commit()
    total = session.query(PlaceReview).count()
    session.close()
    print(f"  [отзывы] сохранено {saved}, без отзывов {empty}, сбоев {failed}")
    print(f"  [отзывы] всего в базе: {total}")
    return {"saved": saved, "empty": empty, "failed": failed, "total": total}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Тексты отзывов 2GIS")
    ap.add_argument("--kind", choices=["clinic", "pharmacy"], default=None)
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--per-place", type=int, default=20)
    a = ap.parse_args()
    run(kind=a.kind, limit_places=a.limit, per_place=a.per_place)
