import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destDir = path.join(webRoot, "data");
const dest = path.join(destDir, "medsales.db");
const sources = [
  path.join(webRoot, "..", "data", "medsales.db"),
  path.join(webRoot, "data", "medsales.db"),
];

if (existsSync(dest) && statSync(dest).size > 1_000_000) {
  console.log("ensure-db: ok", dest);
  process.exit(0);
}

const src = sources.find((p) => existsSync(p) && statSync(p).size > 1_000_000);
if (!src) {
  console.warn(
    "ensure-db: medsales.db not found — build may fail at runtime without MEDPRICE_DB",
  );
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
if (path.resolve(src) !== path.resolve(dest)) {
  console.log("ensure-db: copy", src, "->", dest);
  copyFileSync(src, dest);
} else {
  console.log("ensure-db: already in place", dest);
}
