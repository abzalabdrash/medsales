"""Источник №2: сеть «Еврофарма» — реальные розничные цены.

Почему именно она первой:
  * robots.txt разрешает каталог (закрыты только /search, /cart, /cabinet);
  * есть ПУБЛИЧНЫЙ JSON API api.europharma.kz/v1/products — 71 300 SKU
    со штрихкодами и деревом категорий (barcode = ключ склейки источников);
  * цены и признак «По рецепту» лежат в HTML каталога в разметке карточки:
        <div class="card-product" data-id="15060" data-price="995">
  * пагинация каталога — ?page=N, пагинация API — ?p=N (72 стр. × 1000).

Итог: справочник берём из API, цены — из HTML. Никаких обходов защит.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass

import httpx
from selectolax.parser import HTMLParser

SITE = "https://europharma.kz"
API = "https://api.europharma.kz/v1/products"
UA = {"User-Agent": "MedRouteKZ/1.0 (hackathon research; contact: abdrashabzal.bs@gmail.com)",
      "Accept-Language": "ru-RU,ru;q=0.9"}

CHAIN = "Еврофарма"
DELAY = 1.0          # вежливость: 1 запрос/сек
MAX_EMPTY_PAGES = 2  # столько пустых страниц подряд = конец категории


@dataclass
class Offer:
    sku: str
    name: str
    price_kzt: float | None
    is_rx: bool
    manufacturer: str | None
    url: str
    category_raw: str | None
    barcode: str | None = None
    in_stock: bool | None = None


def _client() -> httpx.Client:
    return httpx.Client(headers=UA, timeout=30.0, verify=False, follow_redirects=True)


# --------------------------------------------------------------------------
# A. Справочник товаров через публичный API (sku, name, barcode, категории)
# --------------------------------------------------------------------------
def fetch_catalog_api(cli: httpx.Client, max_pages: int | None = None) -> dict[str, dict]:
    """{sku: {name, barcode, country, category}} — 71 300 позиций за ~72 запроса."""
    out: dict[str, dict] = {}
    r = cli.get(API)
    r.raise_for_status()
    total_pages = int(r.headers.get("x-pagination-page-count", 1))
    if max_pages:
        total_pages = min(total_pages, max_pages)

    def absorb(payload: dict) -> None:
        for it in payload.get("items", []):
            out[str(it["sku"])] = {
                "name": it.get("name"),
                "barcode": it.get("barcode"),
                "country": it.get("country"),
                "category": " / ".join(it.get("category") or []),
            }

    absorb(r.json())
    for p in range(2, total_pages + 1):
        try:
            time.sleep(DELAY)
            rp = cli.get(API, params={"p": p})
            rp.raise_for_status()
            absorb(rp.json())
        except Exception as exc:  # noqa: BLE001
            print(f"    [api] стр.{p} FAIL {type(exc).__name__}")
    return out


# --------------------------------------------------------------------------
# B. Цены из HTML каталога
# --------------------------------------------------------------------------
def list_categories(cli: httpx.Client) -> list[str]:
    r = cli.get(f"{SITE}/catalog")
    r.raise_for_status()
    hrefs = {a.attributes.get("href", "") for a in HTMLParser(r.text).css("a")}
    cats = sorted({h for h in hrefs if h.startswith("/catalog/") and h.count("/") == 2})
    return cats


def _parse_cards(html: str, category: str) -> list[Offer]:
    doc = HTMLParser(html)
    offers: list[Offer] = []
    for card in doc.css(".card-product"):
        sku = card.attributes.get("data-id")
        raw_price = card.attributes.get("data-price")
        if not sku:
            continue
        title_node = card.css_first(".card-product__title") or card.css_first("a")
        name = title_node.text(strip=True) if title_node else ""
        link = card.css_first("a")
        href = link.attributes.get("href", "") if link else ""
        manuf = None
        desc = card.css_first(".card-product__desc")
        if desc:
            m = re.search(r"Производитель:\s*(.+)", desc.text(strip=True))
            if m:
                manuf = m.group(1).strip()[:250]
        try:
            price = float(raw_price) if raw_price not in (None, "", "0") else None
        except ValueError:
            price = None
        offers.append(Offer(
            sku=str(sku),
            name=re.sub(r"\s+", " ", name).strip(),
            price_kzt=price,
            is_rx=card.css_first(".card-product-recipe") is not None,
            manufacturer=manuf,
            url=SITE + href if href.startswith("/") else href,
            category_raw=category,
        ))
    return offers


def fetch_category(cli: httpx.Client, cat: str, max_pages: int = 200) -> list[Offer]:
    out: list[Offer] = []
    seen: set[str] = set()
    empty = 0
    for page in range(1, max_pages + 1):
        url = f"{SITE}{cat}" + (f"?page={page}" if page > 1 else "")
        try:
            time.sleep(DELAY)
            r = cli.get(url)
            if r.status_code != 200:
                break
            batch = _parse_cards(r.text, cat)
        except Exception:  # noqa: BLE001
            break
        fresh = [o for o in batch if o.sku not in seen]
        if not fresh:
            empty += 1
            if empty >= MAX_EMPTY_PAGES:
                break
            continue
        empty = 0
        seen.update(o.sku for o in fresh)
        out.extend(fresh)
    return out


def scrape(max_categories: int | None = None, max_pages: int = 200,
           with_api: bool = True) -> list[Offer]:
    cli = _client()
    try:
        catalog = fetch_catalog_api(cli) if with_api else {}
        if catalog:
            print(f"  [europharma] API-справочник: {len(catalog)} SKU со штрихкодами")

        cats = list_categories(cli)
        if max_categories:
            cats = cats[:max_categories]
        print(f"  [europharma] категорий к обходу: {len(cats)}")

        all_offers: dict[str, Offer] = {}
        for i, cat in enumerate(cats, 1):
            try:
                got = fetch_category(cli, cat, max_pages=max_pages)
            except Exception as exc:  # noqa: BLE001
                print(f"    [{i}/{len(cats)}] {cat} FAIL {type(exc).__name__}")
                continue
            for o in got:
                if o.sku in all_offers and all_offers[o.sku].price_kzt:
                    continue
                meta = catalog.get(o.sku)
                if meta:
                    o.barcode = meta.get("barcode")
                    o.category_raw = meta.get("category") or o.category_raw
                    if not o.name:
                        o.name = meta.get("name") or ""
                all_offers[o.sku] = o
            print(f"    [{i}/{len(cats)}] {cat:52} +{len(got):>4}  всего={len(all_offers)}")
        return list(all_offers.values())
    finally:
        cli.close()


if __name__ == "__main__":
    import sys
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    offers = scrape(max_categories=n, max_pages=8, with_api=False)
    print(f"\nсобрано: {len(offers)}   с ценой: {sum(1 for o in offers if o.price_kzt)}   "
          f"Rx: {sum(1 for o in offers if o.is_rx)}")
    for o in offers[:5]:
        print(f"  {o.price_kzt!s:>9} ₸  rx={o.is_rx!s:5} {o.name[:58]}")
