# -*- coding: utf-8 -*-
import json
from pathlib import Path

web = Path(__file__).resolve().parent.parent
lines: list[str] = []
for p in sorted(web.glob("_ocr_*.json")):
    t = p.read_text(encoding="utf-8").strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[-1]
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    s, e = t.find("{"), t.rfind("}")
    d = json.loads(t[s : e + 1])
    lines.append("FILE " + p.name)
    for i in d.get("items", []):
        lines.append(
            "%s | %s | raw=%s"
            % (i.get("confidence"), i.get("name"), (i.get("raw") or "")[:120])
        )
    names = " ".join(i.get("name", "") for i in d["items"]).lower()
    lines.append("has_aevit=" + str(("ае" in names) or ("ae-" in names)))
    lines.append("has_d3vit_misread=" + str(("д3-вит" in names) or ("д3 вит" in names)))
    lines.append("has_oligo=" + str("олиго" in names))
    lines.append("has_safeguard=" + str("сейф" in names))
    lines.append("---")

out = web / "_ocr_compare_utf8.txt"
out.write_text("\n".join(lines), encoding="utf-8")
print("wrote", out)
