"""Контракт карточек: единственный формат, в котором агент отдаёт результат.

Принцип: модель НЕ пишет текстом «Ае-вит стоит около 900 тенге в Раузе».
Модель вызывает инструмент, получает строки из БД и раскладывает их по
карточкам. Всё, что в карточке — цена, адрес, ссылка — пришло из БД, а не
из головы модели. Поэтому цифры нельзя выдумать: их просто негде взять.

UI рендерит карточки по полю `type`. Модель может добавить только поля
`title`/`note`/`why` — человеческий текст. Числа и ссылки она копирует.
"""
from __future__ import annotations

from typing import Any, Literal, TypedDict

CardType = Literal[
    "prescription_item",  # распознанная строка назначения (+ подтверждение у юзера)
    "drug_option",        # конкретный препарат в конкретной аптеке
    "service_option",     # медуслуга в конкретной клинике
    "pharmacy_stop",      # точка маршрута
    "route_summary",      # итог: сколько точек, сколько стоит, сколько сэкономили
    "warning",            # взаимодействие, Rx, переплата, «положено бесплатно»
    "clarify",            # агент не уверен и спрашивает
]


class DrugOptionCard(TypedDict, total=False):
    type: Literal["drug_option"]
    title: str                    # "Ае-вит 100 мг №30"
    inn: str | None               # "Ретинол + Токоферол"
    is_generic_swap: bool         # это замена на аналог, а не то, что выписал врач
    swapped_from: str | None
    pharmacy: str                 # "Еврофарма, пр. Абая 150"
    price_per_pack: float
    packs_needed: int             # ★ из расчёта курса, не из головы
    total_price: float
    course_explainer: str         # "3 капс/день × 40 дней = 120 капс = 4 уп. по 30"
    price_cap_retail: float | None
    overpay_pct: float | None     # + = дороже предельной цены МЗ РК
    is_rx: bool
    in_stock: bool | None
    twogis_url: str | None
    twogis_deeplink: str | None
    source_url: str


class ServiceOptionCard(TypedDict, total=False):
    type: Literal["service_option"]
    title: str                    # "Криотерапия жидким азотом"
    clinic: str
    address: str | None
    price: float
    city_median: float | None     # ★ контекст: дорого это или нет
    price_vs_median_pct: float | None
    rating: float | None
    reviews_count: int | None
    review_summary: str | None
    twogis_url: str | None
    twogis_deeplink: str | None
    source_url: str


class PharmacyStopCard(TypedDict, total=False):
    type: Literal["pharmacy_stop"]
    order: int                    # 1, 2, 3 — порядок обхода
    pharmacy: str
    address: str
    items: list[str]              # что забираем именно здесь
    subtotal: float
    has_compounding: bool         # ★ здесь изготовят болтушку
    working_hours: str | None
    twogis_deeplink: str | None


class RouteSummaryCard(TypedDict, total=False):
    type: Literal["route_summary"]
    stops: int
    total_price: float
    baseline_price: float         # если брать всё в одной ближайшей аптеке
    saved: float
    saved_pct: float
    route_deeplink: str           # ★ один тап -> навигация в 2GIS
    route_web_url: str
    note: str | None


class WarningCard(TypedDict, total=False):
    type: Literal["warning"]
    severity: Literal["info", "caution", "high"]
    kind: Literal["interaction", "rx_required", "overpay", "free_by_osms",
                  "compounded", "not_a_drug", "low_confidence"]
    title: str
    body: str
    action: str | None


class ClarifyCard(TypedDict, total=False):
    type: Literal["clarify"]
    question: str
    options: list[str]
    field: str                    # какое поле уточняем: "dose" | "duration" | "name"
    raw_text: str | None          # что было на фото


Card = dict[str, Any]


# --- JSON Schema для structured output модели ------------------------------
CARD_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["cards", "summary"],
    "additionalProperties": False,
    "properties": {
        "summary": {
            "type": "string",
            "description": "2-3 предложения человеческим языком. Без цифр, "
                           "которых нет в карточках.",
        },
        "cards": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["type"],
                "properties": {"type": {"type": "string", "enum": list(CardType.__args__)}},
                "additionalProperties": True,
            },
        },
        "needs_user_input": {
            "type": "boolean",
            "description": "true, если есть хоть одна карточка clarify",
        },
    },
}


def validate_no_invented_numbers(cards: list[Card], allowed: set[float]) -> list[str]:
    """Страховка от галлюцинаций: каждое денежное поле обязано существовать в БД.

    Вызывается ПОСЛЕ ответа модели, перед отдачей в UI. Если модель вписала
    цену, которой нет среди значений, отданных инструментом, — это баг, и
    карточку надо не показывать, а логировать.
    """
    money_fields = ("price_per_pack", "total_price", "price", "subtotal",
                    "total_price", "baseline_price", "price_cap_retail")
    problems: list[str] = []
    for i, c in enumerate(cards):
        for f in money_fields:
            v = c.get(f)
            if isinstance(v, (int, float)) and round(float(v), 2) not in allowed:
                problems.append(f"карточка #{i} ({c.get('type')}): {f}={v} нет в выдаче БД")
    return problems
