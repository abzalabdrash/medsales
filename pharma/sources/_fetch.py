"""Вежливый HTTP с дисковым кэшом и ретраями.

adilet.zan.kz рвёт соединение при частых обращениях (WinError 10054), а
документы там весят до 1.3 МБ и меняются раз в месяцы. Поэтому качаем один
раз и работаем с диска: и сайту легче, и разработка быстрее.
"""
from __future__ import annotations

import time
from pathlib import Path

import httpx

CACHE = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "html"
CACHE.mkdir(parents=True, exist_ok=True)

UA = {"User-Agent": "MedRouteKZ/1.0 (hackathon research; contact: abdrashabzal.bs@gmail.com)",
      "Accept-Language": "ru-RU,ru;q=0.9"}


def get_cached(url: str, *, key: str, retries: int = 4,
               timeout: float = 90.0, refresh: bool = False) -> str:
    path = CACHE / f"{key}.html"
    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8")

    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = httpx.get(url, timeout=timeout, verify=False, headers=UA,
                          follow_redirects=True)
            r.raise_for_status()
            path.write_text(r.text, encoding="utf-8")
            return r.text
        except Exception as exc:  # noqa: BLE001
            last = exc
            wait = 3 * (attempt + 1) ** 2      # 3, 12, 27, 48 c — даём сайту выдохнуть
            print(f"    [fetch] {key}: {type(exc).__name__}, ретрай через {wait} c")
            time.sleep(wait)
    raise RuntimeError(f"не удалось скачать {url}") from last
