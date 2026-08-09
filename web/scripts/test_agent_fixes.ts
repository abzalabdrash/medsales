/**
 * Локальная проверка фиксов агента без браузера.
 * Запуск из web/: npx tsx scripts/test_agent_fixes.ts
 */
import { searchCatalog } from "../lib/drugs";
import { buildBasket } from "../lib/agent/basket";
import { cardsFrom, courseCard } from "../lib/agent/cards";

const near = { lat: 43.206, lng: 76.886, label: "Навои" }; // рядом с Рауза Навои

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log("=== search уголь ===");
const charcoal = searchCatalog("Активир. уголь", "almaty", 8);
console.log(charcoal.map((x) => `${x.price}|${x.title}|inn=${x.inn}`).join("\n"));
assert(
  charcoal.length > 0 && /уголь/i.test(charcoal[0].title),
  "first hit must be charcoal by name",
);
assert(
  !/юниэнзим|сорбикапс|аллохол/i.test(charcoal.map((x) => x.title).join(" ")),
  "no junk charcoal brands in top titles",
);

console.log("\n=== cardsFrom find_drug limit ===");
const fake = {
  items: charcoal.slice(0, 5).map((d) => ({
    offerId: d.offerId,
    title: d.title,
    inn: d.inn,
    atc: d.atc,
    price: d.price,
    packSize: d.packSize,
    form: d.form,
    manufacturer: d.manufacturer,
    isRx: d.isRx,
  })),
};
const cards = cardsFrom("find_drug", {}, fake, "almaty");
assert(cards.length === 1, `expected 1 drug card, got ${cards.length}`);
assert(cardsFrom("drug_prices_by_pharmacy", { title: "x" }, { items: [{ pharmacy: "a", price: 1 }] }, "almaty").length === 0, "pharmacy price cards suppressed");

console.log("\n=== basket one-stop near Navoi ===");
const basket = buildBasket(
  [
    { title: "Олиго цинк", packs: 1 },
    { title: "Аевит", packs: 4 },
    { title: "Уголь активированный", packs: 7 },
    { title: "цинковая паста", packs: 1 },
    { title: "Гиоксизон", packs: 1 },
    { title: "Кальций д3 никомед", packs: 1 },
    { title: "Safeguard", packs: 1 },
  ],
  "almaty",
  { near },
);
console.log(
  JSON.stringify(
    {
      stops: basket.stops.length,
      total: basket.total,
      oneStop: basket.oneStopName,
      oneStopAddr: basket.oneStopAddress,
      oneStopKm: basket.oneStopDistanceKm,
      stopAddrs: basket.stops.map((s) => `${s.address} (~${s.distanceKm}km) ${s.lines.map((l) => l.title).join(",")}`),
      missing: basket.missing,
    },
    null,
    2,
  ),
);
assert(basket.stops.length <= 2, `expected <=2 stops, got ${basket.stops.length}`);
assert(
  basket.stops.every((s) => s.distanceKm == null || s.distanceKm < 8),
  "no far 13km stops",
);
if (basket.oneStopName) {
  assert(basket.stops.length === 1, "one-stop complete should be primary single stop");
}

const cc = courseCard(
  { explainer: "test", units: 30, packs: 1, leftover: 0, coursePrice: 100 },
  { title: "Аевит" },
);
assert(cc[0] && cc[0].kind === "course" && cc[0].title === "Аевит", "course title");

console.log("\nALL CHECKS PASSED");
