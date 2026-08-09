"""Источник №5: агрегатор apteka.103.kz — цены ПО КОНКРЕТНЫМ АПТЕКАМ.

Все прежние источники дают цену на уровне СЕТИ: «Еврофарма — 1 480 ₸», без
адреса. Из-за этого страница аптек была украшением: рейтинг посмотреть можно,
а узнать, есть ли там препарат и почём — нельзя. 103.kz закрывает ровно эту
дыру: на карточке лежит список аптек с ценой, адресом, телефоном, графиком и
датой обновления у каждой строки.

Что берём и откуда:

  1. ЛИСТИНГ КАТЕГОРИИ  /lekarstva/medicines-for-diseases/<кат>/<город>/?page=N
     Отдаётся сервером, в __NEXT_DATA__ по 10 позиций за запрос, и в каждой
     уже есть то, что мы вытаскивали из приказов МЗ: МНН, ATC, дозировка,
     размер упаковки, признак «по рецепту», производитель и страна. Это чинит
     и каталог, и матчинг: у агрегатора есть ATC там, где в приказах позиции
     нет вовсе (БАДы, косметика).

  2. КАРТОЧКА ТОВАРА    /<код>/<город>/
     data.stores — список аптек с ценой. Отдаётся 10 строк: две промо-позиции
     и восемь самых дешёвых. Остальные догружаются отдельным запросом, и
     ?page= этот список НЕ листает.

Про ограничения честно, чтобы не выдать их потом за фичи:

  * 10 аптек из N. Для вопроса «где дешевле» восьми самых дешёвых достаточно,
    но утверждать «у нас все 177 аптек» нельзя — в БД пишем storesCount
    отдельным полем, чтобы интерфейс мог сказать «8 из 177».
  * Это ВТОРИЧНЫЕ данные: прайсы грузят сами аптеки. Зато у каждой строки
    стоит дата обновления — это честнее нашего собственного снимка, у которого
    даты нет вообще.

robots.txt разрешает и листинги, и карточки: закрыты только служебные разделы
и произвольные ?-параметры, а ?page разрешён явным Allow. Crawl-delay не
задан, но идём в два потока с паузой — сайт чужой.
"""
from __future__ import annotations

import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path

import httpx

SOURCE = "103kz"
BASE = "https://apteka.103.kz"
DATA = Path(__file__).resolve().parents[2] / "data"

UA = {"User-Agent": "MedRouteKZ/1.0 (hackathon research; contact: abdrashabzal.bs@gmail.com)",
      "Accept-Language": "ru-RU,ru;q=0.9"}

WORKERS = 2
DELAY = 0.4

# code -> как город называется у нас в базе
CITIES = {"almaty": "Алматы", "astana": "Астана", "shymkent": "Шымкент"}

# Рубрикатор сайта: 59 разделов, собран с главной. Лежит списком, а не
# вычитывается каждый раз, чтобы обход был воспроизводимым: если сайт уберёт
# раздел, мы это увидим по нулю позиций, а не по молча уехавшим цифрам.
CATEGORIES = [
    "antibiotiki", "antidepressanty", "antikoagulyanti", "antiseptiki",
    "dlya-borbi-s-lishnim-vesom", "dlya-gorla", "dlya-immuniteta",
    "dlya-lecheniya-hronicheskogo-alkogolizma", "dlya-lecheniya-ran-i-yazv",
    "dlya-lecheniya-saharnogo-diabeta", "dlya-lecheniya-ugrej",
    "dlya-lecheniya-urologicheskih-zabolevanij", "dlya-lecheniya-zabolevanij-uha",
    "dlya-mozgovogo-krovoobrashheniya", "dlya-nosa", "dlya-pecheni",
    "dlya-povisheniya-potentcii", "dlya-uluchsheniya-raboti-zheludka-kishechnika",
    "from-psoriasis", "gormonalnie-kontratceptivi", "kortikosteroidy",
    "krovoostanavlivayushhie", "lechenie-adenomi-prostati",
    "lechenie-varikoznogo-rasshireniya-ven", "minerali", "mochegonnye",
    "obezbolivayushhie-i-spazmolitiki", "ot-allergii", "ot-boleznej-sustavov",
    "ot-chesotki", "ot-diarei", "ot-gemorroya", "ot-golovnoj-boli-i-migreni",
    "ot-molochnitci", "ot-nizkogo-davleniya", "ot-prostudi-i-grippa",
    "ot-shramov-i-rubczov", "ot-ukachivaniya", "ot-visokogo-davleniya",
    "ot-vshej", "ot-vypadeniya-volos", "pri-bronhialnoj-astme", "pri-gerpese",
    "pri-izzhoge", "pri-kashle", "pri-menopauze", "pri-povyshennom-holesterine",
    "pri-vzdutii-zhivota", "pri-yazve-i-gastrite", "probiotiki-i-prebiotiki",
    "protiv-podagri", "protivoglistnie-preparati", "protivogribkovie-preparati",
    "protivorvotnie-preparati", "slabitelnie-preparati",
    "snotvotnie-i-uspokoitelnie-sredstva", "vitamini", "zharoponizhayushhie",
    "zhelchegonnye",
]


