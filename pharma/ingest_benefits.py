"""Загрузка льготного обеспечения + обогащение справочника ATC-кодами.

ATC нужен не «для красоты»: без него нельзя корректно подобрать аналог.
Совпадение по названию МНН ненадёжно («Ацетилсалициловая кислота» против
«Кислота ацетилсалициловая»), а ATC — это код, он либо равен, либо нет.

Источник ATC — таблица предельных цен по МНН (V2100024253), где рядом стоят
код АТХ и наименование. Матчим её к DrugRef.inn по нормализованному имени.
"""
from __future__ import annotations

from collections import Counter

from rapidfuzz import fuzz, process

from .db import det_id, get_session, init_db, norm_name
from .models import DrugRef, FreeDrug, InnPriceCap
from .sources import adilet_benefits


def _first_word_key(s: str) -> str:
    n = norm_name(s)
    return n.split(" ")[0] if n else ""


def enrich_atc(session, *, threshold: int = 92) -> Counter:
    """Проставляет DrugRef.atc по совпадению МНН с таблицей МНН->ATC.

    Порог высокий (92): неверный ATC приведёт к предложению чужого аналога,
    а это уже вопрос безопасности, а не удобства.
    """
    caps = session.query(InnPriceCap).filter(
        InnPriceCap.kind == "drug", InnPriceCap.atc.isnot(None)).all()
    if not caps:
        return Counter()

    # словарь: нормализованное имя МНН -> ATC (самый частый код для имени)
    by_name: dict[str, Counter] = {}
    for c in caps:
        by_name.setdefault(c.name_norm, Counter())[c.atc] += 1
    names = list(by_name)

    stats = Counter()
    refs = session.query(DrugRef).filter(DrugRef.inn.isnot(None),
                                         DrugRef.atc.is_(None)).all()
    for r in refs:
        stats["candidates"] += 1
        target = r.inn_norm or ""
        if not target:
            continue
        if target in by_name:
            r.atc = by_name[target].most_common(1)[0][0]
            stats["exact"] += 1
            continue
        hit = process.extractOne(target, names, scorer=fuzz.token_sort_ratio,
                                 score_cutoff=threshold)
        if hit:
            r.atc = by_name[hit[0]].most_common(1)[0][0]
            stats["fuzzy"] += 1
    return stats


def build() -> dict:
    init_db()
    session = get_session()
    free, caps = adilet_benefits.fetch_all()

    # Одна и та же пара «препарат + диагноз» встречается в приказе несколько раз
    # (разные показания, разные категории граждан). Дедуп по полному ключу,
    # иначе UNIQUE-конфликт по первичному ключу.
    session.query(FreeDrug).delete()
    uniq_free: dict[str, FreeDrug] = {}
    for f in free:
        fid = det_id("fd", f.mkb10, f.drug_name, f.atc,
                     f.citizen_category, f.indication, f.section)
        uniq_free[fid] = FreeDrug(
            id=fid, mkb10=f.mkb10, disease=f.disease,
            citizen_category=f.citizen_category, indication=f.indication,
            drug_name=f.drug_name, drug_name_norm=norm_name(f.drug_name),
            atc=f.atc, section=f.section,
            source_doc=f.source_doc, source_url=f.source_url,
        )
    session.add_all(uniq_free.values())

    session.query(InnPriceCap).delete()
    uniq_caps: dict[str, InnPriceCap] = {}
    for c in caps:
        cid = det_id("ic", c.atc, c.name, c.characteristic, c.unit, c.price_cap, c.kind)
        uniq_caps[cid] = InnPriceCap(
            id=cid, atc=c.atc, name=c.name, name_norm=norm_name(c.name),
            characteristic=c.characteristic, unit=c.unit, price_cap=c.price_cap,
            kind=c.kind, source_doc=c.source_doc, source_url=c.source_url,
        )
    session.add_all(uniq_caps.values())
    session.commit()

    atc_stats = enrich_atc(session)
    session.commit()

    total_refs = session.query(DrugRef).count()
    with_atc = session.query(DrugRef).filter(DrugRef.atc.isnot(None)).count()
    free_n = session.query(FreeDrug).count()
    caps_n = session.query(InnPriceCap).filter(InnPriceCap.kind == "drug").count()
    dev_n = session.query(InnPriceCap).filter(InnPriceCap.kind == "device").count()
    session.close()

    return {"free": free_n, "inn_caps": caps_n, "devices": dev_n,
            "refs": total_refs, "refs_with_atc": with_atc, **atc_stats}


if __name__ == "__main__":
    s = build()
    print("\n" + "=" * 60)
    print("  ЛЬГОТНОЕ ОБЕСПЕЧЕНИЕ И ATC")
    print("=" * 60)
    print(f"  перечень бесплатных (ҚР ДСМ-75)      {s['free']:>6}")
    print(f"  предельные цены по МНН               {s['inn_caps']:>6}")
    print(f"  медизделия                           {s['devices']:>6}")
    print(f"  ★ справочник с ATC-кодом             {s['refs_with_atc']:>6} / {s['refs']}")
    print(f"      точных совпадений МНН            {s.get('exact', 0):>6}")
    print(f"      нечётких (>=92)                  {s.get('fuzzy', 0):>6}")
