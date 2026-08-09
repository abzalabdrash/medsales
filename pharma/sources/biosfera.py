"""Источник №4: сеть «Биосфера» — вторая аптека для сравнения цен.

Почему именно она следующей после Еврофармы:
  * robots.txt разрешает всё, кроме /api/ и служебных разделов;
  * сеть сама публикует sitemap-products.xml — 33 034 адреса (ru + kz),
    то есть обход по нему это ровно то, для чего карта сайта и сделана;
  * на каждой карточке лежит разметка schema.org/Product:
        {"name": "...", "sku": "M-009050",
         "offers": {"price": 330, "availability": ".../InStock"}}
    Это структурированные данные, опубликованные для машин: не нужно
    угадывать вёрстку, и она может меняться без поломки парсера.

JSON API у сети тоже есть и он удобнее, но /api/ закрыт в robots.txt —
поэтому идём тем путём, который владелец разрешил.

Одна сеть не даёт сравнения цен: у каждого препарата ровно одна цена, а
продукт обещает «где дешевле». Вторая сеть превращает каталог в сравнение.
"""
from __future__ import annotations

import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx
from selectolax.parser import HTMLParser

SITEMAP = "https://biosfera.kz/sitemap-products.xml"
CHAIN = "Биосфера"

# Обход 33 тысяч карточек идёт больше получаса. Прошлый запуск писал результат
# одним файлом в самом конце — процесс прервали, и все сорок минут пропали.
# Теперь каждая карточка ложится на диск сразу, а повторный запуск дочитывает
# с того места, где остановился.
CHECKPOINT = Path(__file__).resolve().parents[2] / "data" / "biosfera_progress.jsonl"
UA = {"User-Agent": "MedRouteKZ/1.0 (hackathon research; contact: abdrashabzal.bs@gmail.com)",
      "Accept-Language": "ru-RU,ru;q=0.9"}

WORKERS = 4        # немного параллелизма, но не наплыв
DELAY = 0.25       # пауза внутри каждого потока


@dataclass
class Offer:
    sku: str
    name: str
    price_kzt: float | None
    in_stock: bool | None
    url: str
    image: str | None = None


def product_urls(limit: int | None = None) -> list[str]:
    """Только русские адреса: казахские дублируют те же товары."""
    r = httpx.get(SITEMAP, timeout=60, verify=False, headers=UA, follow_redirects=True)
    r.raise_for_status()
    urls = re.findall(r"<loc>(.*?)</loc>", r.text)
    ru = [u for u in urls if "/ru/product/" in u]
    return ru[:limit] if limit else ru


def _parse(html: str, url: str) -> Offer | None:
    doc = HTMLParser(html)
    for node in doc.css('script[type="application/ld+json"]'):
        try:
            data = json.loads(node.text())
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(data, dict) or data.get("@type") != "Product":
            continue
        offers = data.get("offers") or {}
        price = offers.get("price")
        try:
            price = float(price) if price not in (None, "") else None
        except (TypeError, ValueError):
            price = None
        avail = str(offers.get("availability") or "")
        image = data.get("image")
        return Offer(
            sku=str(data.get("sku") or "").strip() or url.rsplit("/", 1)[-1],
            name=(data.get("name") or "").strip(),
            price_kzt=price,
            in_stock=("InStock" in avail) if avail else None,
            url=url,
            image=(image[0] if isinstance(image, list) and image else image) or None,
        )
    return None


def _fetch_one(cli: httpx.Client, url: str) -> Offer | None:
    try:
        time.sleep(DELAY)
        r = cli.get(url)
        if r.status_code != 200:
            return None
        return _parse(r.text, url)
    except Exception:  # noqa: BLE001
        return None


def load_checkpoint(path: Path = CHECKPOINT) -> list[Offer]:
    """Уже обойдённые карточки. Битую последнюю строку молча пропускаем:
    процесс могли убить на середине записи."""
    if not path.exists():
        return []
    out: list[Offer] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            out.append(Offer(**json.loads(line)))
        except Exception:  # noqa: BLE001
            continue
    return out


def scrape(limit: int | None = None, *, progress_every: int = 500,
           checkpoint: Path | None = CHECKPOINT, resume: bool = True) -> list[Offer]:
    urls = product_urls(limit)

    out: list[Offer] = []
    if checkpoint and resume:
        out = load_checkpoint(checkpoint)
        seen = {o.url for o in out}
        urls = [u for u in urls if u not in seen]
        if out:
            print(f"  [biosfera] из чекпойнта: {len(out)}, осталось: {len(urls)}")
    if checkpoint:
        checkpoint.parent.mkdir(parents=True, exist_ok=True)

    print(f"  [biosfera] адресов к обходу: {len(urls)}")
    lock = threading.Lock()
    fh = checkpoint.open("a", encoding="utf-8") if checkpoint else None
    try:
        with httpx.Client(headers=UA, timeout=25.0, verify=False,
                          follow_redirects=True) as cli:
            with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                futures = {pool.submit(_fetch_one, cli, u): u for u in urls}
                done = 0
                for fut in as_completed(futures):
                    done += 1
                    o = fut.result()
                    if o and o.name:
                        out.append(o)
                        if fh:
                            with lock:
                                fh.write(json.dumps(asdict(o), ensure_ascii=False) + "\n")
                                fh.flush()
                    if done % progress_every == 0:
                        got = sum(1 for x in out if x.price_kzt)
                        print(f"    [{done}/{len(urls)}] распознано {len(out)}, с ценой {got}",
                              flush=True)
    finally:
        if fh:
            fh.close()
    return out


if __name__ == "__main__":
    import sys
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    # проверочный запуск в чекпойнт не пишем: он для полного обхода
    offers = scrape(limit=n, progress_every=20, checkpoint=None)
    with_price = [o for o in offers if o.price_kzt]
    print(f"\nполучено {len(offers)}, с ценой {len(with_price)}")
    for o in with_price[:5]:
        print(f"  {o.price_kzt:>8.0f} ₸  склад={o.in_stock}  {o.name[:52]}")