@dataclass
class Product:
    """Позиция каталога: товар в конкретном городе."""
    code: str                     # slug, он же ключ карточки
    city: str                     # код города на сайте
    name: str
    extended_name: str | None = None
    inn: str | None = None
    atc: str | None = None
    dosage: str | None = None
    pack_size: int | None = None
    base_form: str | None = None
    is_rx: bool | None = None
    producer: str | None = None
    producer_country: str | None = None
    price_min: float | None = None
    price_max: float | None = None
    price_raw: str | None = None
    category: str | None = None
    url: str | None = None
    instruction_url: str | None = None
    picture_url: str | None = None


@dataclass
class Store:
    """Цена в конкретной аптеке.

    Поля dosage/pack_size/producer описывают НЕ товар вообще, а тот самый
    вариант, к которому относится цена, — см. stores_for(). Без размера
    упаковки цена в аптеке бесполезна: посчитать курс по ней нельзя.
    """
    product_code: str
    city: str
    store_id: str
    group_id: str | None
    name: str
    address: str | None
    price_kzt: float | None
    quantity_raw: str | None
    updated_label: str | None      # «обновл. вчера» — как написано на сайте
    updated_on: str | None         # оценка даты в ISO, см. _updated_on
    phones: list[str] = field(default_factory=list)
    work_schedule: list[str] = field(default_factory=list)
    url: str | None = None
    stores_total: int | None = None   # сколько аптек всего, а не в выдаче
    variant_id: str | None = None     # external_id варианта на 103.kz
    dosage: str | None = None
    pack_size: int | None = None
    producer: str | None = None


# «8 600 〒», «1 430 〒», «500 – 900 〒» — неразрывные пробелы внутри
_NUM = re.compile(r"\d[\d\s ]*")


def _money(raw: str | None) -> tuple[float | None, float | None]:
    """Из строки цены -> (минимум, максимум). Диапазон отдаётся как есть."""
    if not raw:
        return None, None
    nums = [float(m.group(0).replace(" ", "").replace(" ", ""))
            for m in _NUM.finditer(raw)]
    nums = [n for n in nums if n > 0]
    if not nums:
        return None, None
    return min(nums), max(nums)


def _updated_on(label: str | None, today: date | None = None) -> str | None:
    """«обновл. вчера» -> дата в ISO.

    Сайт пишет свежесть словами. Оставить только слова значит потерять
    возможность отсортировать и отфильтровать по возрасту; выдумать точную
    дату — соврать. Поэтому храним и исходную подпись, и её разбор, а всё,
    что не разобралось, оставляем пустым.
    """
    if not label:
        return None
    t = today or date.today()
    low = label.lower()
    if "сегодня" in low:
        return t.isoformat()
    if "вчера" in low:
        return (t - timedelta(days=1)).isoformat()
    # «обновл. в 04:04» — время без даты означает сегодня: вчерашние и более
    # старые обновления сайт подписывает словами, а не часами
    if re.search(r"\bв\s*\d{1,2}:\d{2}", low):
        return t.isoformat()
    m = re.search(r"(\d+)\s*дн", low)
    if m:
        return (t - timedelta(days=int(m.group(1)))).isoformat()
    m = re.search(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})", low)
    if m:
        d, mo, y = (int(x) for x in m.groups())
        y = y + 2000 if y < 100 else y
        try:
            return date(y, mo, d).isoformat()
        except ValueError:
            return None
    return None


