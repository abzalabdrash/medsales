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


# Приоритет приказов по свежести. Предельные цены нельзя смешивать между
# редакциями: в приказе 2019 года ацетилсалициловая кислота стоит 29 ₸, и
# сравнение полки 2026 года с этим потолком даёт фиктивную «переплату 900%».
# Берём цену из САМОГО СВЕЖЕГО приказа, где она есть, а не минимальную.
DOC_RANK = {
    "V2100024229": 3,   # действующий, произв./опт/розница
    "V2100023886": 2,   # действующий, ГОБМП/ОСМС
    "V1900019037": 1,   # редакция 2019 года — только как запасной вариант
}


def _score(r: adilet.AdiletRow) -> int:
    return sum(bool(x) for x in (r.inn, r.form_raw, r.manufacturer, r.reg_number,
                                 r.price_producer, r.price_wholesale, r.price_retail))


# Ниже этого числа строк сборка считается неполной. Взято с запасом от
# фактических 11 470: если один приказ не скачался, суммы падают в разы.
MIN_EXPECTED_ROWS = 9000


def build(*, allow_partial: bool = False) -> dict:
    init_db()
    rows = adilet.fetch_all()

    # Молчаливая деградация здесь опаснее падения: fetch_all ловит ошибку по
    # каждому документу отдельно, и при сбое сети справочник собирался бы из
    # одного приказа вместо трёх — 4 300 позиций вместо 10 047, без единого
    # предупреждения. Лучше остановиться и не портить рабочую базу.
    if len(rows) < MIN_EXPECTED_ROWS and not allow_partial:
        raise RuntimeError(
            f"скачано только {len(rows)} строк из ожидаемых ~11 470 — "
            f"похоже, часть приказов не загрузилась. Справочник НЕ перезаписан. "
            f"Повторите запуск (документы кэшируются) или передайте allow_partial=True.")

    # --- дедуп -----------------------------------------------------------
    best: dict[tuple, adilet.AdiletRow] = {}
    retail_seen: dict[tuple, list[tuple[int, float, str]]] = {}
    for r in rows:
        key = (r.reg_number or r.tn, r.form_raw or "")
        if r.price_retail:
            retail_seen.setdefault(key, []).append(
                (DOC_RANK.get(r.source_doc, 0), r.price_retail, r.source_doc))
        cur = best.get(key)
        if cur is None or _score(r) > _score(cur):
            best[key] = r

    stats = Counter()
    session = get_session()
    session.query(DrugRef).delete()

    for key, r in best.items():
        pf = parse_form(r.form_raw)
        retails = retail_seen.get(key) or []
        # сначала по свежести приказа, при равной свежести — меньшая цена
        retail = min(retails, key=lambda t: (-t[0], t[1]))[1] if retails else None
        cap_doc = min(retails, key=lambda t: (-t[0], t[1]))[2] if retails else None

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
            price_cap_retail=retail, price_cap_source=cap_doc,
            source="adilet:" + r.source_doc, source_url=r.source_url,
        ))
        stats["total"] += 1
        if cap_doc:
            stats[f"cap_from_{cap_doc}"] += 1
        stats["with_inn"] += bool(r.inn)
        stats["with_form"] += bool(pf.form)
        stats["with_strength"] += pf.strength is not None
        stats["with_pack"] += pf.pack_size is not None
        stats["with_retail_cap"] += retail is not None
        stats["divisible"] += pf.is_divisible

    session.commit()

    # --- групповой потолок ------------------------------------------------
    # Группа = одно и то же вещество, форма и фасовка у разных производителей.
    # Ключ по МНН, а если его нет — по первому слову торгового наименования.
    groups: dict[tuple, float] = {}
    refs = session.query(DrugRef).filter(DrugRef.price_cap_retail.isnot(None)).all()
    for r in refs:
        key = (r.inn_norm or r.tn_norm.split(" ")[0], r.form, r.pack_size)
        groups[key] = max(groups.get(key, 0.0), r.price_cap_retail)
    for r in session.query(DrugRef).all():
        key = (r.inn_norm or r.tn_norm.split(" ")[0], r.form, r.pack_size)
        r.price_cap_group_max = groups.get(key) or r.price_cap_retail
    session.commit()

    stats["with_group_cap"] = sum(
        1 for r in session.query(DrugRef).all() if r.price_cap_group_max)
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
