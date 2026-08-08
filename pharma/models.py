"""Схема данных препаратов. Совместима по стилю с medprice (Brand/Branch/Price).

  DrugRef      эталон: ТН + МНН + форма + доза + упаковка + ПРЕДЕЛЬНАЯ цена МЗ РК
  DrugOffer    предложение конкретной аптеки: цена, наличие, источник
  Pharmacy     филиал аптеки: гео, часы, рейтинг 2GIS, ★ has_compounding
  PriceAudit   вердикт QA-валидатора по каждой цене (почему приняли/отвергли)

Ключевое отличие от «просто каталога»: DrugRef.pack_size + strength позволяют
посчитать ПОТРЕБНОСТЬ КУРСА, а DrugRef.price_cap_retail — уличить переплату.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class DrugRef(Base):
    """Эталонная позиция. Источник истины — приказы МЗ РК о предельных ценах."""
    __tablename__ = "drug_ref"
    __table_args__ = (UniqueConstraint("reg_number", "form_raw", name="uq_drug_ref"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tn: Mapped[str] = mapped_column(String(512), index=True)          # торговое наименование
    tn_norm: Mapped[str] = mapped_column(String(512), index=True)     # для матчинга
    inn: Mapped[str | None] = mapped_column(String(512), index=True)  # МНН
    inn_norm: Mapped[str | None] = mapped_column(String(512), index=True)
    atc: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)

    form_raw: Mapped[str | None] = mapped_column(String(512))
    form: Mapped[str | None] = mapped_column(String(64), index=True)
    strength: Mapped[float | None] = mapped_column(Float)
    strength_unit: Mapped[str | None] = mapped_column(String(16))
    volume: Mapped[float | None] = mapped_column(Float)
    volume_unit: Mapped[str | None] = mapped_column(String(16))
    pack_size: Mapped[int | None] = mapped_column(Integer)            # ★ штук в упаковке
    is_divisible: Mapped[bool] = mapped_column(Boolean, default=False)

    manufacturer: Mapped[str | None] = mapped_column(String(512))
    reg_number: Mapped[str | None] = mapped_column(String(64), index=True)

    price_cap_producer: Mapped[float | None] = mapped_column(Float)
    price_cap_wholesale: Mapped[float | None] = mapped_column(Float)
    price_cap_retail: Mapped[float | None] = mapped_column(Float)     # ★ эталон переплаты
    # из какого приказа взят потолок — без этого нельзя судить, актуален ли он
    price_cap_source: Mapped[str | None] = mapped_column(String(32))
    # Максимальный потолок среди ВСЕХ производителей той же позиции
    # (одинаковые МНН + форма + фасовка). Именно с ним нужно сравнивать цену
    # на полке: матчинг по названию не знает производителя, а у разных
    # заводов потолки отличаются в разы. Сравнение с минимальным потолком
    # обвиняло бы аптеку в переплате там, где её нет.
    price_cap_group_max: Mapped[float | None] = mapped_column(Float)

    is_rx: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_supplement: Mapped[bool] = mapped_column(Boolean, default=False)  # БАД (нет в реестре ЛС)
    source: Mapped[str] = mapped_column(String(64))
    source_url: Mapped[str | None] = mapped_column(String(512))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Pharmacy(Base):
    __tablename__ = "pharmacy"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    chain: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(64), index=True)
    address: Mapped[str | None] = mapped_column(String(512))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    working_hours: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(128))
    rating: Mapped[float | None] = mapped_column(Float)
    reviews_count: Mapped[int | None] = mapped_column(Integer)
    twogis_id: Mapped[str | None] = mapped_column(String(64), index=True)  # -> deeplink в 2GIS
    has_compounding: Mapped[bool] = mapped_column(Boolean, default=False)  # ★ производственный отдел
    is_24h: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    source: Mapped[str | None] = mapped_column(String(64))


class DrugOffer(Base):
    """Цена конкретного препарата в конкретной аптеке/сети."""
    __tablename__ = "drug_offer"
    __table_args__ = (UniqueConstraint("pharmacy_id", "sku", "source", name="uq_offer"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    drug_ref_id: Mapped[str | None] = mapped_column(ForeignKey("drug_ref.id"), nullable=True, index=True)
    pharmacy_id: Mapped[str | None] = mapped_column(ForeignKey("pharmacy.id"), nullable=True, index=True)
    chain: Mapped[str] = mapped_column(String(255), index=True)
    city: Mapped[str | None] = mapped_column(String(64), index=True)

    sku: Mapped[str | None] = mapped_column(String(64), index=True)
    barcode: Mapped[str | None] = mapped_column(String(32), index=True)   # ★ ключ склейки источников
    name_raw: Mapped[str] = mapped_column(String(512))
    price_kzt: Mapped[float | None] = mapped_column(Float)
    in_stock: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_rx: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    category_raw: Mapped[str | None] = mapped_column(String(512))
    manufacturer: Mapped[str | None] = mapped_column(String(512))

    price_confidence: Mapped[float | None] = mapped_column(Float)   # 0..1 от QA-валидатора
    qa_flag: Mapped[str | None] = mapped_column(String(32), index=True)  # ok|suspect_low|suspect_high|above_cap|no_price
    match_method: Mapped[str | None] = mapped_column(String(16))
    match_score: Mapped[float | None] = mapped_column(Float)

    source: Mapped[str] = mapped_column(String(64), index=True)
    source_url: Mapped[str | None] = mapped_column(String(512))
    parsed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class FreeDrug(Base):
    """Позиция перечня бесплатного/льготного амбулаторного обеспечения (ҚР ДСМ-75).

    Самая социально важная таблица проекта: если препарат из назначения есть
    здесь и у человека подходящий диагноз — покупать его не нужно вообще.
    """
    __tablename__ = "free_drug"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    mkb10: Mapped[str | None] = mapped_column(String(64), index=True)
    disease: Mapped[str | None] = mapped_column(String(512))
    citizen_category: Mapped[str | None] = mapped_column(Text)
    indication: Mapped[str | None] = mapped_column(Text)
    drug_name: Mapped[str] = mapped_column(String(512), index=True)
    drug_name_norm: Mapped[str] = mapped_column(String(512), index=True)
    atc: Mapped[str | None] = mapped_column(String(32), index=True)
    section: Mapped[str | None] = mapped_column(String(255), index=True)
    source_doc: Mapped[str] = mapped_column(String(32))
    source_url: Mapped[str | None] = mapped_column(String(512))


class InnPriceCap(Base):
    """Предельная цена по МНН для ГОБМП/ОСМС + источник ATC-кодов."""
    __tablename__ = "inn_price_cap"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    atc: Mapped[str | None] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(512), index=True)
    name_norm: Mapped[str] = mapped_column(String(512), index=True)
    characteristic: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(String(64))
    price_cap: Mapped[float | None] = mapped_column(Float)
    kind: Mapped[str] = mapped_column(String(16), index=True)   # drug | device
    source_doc: Mapped[str] = mapped_column(String(32))
    source_url: Mapped[str | None] = mapped_column(String(512))


class PlaceGeo(Base):
    """Результат обогащения точки через 2GIS — отдельно от самих точек.

    Живёт в pharma.db, а не в собранной medsales.db, потому что merge.py
    пересоздаёт сводную базу из источников: если писать обогащение прямо в
    branch, каждая пересборка стирала бы результат, за который заплачено
    квотой ключа. Здесь оно переживает любое число пересборок, а merge
    просто накладывает его поверх скопированных таблиц.
    """
    __tablename__ = "place_geo"
    place_id: Mapped[str] = mapped_column(String(48), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)   # clinic | pharmacy
    twogis_id: Mapped[str | None] = mapped_column(String(64), index=True)
    twogis_url: Mapped[str | None] = mapped_column(String(512))
    name_2gis: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(512))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    rating: Mapped[float | None] = mapped_column(Float)
    reviews_count: Mapped[int | None] = mapped_column(Integer)
    match_score: Mapped[float | None] = mapped_column(Float)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PriceAudit(Base):
    """Почему цена принята или отвергнута — для объяснимости и для защиты перед жюри."""
    __tablename__ = "price_audit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity: Mapped[str] = mapped_column(String(16))          # 'drug' | 'service'
    entity_id: Mapped[str] = mapped_column(String(48), index=True)
    rule: Mapped[str] = mapped_column(String(64))
    verdict: Mapped[str] = mapped_column(String(16))         # ok | warn | reject
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
