"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  color: string;
  radius: number;
  label: string;
  fill?: boolean;
  permanent?: boolean;
}

export interface MapLine {
  id: string;
  points: [number, number][];
  color: string;
}

export default function MapView({
  markers,
  lines = [],
  center,
  zoom,
  onClick,
}: {
  markers: MapMarker[];
  lines?: MapLine[];
  center: [number, number];
  zoom: number;
  onClick?: (id: string) => void;
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      zoomSnap={0.5}
      minZoom={2}
      zoomControl={false}
      style={{ height: "100%", width: "100%" }}
    >
      {lines.map((l) => (
        <Polyline key={l.id} positions={l.points} pathOptions={{ color: l.color, weight: 1, opacity: 0.6, dashArray: "2 4" }} />
      ))}
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri"
        maxZoom={16}
      />
      {markers.map((m) => (
        <CircleMarker
          key={m.id}
          center={[m.lat, m.lon]}
          radius={m.radius}
          pathOptions={{ color: m.color, weight: 1.5, fillColor: m.color, fillOpacity: m.fill === false ? 0 : 0.35 }}
          eventHandlers={onClick ? { click: () => onClick(m.id) } : undefined}
        >
          <Tooltip direction="right" offset={[8, 0]} permanent={m.permanent}>
            {m.label}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
