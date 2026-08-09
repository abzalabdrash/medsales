"""Подключение к БД + детерминированные ID (как в medprice.util.det_id)."""
from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .models import Base

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
DB_PATH = DATA / "pharma.db"

_engine = create_engine(f"sqlite:///{DB_PATH}", future=True)
SessionLocal = sessionmaker(bind=_engine, future=True, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(_engine)
    ensure_columns()


def ensure_columns() -> list[str]:
    """Дописать в существующие таблицы колонки, появившиеся в моделях.

    create_all() создаёт только недостающие ТАБЛИЦЫ и молча проходит мимо
    новых колонок в уже существующих. Схема тут меняется часто, а база
    пересобирается долго — ронять её из-за одного поля не нужно. Полноценных
    миграций проект не заводит: SQLite, один разработчик, все изменения
    аддитивные, поэтому достаточно ALTER TABLE ADD COLUMN.
    """
    added: list[str] = []
    with _engine.begin() as con:
        for table in Base.metadata.sorted_tables:
            rows = con.exec_driver_sql(f"PRAGMA table_info({table.name})").fetchall()
            if not rows:                      # таблицы ещё нет — её создаст create_all
                continue
            have = {r[1] for r in rows}
            for col in table.columns:
                if col.name in have:
                    continue
                decl = col.type.compile(_engine.dialect)
                con.exec_driver_sql(
                    f"ALTER TABLE {table.name} ADD COLUMN {col.name} {decl}")
                added.append(f"{table.name}.{col.name}")
    return added


def get_session() -> Session:
    return SessionLocal()


def det_id(prefix: str, *parts: object) -> str:
    """Стабильный ID из содержимого — повторный парсинг не плодит дубли."""
    raw = "|".join("" if p is None else str(p) for p in parts)
    return f"{prefix}_{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]}"


_PUNCT = re.compile(r"[®™©\"'`,.;:()\[\]{}/\\+]")
_SPACE = re.compile(r"\s+")


def norm_name(s: str | None) -> str:
    """Нормализация названия для матчинга: регистр, ®, ё, пунктуация, пробелы."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s).lower().replace("ё", "е").replace("\xa0", " ")
    s = _PUNCT.sub(" ", s)
    s = _SPACE.sub(" ", s)
    return s.strip()


# Одна и та же сеть пишется по-разному в каждом источнике: 2GIS отдаёт
# «БИОСФЕРА» и «Биосфера», 103.kz — «Биосфера Заман Фарм Ритэйл ТОО Аптека».
# Без сведения к одному ключу цена сети не садится на её же точки на карте.
CHAIN_ALIASES = {
    "Биосфера": ("биосфер", "biosfer"),
    "Еврофарма": ("еврофарм", "europharm"),
    "Зерде": ("зерде", "zerde"),
    "Садыхан": ("садыхан", "sadykhan"),
    "Рауза": ("рауза", "rauza"),
    "Добрая аптека": ("добрая аптека", "dobraya"),
    "Мега Фарм": ("мега фарм", "mega pharm", "megapharm"),
}


def chain_key(name: str | None) -> str | None:
    """Название сети -> единый ключ. Не узнали — возвращаем как есть.

    Только через Python: встроенный LOWER() в SQLite работает лишь с
    латиницей, LOWER('БИОСФЕРА') возвращает 'БИОСФЕРА', и вся эта таблица
    соответствий в SQL молча не срабатывала бы на кириллице.
    """
    if not name:
        return None
    low = name.lower()
    for key, marks in CHAIN_ALIASES.items():
        if any(m in low for m in marks):
            return key
    return name
