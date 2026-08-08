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
