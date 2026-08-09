# -*- coding: utf-8 -*-
"""Bake-off: Sol vs Gemini 3.1 Pro on prescription photo via Clodex."""
from __future__ import annotations

import base64
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHOTO = Path(
    r"C:\Users\abdra\.cursor\projects\c-Users-abdra-Projects-AITK\assets"
    r"\c__Users_abdra_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images"
    r"_WhatsApp_Image_2026-07-25_at_15.20.20-bbb31688-e474-4d79-8c99-109524ae170c.png"
)
# fallback shorter path if renamed
if not PHOTO.exists():
    cands = list(Path(r"C:\Users\abdra\.cursor\projects\c-Users-abdra-Projects-AITK\assets").rglob("*WhatsApp*15.20*"))
    PHOTO = cands[0] if cands else PHOTO

PROMPT = """Ты читаешь врачебное назначение БУКВА В БУКВУ, СЛОВО В СЛОВО.
Не исправляй и не дополняй названия по памяти. Пиши как на бумаге.
Не извлекай ФИО, дату рождения, ИИН, диагноз.
Для каждой строки: name, dosage, dosePerIntake, timesPerDay, days, kind, confidence, raw.
Ответ строго JSON: {"readable": true, "items": [...]}"""


def load_key() -> str:
    raw = (ROOT / ".env").read_text(encoding="utf-8-sig", errors="ignore")
    for line in raw.splitlines():
        line = line.strip().strip("'\"")
        if line.startswith("API_KEYS="):
            return line.split("=", 1)[1].strip().strip("'\"").split(",")[0].strip()
    raise SystemExit("no API_KEYS")


def call(model: str, data_url: str, key: str) -> tuple[float, str]:
    body = {
        "model": model,
        "stream": False,
        "reasoning_effort": "low",
        "messages": [
            {"role": "system", "content": PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Прочитай назначение и верни позиции в JSON."},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
    }
    req = urllib.request.Request(
        "https://clodex.xyz/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read().decode("utf-8", errors="replace")
    dt = time.perf_counter() - t0
    obj = json.loads(raw)
    text = obj["choices"][0]["message"]["content"]
    return dt, text


def names(text: str) -> list[str]:
    try:
        # strip fences
        t = text.strip()
        if t.startswith("```"):
            t = t.split("\n", 1)[-1]
            if t.endswith("```"):
                t = t[:-3]
        start, end = t.find("{"), t.rfind("}")
        data = json.loads(t[start : end + 1])
        return [str(i.get("name", "")) for i in data.get("items", [])]
    except Exception:
        return [f"<parse fail> {text[:120]}"]


def main() -> None:
    print("photo", PHOTO, "exists", PHOTO.exists(), "bytes", PHOTO.stat().st_size if PHOTO.exists() else 0)
    b64 = base64.b64encode(PHOTO.read_bytes()).decode()
    data_url = f"data:image/png;base64,{b64}"
    key = load_key()
    for model in ["gpt-5.6-sol", "gemini-3.1-pro"]:
        print("\n===", model, "===")
        try:
            dt, text = call(model, data_url, key)
            print(f"time_sec={dt:.1f}")
            for n in names(text):
                print(" -", n)
            # save full
            out = ROOT / "web" / f"_ocr_{model.replace('.', '_')}.json"
            out.write_text(text, encoding="utf-8")
            print("saved", out.name)
        except Exception as e:
            print("FAIL", type(e).__name__, e)


if __name__ == "__main__":
    main()
