// Test harness for the pick-scoring formula (lib/picks.ts).
// Run:  npx tsx lib/picks.test.mts
//
// WHITE BOX  — asserts the internal functions (bayesRating5, quality, gate).
// BLACK BOX  — feeds realistic clinic sets into computePicks and asserts the
//              final cheapest/optimal choice (incl. the 1500₸/2.7★ bug case).

import {
  bayesRating5,
  quality,
  isQualityAcceptable,
  computePicks,
  optimalScore,
  QUALITY_GATE5,
  type PickCandidate,
  type Coords,
} from "./picks";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  \u2713 " + name);
  } else {
    fail++;
    console.log("  \u2717 FAIL: " + name);
  }
}

function cand(
  p: Partial<PickCandidate> & { brandId: string; price: number },
): PickCandidate {
  return {
    brand: p.brandId,
    logo: null,
    rating: null,
    sentiment: null,
    reviewSummary: null,
    reviews: null,
    parsedAt: "",
    branchId: p.brandId + "_b",
    address: null,
    phone: null,
    lat: null,
    lng: null,
    workingHours: null,
    onlineBooking: false,
    durationDays: null,
    ...p,
  };
}

// ══════════ WHITE BOX ══════════
console.log("\nWHITE BOX — internal functions");

const fiveStarOneReview = cand({
  brandId: "5x1",
  price: 4000,
  rating: 5.0,
  reviews: 1,
});
const highRatingManyReviews = cand({
  brandId: "4.9x99",
  price: 4000,
  rating: 4.9,
  reviews: 99,
});

const b51 = bayesRating5(fiveStarOneReview);
const b499 = bayesRating5(highRatingManyReviews);
console.log(
  `    bayes(5.0★/1) = ${b51.toFixed(3)} ; bayes(4.9★/99) = ${b499.toFixed(3)}`,
);
ok("5.0★/1 review is shrunk below 4.2", b51 < 4.2);
ok("4.9★/99 reviews stays high (>4.7)", b499 > 4.7);
ok("THE RULE: 4.9★(99) ranks above 5.0★(1)", b499 > b51);
ok(
  "quality() is within [0,1]",
  quality(highRatingManyReviews) <= 1 && quality(highRatingManyReviews) >= 0,
);

const trashCheap = cand({
  brandId: "trash",
  price: 1500,
  rating: 2.7,
  reviews: 46,
});
const midGood = cand({ brandId: "mid", price: 4500, rating: 4.1, reviews: 33 });
console.log(
  `    bayes(2.7★/46) = ${bayesRating5(trashCheap).toFixed(3)} (gate ${QUALITY_GATE5})`,
);
ok("2.7★/46 FAILS the quality gate", !isQualityAcceptable(trashCheap));
ok("4.1★/33 PASSES the quality gate", isQualityAcceptable(midGood));
ok(
  "more reviews at the same rating => higher bayes",
  bayesRating5(cand({ brandId: "a", price: 1, rating: 4.5, reviews: 200 })) >
    bayesRating5(cand({ brandId: "b", price: 1, rating: 4.5, reviews: 3 })),
);

// ══════════ BLACK BOX ══════════
console.log("\nBLACK BOX — computePicks on realistic clinic sets");

// The exact screenshot bug: 1500₸/2.7★ must NOT be optimal; MDN-like wins.
const city = [
  cand({ brandId: "gp29", price: 1500, rating: 2.7, reviews: 46 }),
  cand({ brandId: "mdn", price: 4000, rating: 5.0, reviews: 4 }),
  cand({ brandId: "detskaya2", price: 4500, rating: 4.1, reviews: 33 }),
  cand({ brandId: "shapagat", price: 4000, rating: 5.0, reviews: 1 }),
  cand({ brandId: "persona", price: 5000, rating: 3.8, reviews: 22 }),
];
const picks = computePicks(city, null);
console.log(
  `    cheapest = ${picks.cheapest?.brandId} ; optimal = ${picks.optimal?.brandId}`,
);
ok("cheapest is the 1500₸ clinic (honest)", picks.cheapest?.brandId === "gp29");
ok("optimal is NOT the 1500₸/2.7★ clinic", picks.optimal?.brandId !== "gp29");
ok(
  "optimal clears the quality gate",
  !!picks.optimal && isQualityAcceptable(picks.optimal),
);

// Two clinics, same price: the better-supported rating wins optimal.
const pair = computePicks([fiveStarOneReview, highRatingManyReviews], null);
ok(
  "same price => 4.9★(99) is optimal over 5.0★(1)",
  pair.optimal?.brandId === "4.9x99",
);

// Pay-a-bit-more-for-quality: cheap-bad vs slightly pricier-good.
const vs = computePicks(
  [
    cand({ brandId: "cheapBad", price: 2000, rating: 3.0, reviews: 40 }),
    cand({ brandId: "goodish", price: 3200, rating: 4.6, reviews: 60 }),
  ],
  null,
);
ok(
  "cheap/3.0★ loses optimal to pricier/4.6★",
  vs.optimal?.brandId === "goodish",
);

// Fallback: if NOBODY clears the gate, still return an optimal (no crash/null).
const allBad = computePicks(
  [
    cand({ brandId: "bad1", price: 1000, rating: 2.5, reviews: 50 }),
    cand({ brandId: "bad2", price: 3000, rating: 2.0, reviews: 50 }),
  ],
  null,
);
ok("all-bad set still yields a non-null optimal", !!allBad.optimal);

// Geo: closest = nearest branch; with geo the optimal blends proximity.
const geo: Coords = { lat: 43.238, lng: 76.945 };
const geoSet = [
  cand({
    brandId: "far",
    price: 3000,
    rating: 4.5,
    reviews: 50,
    lat: 43.35,
    lng: 77.05,
  }),
  cand({
    brandId: "near",
    price: 3000,
    rating: 4.5,
    reviews: 50,
    lat: 43.239,
    lng: 76.946,
  }),
];
const geoPicks = computePicks(geoSet, geo);
ok("closest is the nearby branch", geoPicks.closest?.brandId === "near");
ok(
  "with geo as tie-break, the nearer clinic is optimal",
  geoPicks.optimal?.brandId === "near",
);
ok(
  "optimalScore is higher for the nearer of two equal clinics",
  optimalScore(geoSet[1], 3000, 3000, geo) >
    optimalScore(geoSet[0], 3000, 3000, geo),
);

// ══════════ SUMMARY ══════════
console.log(
  `\n${fail === 0 ? "ALL GREEN" : "HAS FAILURES"}: ${pass} passed, ${fail} failed.`,
);
if (fail > 0) process.exit(1);
