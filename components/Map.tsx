"use client";

import dynamic from "next/dynamic";

const Map = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-bg" />,
});

export default Map;
export type { MapMarker, MapLine } from "./MapView";
