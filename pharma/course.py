"""Расчёт потребности на курс. Детерминированно, без участия модели.

Это то место, где чат-бот с веб-поиском ошибается всегда: он находит цену
УПАКОВКИ и выдаёт её за стоимость лечения. «Ае-вит 1 капс. 3 р. в день,
40 дней» — это 120 капсул, то есть четыре упаковки по 30, а не одна.

Ошибка тут стоит пользователю денег и срыва курса, поэтому:
  * округление всегда ВВЕРХ (лучше остаток, чем прерванный курс);
  * если форма неделимая (мазь, сироп) — считаем тары, а не дозы, и честно
    помечаем оценку как приблизительную;
  * нет pack_size — возвращаем packs=None, а не «наверное, одна».
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class CourseNeed:
    units_needed: float | None      # сколько таблеток/капсул/ампул нужно всего
    packs_needed: int | None        # сколько упаковок купить
    leftover_units: float | None    # сколько останется
    explainer: str                  # человеческая расшифровка для карточки
    is_estimate: bool               # True -> «примерно», форма неделимая
    warning: str | None = None


def compute_course(*, pack_size: int | None, is_divisible: bool,
                   form: str | None = None,
                   dose_value: float | None = 1.0,
                   freq_per_day: float | None = None,
                   duration_days: int | None = None,
                   quantity: int | None = None) -> CourseNeed:
    """Возвращает потребность на курс.

    quantity — прямое количество (для процедур «№6» или «купить 2 упаковки»),
    имеет приоритет над схемой приёма.
    """
    # --- прямое количество: считать нечего -------------------------------
    if quantity:
        packs = None
        if pack_size:
            packs = math.ceil(quantity / pack_size)
        return CourseNeed(
            units_needed=float(quantity), packs_needed=packs,
            leftover_units=(packs * pack_size - quantity) if packs and pack_size else None,
            explainer=f"нужно {quantity} шт",
            is_estimate=False)

    if not freq_per_day or not duration_days:
        return CourseNeed(None, None, None,
                          "схема приёма не распознана — количество не рассчитано",
                          is_estimate=False,
                          warning="Уточните, сколько раз в день и сколько дней принимать.")

    dose = dose_value if dose_value and dose_value > 0 else 1.0
    units = dose * freq_per_day * duration_days

    dose_part = (f"{_num(dose)} × " if dose != 1 else "")
    base = (f"{dose_part}{_num(freq_per_day)} р/день × {duration_days} дн "
            f"= {_num(units)} {_unit_word(form)}")

    # --- неделимая форма: тары не считаем, только предупреждаем ----------
    if not is_divisible or not pack_size:
        return CourseNeed(
            units_needed=units, packs_needed=None, leftover_units=None,
            explainer=base + " — расход зависит от объёма нанесения",
            is_estimate=True,
            warning=("Количество упаковок точно не рассчитать: форма неделимая. "
                     "Уточните у фармацевта."))

    packs = math.ceil(units / pack_size)
    leftover = packs * pack_size - units
    exp = f"{base} = {packs} уп. по {pack_size}"
    if leftover > 0:
        exp += f" (останется {_num(leftover)})"

    return CourseNeed(units_needed=units, packs_needed=packs,
                      leftover_units=leftover, explainer=exp, is_estimate=False)


def _num(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def _unit_word(form: str | None) -> str:
    return {
        "таблетки": "таб.", "капсулы": "капс.", "драже": "драже",
        "суппозитории": "свечей", "раствор для инъекций": "амп.",
        "саше": "пакетиков", "пластырь": "шт",
    }.get(form or "", "ед.")


# --------------------------------------------------------------------------
# Проверка на реальном назначении дерматолога
# --------------------------------------------------------------------------
if __name__ == "__main__":
    cases = [
        ("Кальций Д3 Никомед 1000 МЕ",  60, True,  "таблетки", 1, 1, 30, None),
        ("Олигоцинк",                   30, True,  "таблетки", 3, 1, 30, None),
        ("Ае-вит",                      30, True,  "капсулы",  1, 3, 40, None),
        ("Активированный уголь",         10, True,  "таблетки", 7, 1, 10, None),
        ("Мазь гиоксизон 30 г",          1, False, "мазь",     1, 1, 30, None),
        ("Криотерапия жидким азотом",  None, False, None,    None, None, None, 6),
        ("Препарат без схемы приёма",    20, True,  "таблетки", 1, None, None, None),
    ]
    print("=" * 78)
    print("  РАСЧЁТ КУРСА ПО РЕАЛЬНОМУ НАЗНАЧЕНИЮ ДЕРМАТОЛОГА")
    print("=" * 78)
    for name, pack, div, form, dose, freq, days, qty in cases:
        r = compute_course(pack_size=pack, is_divisible=div, form=form,
                           dose_value=dose, freq_per_day=freq,
                           duration_days=days, quantity=qty)
        packs = f"{r.packs_needed} уп." if r.packs_needed else "—"
        print(f"\n  {name}")
        print(f"    нужно: {packs:<8} {r.explainer}")
        if r.warning:
            print(f"    ⚠ {r.warning}")
