/**
 * Debug why Navoi isn't one-stop.
 */
import { pharmacyPrices } from "../lib/drugs";

const near = { lat: 43.206, lng: 76.886 };
const titles = [
  "Олиго цинк",
  "Аевит",
  "Уголь активированный",
  "цинковая паста",
  "Гиоксизон",
  "Кальций д3 никомед",
  "Safeguard",
];

function dist(a: { lat: number | null; lng: number | null }) {
  if (a.lat == null || a.lng == null) return 999;
  const R = 6371;
  const dLat = ((a.lat - near.lat) * Math.PI) / 180;
  const dLng = ((a.lng - near.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((near.lat * Math.PI) / 180) *
      Math.cos((a.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

for (const title of titles) {
  const rows = pharmacyPrices(null, title, "almaty", 80);
  const navoi = rows.filter((r) => (r.address || "").includes("Навои"));
  const nearest = [...rows].sort((a, b) => dist(a) - dist(b))[0];
  console.log(
    `\n${title}: ${rows.length} rows, navoi=${navoi.length}, nearest=${nearest?.pharmacyName} ${nearest?.address} ~${dist(nearest).toFixed(2)}km ${nearest?.price}`,
  );
  if (navoi[0]) console.log("  navoi sample", navoi[0].price, navoi[0].pharmacyName);
}
