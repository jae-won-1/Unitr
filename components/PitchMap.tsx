"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

// Fix default marker icons broken by webpack
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type Pitch = {
  id: string;
  name: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  price_per_hour: number;
  formats: string[];
  surfaces: string[];
  amenities: string[];
  rating: number;
  is_verified: boolean;
};

function makeIcon(_label: string, picked: boolean, rank: number | null, unaffordable: boolean = false) {
  const bg = picked ? "#00E676" : unaffordable ? "#EF4444" : "#166534";
  const color = picked ? "#000" : "#fff";
  const content = rank !== null ? String(rank + 1) : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  return L.divIcon({
    html: `<div style="width:36px;height:36px;background:${bg};border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:${color};box-shadow:0 2px 6px rgba(0,0,0,0.4)">${content}</div>`,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
}

function FitBounds({ pitches }: { pitches: Pitch[] }) {
  const map = useMap();
  useEffect(() => {
    const mapped = pitches.filter((p) => p.lat != null && p.lng != null);
    if (mapped.length === 0) return;
    const bounds = L.latLngBounds(mapped.map((p) => [p.lat!, p.lng!]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [pitches, map]);
  return null;
}

export default function PitchMap({
  pitches,
  pickedPitches,
  onSelect,
  unaffordableIds = new Set(),
}: {
  pitches: Pitch[];
  pickedPitches: Pitch[];
  onSelect: (p: Pitch) => void;
  selectMode: boolean;
  unaffordableIds?: Set<string>;
}) {
  const center: [number, number] = [51.545, -0.055];

  return (
    <MapContainer
      center={center}
      zoom={12}
      style={{ height: "900px", width: "100%", borderRadius: "16px" }}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds pitches={pitches} />
      {pitches.filter((p) => p.lat != null && p.lng != null).map((pitch) => {
        const rankIdx = pickedPitches.findIndex((p) => p.id === pitch.id);
        const isPicked = rankIdx !== -1;
        const unaffordable = unaffordableIds.has(pitch.id);
        return (
          <Marker
            key={pitch.id}
            position={[pitch.lat!, pitch.lng!]}
            icon={makeIcon(pitch.name, isPicked, isPicked ? rankIdx : null, unaffordable)}
            eventHandlers={{ click: () => onSelect(pitch) }}
          >
            <Popup>
              <div style={{ minWidth: 160 }}>
                <p style={{ fontWeight: 700, marginBottom: 2 }}>{pitch.name}</p>
                <p style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>{pitch.address}</p>
                <p style={{ fontWeight: 700, color: unaffordable ? "#f87171" : "#00c853" }}>£{(pitch.price_per_hour * 1.05).toFixed(2)}/hr</p>
                <p style={{ fontSize: 11, color: "#888" }}>{pitch.formats.join(", ")} · ⭐ {pitch.rating}</p>
                {unaffordable && <p style={{ fontSize: 11, color: "#f87171", marginTop: 4 }}>Insufficient team credits</p>}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
