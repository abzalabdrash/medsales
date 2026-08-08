"""Источник №1: приказы МЗ РК о предельных ценах (adilet.zan.kz).

Почему это главный источник, а не Госреестр ndda.kz:
  * ndda.kz/register.php — SPA под hCaptcha, автоматический доступ закрыт;
  * приказ на adilet отдаёт ВСЁ то же самое обычным HTML-запросом, без ключей:
    ТН | МНН | лекформа | производитель | № РУ | цена произв. | опт | ★ розница
  * это официальный НПА -> данные открытые, парсинг легален, ToS не нарушается.

Розничная предельная цена — наш эталон «переплата/не переплата».
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass

from selectolax.parser import HTMLParser

from ._fetch import get_cached

UA = {"User-Agent": "MedRouteKZ/1.0 (hackathon research; contact: abdrashabzal.bs@gmail.com)",
      "Accept-Language": "ru-RU,ru;q=0.9"}

# Действующие приказы. Adilet отдаёт консолидированную (актуальную) редакцию.
ORDERS = {
    # предельные цены производителя / оптовые / розничные на торговое наименование
    "V2100024229": "предельные цены ТН (произв./опт/розница)",
    # предельные цены на ТН в рамках ГОБМП и ОСМС
    "V2100023886": "предельные цены ТН для ГОБМП/ОСМС",
    # более ранний приказ по ТН для розницы и опта
    "V1900019037": "предельные цены ТН (розница/опт), ранняя редакция",
}

BASE = "https://adilet.zan.kz/rus/docs/{doc}"

_HEADER_HINTS = ("торговое наименование", "мнн", "лекарственная форма")


@dataclass
class AdiletRow:
    tn: str
    inn: str | None
    form_raw: str | None
    manufacturer: str | None
    reg_number: str | None
    price_producer: float | None
    price_wholesale: float | None
    price_retail: float | None
    source_doc: str
    source_url: str


def _money(s: str | None) -> float | None:
    """'8 018,80' / '8\xa0018,80' -> 8018.80 . Мусор -> None."""
    if not s:
        return None
    t = re.sub(r"[^\d,.\-]", "", s.replace("\xa0", "").replace(" ", ""))
    if not t:
        return None
    # в приказах разделитель дробной части — запятая, тысячи уже вычищены
    t = t.replace(",", ".")
    if t.count(".") > 1:                     # "1.234.56" -> последняя точка десятичная
        head, _, tail = t.rpartition(".")
        t = head.replace(".", "") + "." + tail
    try:
        v = float(t)
    except ValueError:
        return None
    return v if v > 0 else None


def _clean(s: str | None) -> str | None:
    if not s:
        return None
    s = re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()
    if not s or s.lower() in {"нет данных", "-", "—", "нет"}:
        return None
    return s


def _pick_price_table(doc: HTMLParser):
    """Находит таблицу цен по шапке, а не по индексу — приказы меняют структуру."""
    best = None
    for tb in doc.css("table"):
        rows = tb.css("tr")
        if len(rows) < 20:
            continue
        head = " ".join(c.text(separator=" ", strip=True).lower() for c in rows[0].css("td,th"))
        if sum(h in head for h in _HEADER_HINTS) >= 2:
            if best is None or len(rows) > len(best.css("tr")):
                best = tb
    return best


def fetch_order(doc: str, *, refresh: bool = False) -> list[AdiletRow]:
    """Приказ с диска, при первом обращении — из сети.

    adilet при частых обращениях рвёт соединение (SSL DECRYPTION_FAILED,
    WinError 10054). Без кэша это выглядело как «данные пропали»: fetch_all
    ловит ошибку по каждому документу отдельно, и справочник молча собирался
    из одного приказа вместо трёх — 4 300 позиций вместо 10 047.
    Документы меняются раз в месяцы, поэтому кэш здесь безопасен.
    """
    url = BASE.format(doc=doc)
    tree = HTMLParser(get_cached(url, key=f"adilet_{doc}", refresh=refresh))
    table = _pick_price_table(tree)
    if table is None:
        return []

    rows = table.css("tr")
    header = [c.text(separator=" ", strip=True).lower() for c in rows[0].css("td,th")]

    def col(*names: str, default: int | None = None) -> int | None:
        for i, h in enumerate(header):
            if any(n in h for n in names):
                return i
        return default

    i_tn = col("торговое наименование", default=1)
    i_inn = col("мнн", "международное непатент", default=2)
    i_form = col("лекарственная форма", "форма выпуска", default=3)
    i_man = col("производитель", default=4)
    i_reg = col("регистрационное удостоверение", "рег. удостовер", default=5)
    i_pp = col("цена производителя")
    i_pw = col("оптовой")
    i_pr = col("розничной")

    out: list[AdiletRow] = []
    for tr in rows[1:]:
        c = [x.text(separator=" ", strip=True) for x in tr.css("td")]
        if len(c) < 4:
            continue
        tn = _clean(c[i_tn]) if i_tn is not None and i_tn < len(c) else None
        if not tn:
            continue
        pick = lambda i: c[i] if i is not None and i < len(c) else None  # noqa: E731
        out.append(AdiletRow(
            tn=tn,
            inn=_clean(pick(i_inn)),
            form_raw=_clean(pick(i_form)),
            manufacturer=_clean(pick(i_man)),
            reg_number=_clean(pick(i_reg)),
            price_producer=_money(pick(i_pp)),
            price_wholesale=_money(pick(i_pw)),
            price_retail=_money(pick(i_pr)),
            source_doc=doc,
            source_url=url,
        ))
    return out


def fetch_all(delay: float = 2.0) -> list[AdiletRow]:
    """Все приказы подряд. Падение одного не роняет остальные (как в medprice)."""
    rows: list[AdiletRow] = []
    for doc, title in ORDERS.items():
        try:
            got = fetch_order(doc)
            print(f"  [adilet] {doc}: {len(got):>5} строк — {title}")
            rows.extend(got)
        except Exception as exc:  # noqa: BLE001
            print(f"  [adilet] {doc}: FAIL {type(exc).__name__}: {exc}")
        time.sleep(delay)
    return rows


if __name__ == "__main__":
    import collections
    rs = fetch_all()
    print(f"\nвсего строк: {len(rs)}")
    print(f"с розничной ценой: {sum(1 for r in rs if r.price_retail)}")
    print(f"с МНН:             {sum(1 for r in rs if r.inn)}")
    print(f"с № РУ:            {sum(1 for r in rs if r.reg_number)}")
    print("\nпо документам:", collections.Counter(r.source_doc for r in rs))
    for r in rs[:3]:
        print("\n", r.tn, "|", r.inn, "|", r.form_raw, "|розн:", r.price_retail)