def _next_data(cli: httpx.Client, url: str) -> dict | None:
    """Страница отдаётся сервером — данные лежат в __NEXT_DATA__.

    Возвращаем None вместо исключения: на обходе в тысячи адресов отдельная
    непрочитанная страница не повод ронять всю сборку.
    """
    try:
        time.sleep(DELAY)
        r = cli.get(url)
        if r.status_code != 200:
            return None
        m = re.search(r'id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
        if not m:
            return None
        return json.loads(m.group(1))["props"]["pageProps"]
    except Exception:  # noqa: BLE001
        return None


def _prop(props: dict, key: str) -> str | None:
    v = (props or {}).get(key) or {}
    val = v.get("value")
    return str(val).strip() if val not in (None, "") else None


def _to_product(raw: dict, city: str, category: str) -> Product | None:
    code = (raw.get("code") or "").strip()
    if not code:
        return None
    props = raw.get("properties") or {}
    producer = raw.get("producer") or {}
    pack = _prop(props, "package")
    lo, hi = _money(raw.get("price_range"))
    recipe = _prop(props, "recipe")
    return Product(
        code=code, city=city, category=category,
        name=(raw.get("name") or "").strip(),
        extended_name=(raw.get("extended_name") or "").strip() or None,
        inn=_prop(props, "inn"),
        atc=_prop(props, "atc"),
        dosage=_prop(props, "dosage"),
        pack_size=int(pack) if pack and pack.isdigit() else None,
        base_form=_prop(props, "base_form"),
        is_rx=(recipe is not None and "рецепт" in recipe.lower()),
        producer=(producer.get("name") or "").strip() or None,
        producer_country=(producer.get("country") or "").strip() or None,
        price_min=lo, price_max=hi, price_raw=raw.get("price_range"),
        url=raw.get("url"),
        instruction_url=((raw.get("instruction") or {}) or {}).get("url"),
        picture_url=((raw.get("picture") or {}) or {}).get("src"),
    )


def _category_page(cli: httpx.Client, city: str, category: str,
                   page: int) -> tuple[list[Product], dict]:
    url = f"{BASE}/lekarstva/medicines-for-diseases/{category}/{city}/"
    if page > 1:
        url += f"?page={page}"
    pp = _next_data(cli, url)
    if not pp or "data" not in pp:
        return [], {}
    prod = (pp["data"] or {}).get("product") or {}
    opts = prod.get("options") or {}
    items: list[Product] = []
    seen: set[str] = set()
    # promoted — те же товары, что и в regular, только подняты наверх.
    # Ключ дедупликации — url, а не code: у «Ксеникала» один code на три
    # фасовки (21, 42 и 84 капсулы) с ценами 14 500, 19 000 и 45 500 ₸.
    # Схлопнуть их в одну строку значит потерять две трети каталога.
    for bucket in ("regular", "promoted"):
        for raw in opts.get(bucket) or []:
            p = _to_product(raw, city, category)
            key = p.url or p.code if p else None
            if p and key not in seen:
                seen.add(key)
                items.append(p)
    return items, prod.get("meta") or {}


def _to_store(raw: dict, code: str, city: str, total: int | None,
              variant: dict | None) -> Store:
    lo, _ = _money(raw.get("price"))
    label = (raw.get("updated_at") or "").strip() or None
    v = variant or {}
    vprops = v.get("properties") or {}
    pack = _prop(vprops, "package")
    return Store(
        product_code=code, city=city,
        store_id=str(raw.get("id") or ""),
        group_id=str(raw.get("group_id") or "") or None,
        name=(raw.get("name") or "").strip(),
        address=(raw.get("address") or "").strip() or None,
        price_kzt=lo,
        quantity_raw=(raw.get("quantity") or "").strip() or None,
        updated_label=label,
        updated_on=_updated_on(label),
        phones=[p for p in (raw.get("phones") or []) if p],
        work_schedule=[w for w in (raw.get("work_schedule") or []) if w],
        url=raw.get("url"),
        stores_total=total,
        variant_id=str(v.get("external_id") or "") or None,
        dosage=_prop(vprops, "dosage"),
        pack_size=int(pack) if pack and pack.isdigit() else None,
        producer=((v.get("producer") or {}).get("name") or "").strip() or None,
    )


def stores_for(cli: httpx.Client, code: str, city: str) -> list[Store]:
    """Цены по аптекам для одного товара в одном городе.

    Список аптек на странице относится не к товару вообще, а к ПЕРВОМУ
    варианту из options.regular — это проверено на четырёх препаратах с
    разными фасовками:

        Ксеникал   аптека 14 500 ₸  =  вариант[0] «120 мг, уп. 21, Делфарм»
                                       (уп. 42 и 84 стоят 19 000 и 45 500)
        Нурофен    аптеки 500–536 ₸ =  вариант[0] «200 мг, уп. 12»

    Поэтому вместе с ценой запоминаем дозировку, фасовку и производителя
    этого варианта. Иначе «Ксеникал 14 500 ₸» — цифра без смысла: неизвестно,
    за 21 капсулу она или за 84, и посчитать курс нельзя.
    """
    pp = _next_data(cli, f"{BASE}/{code}/{city}/")
    if not pp or "data" not in pp:
        return []
    data = pp["data"] or {}
    st = data.get("stores") or {}
    regular = ((data.get("product") or {}).get("options") or {}).get("regular") or []
    variant = regular[0] if regular else None
    total = (st.get("storesCount") or {}).get("count")
    return [_to_store(s, code, city, total, variant) for s in (st.get("stores") or [])]


# --------------------------------------------------------------------------
# Обход с чекпойнтом. Прошлый обход «Биосферы» писал результат одним файлом в
# самом конце — процесс прервали, и сорок минут пропали. Здесь каждая строка
# ложится на диск сразу, а повторный запуск дочитывает с места остановки.
# --------------------------------------------------------------------------

class _Journal:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._fh = None

    def done_keys(self, key: str) -> set[str]:
        if not self.path.exists():
            return set()
        out: set[str] = set()
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                out.add(str(json.loads(line)[key]))
            except Exception:  # noqa: BLE001
                continue
        return out

    def rows(self) -> list[dict]:
        if not self.path.exists():
            return []
        out = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                out.append(json.loads(line))
            except Exception:  # noqa: BLE001
                continue
        return out

    def __enter__(self):
        self._fh = self.path.open("a", encoding="utf-8")
        return self

    def write(self, obj) -> None:
        with self._lock:
            self._fh.write(json.dumps(asdict(obj), ensure_ascii=False) + "\n")
            self._fh.flush()

    def __exit__(self, *exc) -> None:
        if self._fh:
            self._fh.close()


def catalog_path(city: str) -> Path:
    return DATA / f"agg103_catalog_{city}.jsonl"


def _done_path(city: str) -> Path:
    return DATA / f"agg103_catalog_{city}.done"


def _done_categories(city: str) -> set[str]:
    """Разделы, дочитанные ДО КОНЦА.

    Считать готовым раздел, от которого в журнале есть хоть одна строка,
    нельзя: обход могли прервать на пятой странице из сорока, и повторный
    запуск молча пропустил бы остальные тридцать пять.
    """
    p = _done_path(city)
    return set(p.read_text(encoding="utf-8").split()) if p.exists() else set()


def _mark_done(city: str, category: str) -> None:
    with _done_path(city).open("a", encoding="utf-8") as fh:
        fh.write(category + "\n")


def stores_path(city: str) -> Path:
    return DATA / f"agg103_stores_{city}.jsonl"


def crawl_catalog(city: str, categories: list[str] | None = None,
                  max_pages: int | None = None) -> int:
    """Фаза 1: листинги категорий -> позиции с МНН, ATC, упаковкой и ценой."""
    cats = categories or CATEGORIES
    done = _done_categories(city)
    todo = [c for c in cats if c not in done]
    print(f"  [103kz/{city}] категорий: {len(todo)} из {len(cats)}"
          + (f", пропущено готовых: {len(cats) - len(todo)}" if done else ""))

    written = 0
    with httpx.Client(headers=UA, timeout=40.0, verify=False,
                      follow_redirects=True) as cli, _Journal(catalog_path(city)) as jr:
        for i, cat in enumerate(todo, 1):
            items, meta = _category_page(cli, city, cat, 1)
            pages = int(meta.get("total_pages") or 1)
            if max_pages:
                pages = min(pages, max_pages)
            for p in items:
                jr.write(p)
            written += len(items)
            for page in range(2, pages + 1):
                more, _ = _category_page(cli, city, cat, page)
                for p in more:
                    jr.write(p)
                written += len(more)
            if not max_pages:      # урезанный обход готовым не считаем
                _mark_done(city, cat)
            print(f"    [{i}/{len(todo)}] {cat:44} {meta.get('total_items', 0):>5} поз."
                  f"  всего собрано {written}", flush=True)
    return written


def crawl_stores(city: str, codes: list[str] | None = None,
                 limit: int | None = None, progress_every: int = 100) -> int:
    """Фаза 2: карточки товаров -> цены по конкретным аптекам."""
    if codes is None:
        codes = sorted({r["code"] for r in _Journal(catalog_path(city)).rows()})
    journal = _Journal(stores_path(city))
    done = journal.done_keys("product_code")
    todo = [c for c in codes if c not in done]
    if limit:
        todo = todo[:limit]
    print(f"  [103kz/{city}] карточек к обходу: {len(todo)}"
          + (f", уже готово: {len(done)}" if done else ""))

    counter = {"n": 0, "rows": 0, "empty": 0}
    lock = threading.Lock()

    with httpx.Client(headers=UA, timeout=40.0, verify=False,
                      follow_redirects=True) as cli, journal as jr:
        def one(code: str) -> None:
            rows = stores_for(cli, code, city)
            for s in rows:
                jr.write(s)
            with lock:
                counter["n"] += 1
                counter["rows"] += len(rows)
                if not rows:
                    counter["empty"] += 1
                    # пустышку тоже отмечаем, иначе повторный запуск будет
                    # вечно перечитывать товары, которых нет в этом городе
                    jr.write(Store(product_code=code, city=city, store_id="",
                                   group_id=None, name="", address=None,
                                   price_kzt=None, quantity_raw=None,
                                   updated_label=None, updated_on=None,
                                   stores_total=0))
                if counter["n"] % progress_every == 0:
                    print(f"    [{counter['n']}/{len(todo)}] строк {counter['rows']}, "
                          f"без аптек {counter['empty']}", flush=True)

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(one, todo))
    return counter["rows"]


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Обход агрегатора apteka.103.kz")
    ap.add_argument("phase", choices=["catalog", "stores"])
    ap.add_argument("--city", default="almaty", choices=list(CITIES))
    ap.add_argument("--categories", help="через запятую, для быстрой проверки")
    ap.add_argument("--max-pages", type=int, default=None)
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()

    cats = [c.strip() for c in a.categories.split(",")] if a.categories else None
    if a.phase == "catalog":
        n = crawl_catalog(a.city, cats, max_pages=a.max_pages)
        print(f"\nпозиций записано: {n} -> {catalog_path(a.city)}")
    else:
        n = crawl_stores(a.city, limit=a.limit)
        print(f"\nстрок аптек записано: {n} -> {stores_path(a.city)}")
