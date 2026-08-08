"""2GIS: справочник филиалов, рейтинги и — главное — deeplink'и.

Почему 2GIS, а не Leaflet с самодельными маркерами: пользователю не нужна
красивая картинка, ему нужно ДОЙТИ. Тап по карточке открывает нативное
приложение 2GIS сразу на карточке аптеки или сразу на построенном маршруте.
Leaflet так не умеет в принципе.

Лимиты демо-ключа (проверено по докам): 1000 запросов на сервис, 1 месяц,
не больше 5 страниц по 10 объектов. Поэтому:
  * ключи ротируются (KeyPool) — 3 ключа = 3000 запросов;
  * каждый ответ кладётся в кэш на диск, повтор не тратит квоту;
  * гео-обогащение запускается один раз, результат живёт в БД.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from itertools import cycle
from pathlib import Path
from urllib.parse import quote

import httpx

CATALOG = "https://catalog.api.2gis.com/3.0/items"
CACHE = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "2gis"
CACHE.mkdir(parents=True, exist_ok=True)

# 2GIS требует латинский slug города в URL карточки
CITY_SLUG = {
    "Алматы": "almaty", "Астана": "astana", "Шымкент": "shymkent",
    "Караганда": "karaganda", "Актобе": "aktobe", "Тараз": "taraz",
    "Павлодар": "pavlodar", "Костанай": "kostanay", "Атырау": "atyrau",
    "Актау": "aktau", "Кызылорда": "kyzylorda", "Петропавловск": "petropavlovsk",
    "Талдыкорган": "taldykorgan", "Семей": "semey", "Усть-Каменогорск": "ust-kamenogorsk",
}


# ==========================================================================
#  Deeplink'и — работают без API-ключа и без квоты
# ==========================================================================
def firm_url(firm_id: str, city: str = "Алматы") -> str:
    """Веб-карточка организации. На телефоне сама предложит открыть приложение."""
    return f"https://2gis.kz/{CITY_SLUG.get(city, 'almaty')}/firm/{firm_id}"


def firm_deeplink(firm_id: str, city: str = "Алматы") -> str:
    """Прямой запуск приложения 2GIS на карточке организации."""
    return f"dgis://2gis.kz/{CITY_SLUG.get(city, 'almaty')}/firm/{firm_id}"


def route_deeplink(points: list[tuple[float, float]], mode: str = "pedestrian") -> str:
    """Маршрут в приложении 2GIS. points = [(lat, lng), ...] в порядке обхода.

    Формат: dgis://2gis.ru/routeSearch/rsType/<mode>/from/<lon>,<lat>/to/<lon>,<lat>
    Внимание: 2GIS ждёт ДОЛГОТУ первой, а мы храним (lat, lng) — легко
    перепутать и увести пользователя в Индийский океан.
    mode: car | pedestrian | ctx (общественный транспорт) | taxi
    """
    if len(points) < 2:
        raise ValueError("нужны минимум две точки")
    fmt = lambda p: f"{p[1]},{p[0]}"          # noqa: E731  (lng,lat)
    url = f"dgis://2gis.ru/routeSearch/rsType/{mode}/from/{fmt(points[0])}"
    for p in points[1:]:
        url += f"/to/{fmt(p)}"
    return url


def route_web_url(points: list[tuple[float, float]], city: str = "Алматы") -> str:
    """Веб-версия маршрута — фолбэк для десктопа, где приложения нет."""
    pts = "|".join(f"{lng},{lat}" for lat, lng in points)
    return f"https://2gis.kz/{CITY_SLUG.get(city, 'almaty')}/directions/points/{quote(pts)}"


# ==========================================================================
#  Places API
# ==========================================================================
class KeyPool:
    """Ротация ключей + подсчёт израсходованной квоты по каждому."""

    def __init__(self, keys: list[str], per_key_limit: int = 1000) -> None:
        if not keys:
            raise ValueError("нужен хотя бы один ключ 2GIS")
        self.keys = keys
        self.limit = per_key_limit
        self.used = dict.fromkeys(keys, 0)
        self._cycle = cycle(keys)

    def take(self) -> str:
        for _ in range(len(self.keys)):
            k = next(self._cycle)
            if self.used[k] < self.limit:
                self.used[k] += 1
                return k
        raise RuntimeError(
            f"квота исчерпана на всех {len(self.keys)} ключах "
            f"({self.limit} запросов на ключ). Добавьте ключ или ждите сброса.")

    def report(self) -> str:
        return " | ".join(f"...{k[-6:]}: {v}/{self.limit}" for k, v in self.used.items())


@dataclass
class Place:
    twogis_id: str
    name: str
    address: str | None
    lat: float | None
    lng: float | None
    rating: float | None
    reviews_count: int | None
    working_hours: str | None
    is_24h: bool | None
    city: str

    @property
    def url(self) -> str:
        return firm_url(self.twogis_id, self.city)

    @property
    def deeplink(self) -> str:
        return firm_deeplink(self.twogis_id, self.city)


FIELDS = ("items.point,items.address,items.reviews,items.schedule,"
          "items.contact_groups,items.rubrics,items.external_content")


class TwoGisClient:
    def __init__(self, keys: list[str], *, delay: float = 0.4, use_cache: bool = True) -> None:
        self.pool = KeyPool(keys)
        self.delay = delay
        self.use_cache = use_cache
        self._cli = httpx.Client(timeout=25.0, headers={"User-Agent": "MedRouteKZ/1.0"})

    def _cache_path(self, q: str, city: str, page: int) -> Path:
        safe = "".join(c if c.isalnum() else "_" for c in f"{city}_{q}_{page}")[:120]
        return CACHE / f"{safe}.json"

    def search(self, query: str, city: str, *, page: int = 1, page_size: int = 10) -> list[Place]:
        cp = self._cache_path(query, city, page)
        if self.use_cache and cp.exists():
            payload = json.loads(cp.read_text(encoding="utf-8"))
        else:
            params = {
                "q": f"{query} {city}",
                "key": self.pool.take(),
                "fields": FIELDS,
                "page": page,
                "page_size": page_size,
                "locale": "ru_KZ",
            }
            time.sleep(self.delay)
            r = self._cli.get(CATALOG, params=params)
            r.raise_for_status()
            payload = r.json()
            code = payload.get("meta", {}).get("code")
            if code != 200:
                raise RuntimeError(f"2GIS вернул code={code}: "
                                   f"{payload.get('meta', {}).get('error', {})}")
            cp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

        out: list[Place] = []
        for it in payload.get("result", {}).get("items", []):
            pt = it.get("point") or {}
            rv = it.get("reviews") or {}
            sched = it.get("schedule") or {}
            out.append(Place(
                twogis_id=str(it.get("id", "")).split("_")[0],
                name=it.get("name") or "",
                address=it.get("address_name") or it.get("full_address_name"),
                lat=pt.get("lat"), lng=pt.get("lon"),
                rating=rv.get("general_rating"),
                reviews_count=rv.get("general_review_count"),
                working_hours=json.dumps(sched, ensure_ascii=False) if sched else None,
                is_24h=bool(sched.get("Everyday", {}).get("working_hours", [{}])[0]
                            .get("from") == "00:00") if sched else None,
                city=city,
            ))
        return out


if __name__ == "__main__":
    # deeplink'и не требуют ключа — проверяем именно их
    print("карточка :", firm_url("70000001097377101", "Алматы"))
    print("в приложении:", firm_deeplink("70000001097377101", "Алматы"))
    route = [(43.238949, 76.889709), (43.256, 76.928), (43.222, 76.851)]
    print("маршрут  :", route_deeplink(route, "pedestrian"))
    print("веб-фолбэк:", route_web_url(route, "Алматы"))
    p = KeyPool(["demo_key_aaa111", "demo_key_bbb222", "demo_key_ccc333"], per_key_limit=2)
    for _ in range(6):
        p.take()
    print("пул ключей:", p.report())
    try:
        p.take()
    except RuntimeError as e:
        print("исчерпание ловится:", e)
