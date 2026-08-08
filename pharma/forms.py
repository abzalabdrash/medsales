"""Разбор лекарственной формы -> (форма, дозировка, объём, размер упаковки).

Это ядро расчёта курса. Без pack_size нельзя ответить на вопрос
"сколько упаковок купить", а именно на нём ошибается любой чат-бот.

Вход — строка ровно в том виде, как её печатает МЗ РК в приказе о предельных ценах:
    "Таблетки, покрытые пленочной оболочкой, 500 мг, №60"
    "Раствор для внутривенного введения, 1 мг/мл, 5 мл, №10"
    "Порошок для приготовления суспензии, 400 мг/57 мг, №1"
99% строк реестра содержат "№<N>" — покрытие проверено на выгрузке.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict

# --- канонические формы. Порядок важен: длинные паттерны раньше коротких. ---
_FORM_RULES: list[tuple[str, str]] = [
    (r"таблетк\w*\s*,?\s*покрыт\w*\s*(пленочной\s*)?оболочк\w*", "таблетки"),
    (r"таблетк\w*\s*(диспергируем\w*|жевательн\w*|шипуч\w*|сублингвальн\w*)", "таблетки"),
    (r"таблетк\w*", "таблетки"),
    (r"капсул\w*", "капсулы"),
    (r"драже", "драже"),
    (r"порошок\s+лиофилизированн\w*", "лиофилизат"),
    (r"лиофилизат\w*", "лиофилизат"),
    (r"порошок\w*", "порошок"),
    (r"гранул\w*", "гранулы"),
    (r"саше", "саше"),
    (r"концентрат\w*", "концентрат"),
    (r"раствор\w*\s+для\s+инфузий", "раствор для инфузий"),
    (r"раствор\w*\s+для\s+инъекц\w*", "раствор для инъекций"),
    (r"раствор\w*\s+для\s+внутривенн\w*", "раствор для инъекций"),
    (r"раствор\w*\s+для\s+внутримышечн\w*", "раствор для инъекций"),
    (r"раствор\w*", "раствор"),
    (r"суспензи\w*", "суспензия"),
    (r"сироп\w*", "сироп"),
    (r"кап(ли|ель)\w*", "капли"),
    (r"спрей\w*", "спрей"),
    (r"аэрозол\w*", "аэрозоль"),
    (r"мазь|мази", "мазь"),
    (r"крем\w*", "крем"),
    (r"гель|гел\w*", "гель"),
    (r"суппозитори\w*|свеч\w*", "суппозитории"),
    (r"пластыр\w*", "пластырь"),
    (r"сбор\w*", "сбор"),
    (r"настойк\w*", "настойка"),
    (r"эмульси\w*", "эмульсия"),
]

# формы, у которых "штука" — не доза, а тара (нельзя делить курс на таблетки)
_BULK_FORMS = {"мазь", "крем", "гель", "раствор", "сироп", "суспензия", "спрей",
               "аэрозоль", "капли", "порошок", "настойка", "эмульсия"}

_UNIT_ALIASES = {
    "мкг": "мкг", "мг": "мг", "г": "г", "гр": "г",
    "мл": "мл", "л": "л",
    "ме": "МЕ", "мe": "МЕ", "ед": "ЕД", "iu": "МЕ",
    "%": "%",
}

# "№60", "№ 60", "N60", "№60х2" (блистеры)
_PACK_RE = re.compile(r"[№NnХх]\s*(\d+)\s*(?:[xх*×]\s*(\d+))?", re.IGNORECASE)
# "500 мг", "1 мг/мл", "0,25 %", "1000 МЕ"
_DOSE_RE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(мкг|мг|гр|г|мл|л|МЕ|ме|ЕД|ед|%)(?:\s*/\s*(\d+(?:[.,]\d+)?)?\s*(мл|мг|г|л)?)?",
    re.IGNORECASE,
)
_VOLUME_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(мл|г|л)\b(?!\s*/)", re.IGNORECASE)


def _num(s: str | None) -> float | None:
    if not s:
        return None
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


@dataclass
class ParsedForm:
    form: str | None          # канон: "таблетки", "капсулы", ...
    strength: float | None    # 500
    strength_unit: str | None # "мг"
    per_volume: float | None  # для "1 мг/мл" -> 1.0
    per_volume_unit: str | None
    volume: float | None      # объём/масса тары: "30 г" крема -> 30
    volume_unit: str | None
    pack_size: int | None     # ★ штук в упаковке
    is_divisible: bool        # можно ли считать курс в штуках
    raw: str

    def as_dict(self) -> dict:
        return asdict(self)


def parse_form(raw: str | None) -> ParsedForm:
    """Разбирает строку лекформы. Никогда не бросает исключение — только None-поля."""
    empty = ParsedForm(None, None, None, None, None, None, None, None, False, raw or "")
    if not raw or not raw.strip():
        return empty
    s = raw.strip()
    low = s.lower().replace("\xa0", " ")

    form = next((canon for pat, canon in _FORM_RULES if re.search(pat, low)), None)

    # --- размер упаковки -------------------------------------------------
    pack = None
    m = _PACK_RE.search(s.replace("\xa0", " "))
    if m:
        pack = int(m.group(1))
        if m.group(2):                      # "№10х3" = 10 в блистере, 3 блистера
            pack *= int(m.group(2))

    # --- дозировка -------------------------------------------------------
    strength = unit = None
    per_v = per_v_unit = None
    dm = _DOSE_RE.search(low)
    if dm:
        strength = _num(dm.group(1))
        unit = _UNIT_ALIASES.get(dm.group(2).lower(), dm.group(2))
        if dm.group(4):                     # "1 мг/мл"
            per_v = _num(dm.group(3)) or 1.0
            per_v_unit = _UNIT_ALIASES.get(dm.group(4).lower(), dm.group(4))

    # --- объём тары: последнее "N мл/г" не в составе дроби ---------------
    volume = vol_unit = None
    tail = low[dm.end():] if dm else low
    vm = list(_VOLUME_RE.finditer(tail))
    if vm:
        volume = _num(vm[-1].group(1))
        vol_unit = _UNIT_ALIASES.get(vm[-1].group(2).lower(), vm[-1].group(2))

    divisible = bool(pack) and (form not in _BULK_FORMS if form else False)

    return ParsedForm(form, strength, unit, per_v, per_v_unit,
                      volume, vol_unit, pack, divisible, s)


# --- самопроверка на реальных строках из приказа МЗ РК ---------------------
_SELFTEST = [
    ("Таблетки, покрытые пленочной оболочкой, 500 мг, №60", "таблетки", 500.0, "мг", 60, True),
    ("Таблетки, 100 мг, №1", "таблетки", 100.0, "мг", 1, True),
    # ампулы/флаконы штучные -> курс считается в ампулах, divisible=True
    ("Раствор для внутривенного введения, 1 мг/мл, 5 мл, №10", "раствор для инъекций", 1.0, "мг", 10, True),
    # а вот флакон сиропа делить нельзя: "№1" — это одна бутылка, а не одна доза
    ("Сироп 100 мг/5 мл, 150 мл, №1", "сироп", 100.0, "мг", 1, False),
    ("Концентрат для приготовления раствора для инфузий, 400 мг/16 мл, 16 мл, №1", "концентрат", 400.0, "мг", 1, True),
    ("Капсулы, 200 мг, №30", "капсулы", 200.0, "мг", 30, True),
    ("Мазь для наружного применения 0,1 %, 30 г, №1", "мазь", 0.1, "%", 1, False),
]

if __name__ == "__main__":
    ok = 0
    for raw, ef, es, eu, ep, ed in _SELFTEST:
        p = parse_form(raw)
        good = (p.form == ef and p.strength == es and p.strength_unit == eu
                and p.pack_size == ep and p.is_divisible == ed)
        ok += good
        print(("PASS " if good else "FAIL ") +
              f"{p.form!s:22} {p.strength!s:>7} {p.strength_unit!s:4} №{p.pack_size!s:<4} "
              f"div={p.is_divisible!s:5} | {raw[:52]}")
    print(f"\n{ok}/{len(_SELFTEST)} passed")
