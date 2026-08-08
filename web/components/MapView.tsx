"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { tenge } from "@/lib/format";

export type MapPoint = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  price?: number;
  address?: string | null;
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

export default function MapView({
  points,
  height = 360,
  activeId,
}: {
  points: MapPoint[];
  height?: number;
  activeId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const all = points.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
    );
    // Drop geo outliers (a branch with a bad coordinate in another city would
    // otherwise zoom the whole map out and pile the price labels into a blob).
    const median = (xs: number[]) =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    let valid = all;
    if (all.length > 2) {
      const mlat = median(all.map((p) => p.lat));
      const mlng = median(all.map((p) => p.lng));
      const near = all.filter(
        (p) => Math.abs(p.lat - mlat) < 1.0 && Math.abs(p.lng - mlng) < 1.2,
      );
      if (near.length) valid = near;
    }
    const center: [number, number] = valid.length
      ? [valid[0].lat, valid[0].lng]
      : [43.238, 76.945];
    const map = L.map(ref.current, { scrollWheelZoom: false }).setView(
      center,
      12,
    );
    mapRef.current = map;
    // CARTO Voyager: crisp, light, retina tiles (no API key). Cleaner than raw OSM.
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 20,
        detectRetina: true,
        subdomains: "abcd",
        attribution: "© OpenStreetMap, © CARTO",
      },
    ).addTo(map);

    markersRef.current = {};
    // Cluster nearby clinics so dense city centres don't pile labels on top of
    // each other; a cluster shows the count, zooming in reveals the prices.
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 46,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (c) =>
        L.divIcon({
          className: "",
          html:
            `<div style="transform:translate(-50%,-50%);display:grid;place-items:center;` +
            `width:34px;height:34px;border-radius:999px;background:var(--color-brand);color:#fff;` +
            `font-weight:700;font-size:13px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">` +
            `${c.getChildCount()}</div>`,
          iconSize: [34, 34],
        }),
    });
    clusterRef.current = cluster;
    const bounds: [number, number][] = [];
    for (const p of valid) {
      const chip =
        "transform:translate(-50%,-100%);white-space:nowrap;background:var(--color-brand);color:#fff;font-weight:600;font-size:12px;line-height:1;padding:5px 8px;border-radius:999px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.28)";
      const dot =
        "transform:translate(-50%,-50%);width:14px;height:14px;border-radius:999px;background:var(--color-brand);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)";
      const html =
        p.price != null
          ? `<div style="${chip}">${tenge(p.price)}</div>`
          : `<div style="${dot}"></div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [0, 0] });
      // cheaper markers float on top; active one is raised in the effect below
      const m = L.marker([p.lat, p.lng], {
        icon,
        riseOnHover: true,
        zIndexOffset: p.price != null ? -Math.round(p.price / 100) : 0,
      });
      const priceLine = p.price != null ? `<br>${tenge(p.price)}` : "";
      const addrLine = p.address ? `<br>${escapeHtml(p.address)}` : "";
      m.bindPopup(`<b>${escapeHtml(p.label)}</b>${addrLine}${priceLine}`);
      cluster.addLayer(m);
      markersRef.current[p.id] = m;
      bounds.push([p.lat, p.lng]);
    }
    map.addLayer(cluster);
    if (bounds.length > 1)
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
      clusterRef.current = null;
    };
  }, [points]);

  // Pan to and open the popup of the marker the user clicked "На карте" for.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeId) return;
    const m = markersRef.current[activeId];
    const cl = clusterRef.current;
    if (m && cl) {
      cl.zoomToShowLayer(m, () => {
        m.setZIndexOffset(1000);
        m.openPopup();
      });
    } else if (m) {
      map.panTo(m.getLatLng());
      m.openPopup();
    }
  }, [activeId]);

  const boxStyle = { height };
  return (
    <div
      ref={ref}
      style={boxStyle}
      className="w-full overflow-hidden rounded-2xl border border-line bg-surface"
    />
  );
}
