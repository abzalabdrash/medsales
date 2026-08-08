"""Сборка эталонного справочника препаратов из приказов МЗ РК.

Дедуп по (№ РУ + лекформа): одна и та же позиция встречается в нескольких
приказах с разными ценами. Побеждает запись с бОльшим числом заполненных
полей, а розничная предельная цена берётся минимальная из непустых —
это консервативно и играет в пользу пользователя при проверке переплаты.
"""
from __future__ import annotations

from collections import Counter

from .db import det_id, get_session, init_db, norm_name
from .forms import parse_form
from .models import DrugRef
from .sources import adilet


def _score(r: adilet.AdiletRow) -> int:
    return sum(bool(x) for x in (r.inn, r.form_raw, r.manufacturer, r.reg_number,
                                 r.price_producer, r.price_wholesale, r.price_retail))


def build() -> dict:
    init_db()
    rows = adilet.fetch_all()

    # --- дедуп -----------------------------------------------------------
    best: dict[tuple, adilet.AdiletRow] = {}
    retail_seen: dict[tuple, list[float]] = {}
    for r in rows:
        key = (r.reg_number or r.tn, r.form_raw or "")
        if r.price_retail:
            retail_seen.setdefault(key, []).append(r.price_retail)
        cur = best.get(key)
        if cur is None or _score(r) > _score(cur):
            best[key] = r

    stats = Counter()
    session = get_session()
    session.query(DrugRef).delete()

    for key, r in best.items():
        pf = parse_form(r.form_raw)
        retails = retail_seen.get(key) or []
        retail = min(retails) if retails else None

        session.add(DrugRef(
            id=det_id("dr", r.reg_number, r.form_raw, r.tn),
            tn=r.tn, tn_norm=norm_name(r.tn),
            inn=r.inn, inn_norm=norm_name(r.inn),
            form_raw=r.form_raw, form=pf.form,
            strength=pf.strength, strength_unit=pf.strength_unit,
            volume=pf.volume, volume_unit=pf.volume_unit,
            pack_size=pf.pack_size, is_divisible=pf.is_divisible,
            manufacturer=r.manufacturer, reg_number=r.reg_number,
            price_cap_producer=r.price_producer,
            price_cap_wholesale=r.price_wholesale,
            price_cap_retail=retail,
            source="adilet:" + r.source_doc, source_url=r.source_url,
        ))
        stats["total"] += 1
        stats["with_inn"] += bool(r.inn)
        stats["with_form"] += bool(pf.form)
        stats["with_strength"] += pf.strength is not None
        stats["with_pack"] += pf.pack_size is not None
        stats["with_retail_cap"] += retail is not None
        stats["divisible"] += pf.is_divisible

    session.commit()
    session.close()
    return dict(stats)


if __name__ == "__main__":
    s = build()
    t = s["total"]
    print("\n" + "=" * 58)
    print(f"  СПРАВОЧНИК ПРЕПАРАТОВ СОБРАН: {t} уникальных позиций")
    print("=" * 58)
    for k, label in [("with_inn", "с МНН"), ("with_form", "с распознанной формой"),
                     ("with_strength", "с дозировкой"), ("with_pack", "★ с размером упаковки"),
                     ("divisible", "★ штучные (курс считается)"),
                     ("with_retail_cap", "★ с предельной розничной ценой")]:
        print(f"  {label:34} {s[k]:>6}  ({100*s[k]//t}%)")
