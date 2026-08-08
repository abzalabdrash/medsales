"use client";

import dynamic from "next/dynamic";
import type { MapPoint } from "./MapView";

// Leaflet touches window/document, so it must never render on the server.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="skeleton h-[360px] w-full rounded-2xl" />,
});

export function LazyMap(props: {
  points: MapPoint[];
  height?: number;
  activeId?: string;
}) {
  return <MapView {...props} />;
}
