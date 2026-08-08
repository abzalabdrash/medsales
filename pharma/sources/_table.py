"""Разворачивание HTML-таблицы в прямоугольную матрицу с учётом rowspan/colspan.

Зачем отдельный модуль: в приказах МЗ одно заболевание объединяет несколько
строк препаратов через rowspan. Наивное чтение `tr.css('td')` даёт у таких
строк 2-3 ячейки вместо семи, и они молча выпадают из выборки — в перечне
бесплатных лекарств так терялось 500 позиций из 594.

Правило: ячейка с rowspan=N занимает свою колонку в N последующих строках.
Значение при этом ПОВТОРЯЕТСЯ вниз — именно так таблицу читает человек.
"""
from __future__ import annotations

import re

from selectolax.parser import Node


def _clean(s: str | None) -> str | None:
    if not s:
        return None
    s = re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()
    return s or None


def _span(cell: Node, attr: str) -> int:
    try:
        v = int(cell.attributes.get(attr) or 1)
    except (TypeError, ValueError):
        return 1
    return max(1, min(v, 200))          # защита от rowspan="9999"


def expand_table(table: Node) -> list[list[str | None]]:
    """Возвращает матрицу строк одинаковой длины."""
    grid: list[list[str | None]] = []
    pending: dict[int, tuple[str | None, int]] = {}   # col -> (значение, осталось строк)

    for tr in table.css("tr"):
        row: list[str | None] = []
        col = 0
        cells = list(tr.css("td, th"))
        ci = 0

        while ci < len(cells) or col in pending:
            if col in pending:                        # колонку держит rowspan сверху
                val, left = pending[col]
                row.append(val)
                if left - 1 <= 0:
                    del pending[col]
                else:
                    pending[col] = (val, left - 1)
                col += 1
                continue

            cell = cells[ci]
            ci += 1
            # separator=" " обязателен: без него текст соседних тегов слипается
            # («Нурофен» + «для детей» -> «Нурофендля детей»), и такое имя
            # уже невозможно сматчить с названием на витрине аптеки
            val = _clean(cell.text(separator=" ", strip=True))
            rs, cs = _span(cell, "rowspan"), _span(cell, "colspan")
            for k in range(cs):
                row.append(val)
                if rs > 1:
                    pending[col + k] = (val, rs - 1)
            col += cs

        if any(v for v in row):
            grid.append(row)

    if not grid:
        return []
    width = max(len(r) for r in grid)
    return [r + [None] * (width - len(r)) for r in grid]


def find_header(grid: list[list[str | None]], *hints: str) -> int | None:
    """Индекс строки-шапки: первая строка, где встречается большинство подсказок."""
    for i, row in enumerate(grid[:6]):
        joined = " ".join((c or "").lower() for c in row)
        if sum(h in joined for h in hints) >= max(2, len(hints) - 1):
            return i
    return None


def column_index(header: list[str | None], *names: str) -> int | None:
    for i, h in enumerate(header):
        low = (h or "").lower()
        if any(n in low for n in names):
            return i
    return None
