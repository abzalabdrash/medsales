"use client";

// Profile kept in localStorage as the live, reactive cache. When the user is
// logged in, every change is also pushed to the server (debounced) and the
// server copy is pulled in on login — so favorites/watches/address follow the
// account. Logged out, it's a local guest profile.
//
//   favorites  — starred (clinic + service) offers AND whole clinics
//   address    — geocoded / shared coordinates {label,lat,lng}
//   watches    — price-watch on a specific service at a specific clinic

import { useEffect, useState, useSyncExternalStore } from "react";

const KEY = "medprice.profile.v1";
const EVT = "medprice:profile";

// A favourited offer = a concrete service AT a concrete clinic.
export type FavOffer = {
  kind: "offer";
  clinicId: string;
  clinicName: string;
  serviceId: string;
  serviceName: string;
  city: string;
  price?: number;
};
export type FavClinic = {
  kind: "clinic";
  id: string;
  name: string;
  city: string;
};
export type Favorite = FavOffer | FavClinic;

export type SavedAddress = { label: string; lat: number; lng: number };

// Price watch on a specific (clinic, service) — "tell me if THIS gets cheaper".
export type Watch = {
  clinicId: string;
  serviceId: string;
  clinicName: string;
  serviceName: string;
  city: string;
  phone: string;
  price?: number;
  createdAt: number;
};

export type Profile = {
  favorites: Favorite[];
  address: SavedAddress | null;
  watches: Watch[];
};

const EMPTY: Profile = { favorites: [], address: null, watches: [] };

export function favKey(f: Favorite): string {
  return f.kind === "offer"
    ? `offer:${f.clinicId}:${f.serviceId}`
    : `clinic:${f.id}`;
}
export function watchKey(clinicId: string, serviceId: string): string {
  return `${clinicId}:${serviceId}`;
}

function read(): Profile {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<Profile>;
    return {
      favorites: Array.isArray(p.favorites) ? p.favorites : [],
      address: p.address ?? null,
      watches: Array.isArray(p.watches) ? p.watches : [],
    };
  } catch {
    return EMPTY;
  }
}

// ── server sync ─────────────────────────────────────────────────────────
let _serverSync = false;
let _pushTimer: ReturnType<typeof setTimeout> | null = null;

export function setServerSync(on: boolean): void {
  _serverSync = on;
}

function pushToServer(p: Profile): void {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: p }),
    }).catch(() => {});
  }, 500);
}

// Load the account's saved profile into the local cache (called on login).
export async function hydrateFromServer(): Promise<void> {
  try {
    const r = await fetch("/api/profile");
    if (!r.ok) return;
    const { data } = await r.json();
    if (data && typeof data === "object") {
      writeLocal({
        favorites: Array.isArray(data.favorites) ? data.favorites : [],
        address: data.address ?? null,
        watches: Array.isArray(data.watches) ? data.watches : [],
      });
    }
  } catch {
    /* ignore */
  }
}

export function clearLocal(): void {
  writeLocal(EMPTY);
}

function writeLocal(p: Profile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(p));
  window.dispatchEvent(new Event(EVT));
}

function write(p: Profile): void {
  writeLocal(p);
  if (_serverSync) pushToServer(p);
}

// ── mutations ──────────────────────────────────────────────────────────
export function isFavorite(key: string): boolean {
  return read().favorites.some((f) => favKey(f) === key);
}

export function toggleFavorite(fav: Favorite): boolean {
  const p = read();
  const key = favKey(fav);
  const exists = p.favorites.some((f) => favKey(f) === key);
  p.favorites = exists
    ? p.favorites.filter((f) => favKey(f) !== key)
    : [fav, ...p.favorites];
  write(p);
  return !exists;
}

export function removeFavorite(key: string): void {
  const p = read();
  p.favorites = p.favorites.filter((f) => favKey(f) !== key);
  write(p);
}

export function setAddress(addr: SavedAddress | null): void {
  const p = read();
  p.address = addr;
  write(p);
}

export function addWatch(w: Omit<Watch, "createdAt">): void {
  const p = read();
  const key = watchKey(w.clinicId, w.serviceId);
  p.watches = [
    { ...w, createdAt: Date.now() },
    ...p.watches.filter((x) => watchKey(x.clinicId, x.serviceId) !== key),
  ];
  write(p);
}

export function removeWatch(clinicId: string, serviceId: string): void {
  const p = read();
  const key = watchKey(clinicId, serviceId);
  p.watches = p.watches.filter(
    (x) => watchKey(x.clinicId, x.serviceId) !== key,
  );
  write(p);
}

export function isWatched(clinicId: string, serviceId: string): boolean {
  const key = watchKey(clinicId, serviceId);
  return read().watches.some((x) => watchKey(x.clinicId, x.serviceId) === key);
}

// ── reactive hooks ─────────────────────────────────────────────────────
function subscribe(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

let _cache: Profile = EMPTY;
let _cacheRaw = "";
function snapshot(): Profile {
  if (typeof window === "undefined") return EMPTY;
  const raw = window.localStorage.getItem(KEY) ?? "";
  if (raw !== _cacheRaw) {
    _cacheRaw = raw;
    _cache = read();
  }
  return _cache;
}

export function useProfile(): Profile {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export type Coords = { lat: number; lng: number };
export type GeoState = "idle" | "loading" | "denied";

// Coordinates for the "closest" pick: saved/shared address first, else live geo.
export function useUserCoords(): {
  coords: Coords | null;
  source: "address" | "geo" | null;
  state: GeoState;
  request: () => void;
} {
  const profile = useProfile();
  const [geo, setGeo] = useState<Coords | null>(null);
  const [state, setState] = useState<GeoState>("idle");

  const addr = profile.address;
  const coords: Coords | null = addr ? { lat: addr.lat, lng: addr.lng } : geo;
  const source = addr ? "address" : geo ? "geo" : null;

  function request() {
    if (addr || geo) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("denied");
      return;
    }
    setState("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setState("idle");
      },
      () => setState("denied"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  }

  useEffect(() => {
    if (addr && geo) setGeo(null);
  }, [addr, geo]);

  return { coords, source, state, request };
}
