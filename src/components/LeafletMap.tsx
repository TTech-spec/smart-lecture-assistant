import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type * as L from "leaflet";

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  label: string;
};

type Props = {
  /** Centre pin (the lecturer / venue) */
  center: { lat: number; lng: number };
  /** Allowed radius in metres, drawn around the centre */
  radius?: number;
  /** Extra coloured dots (students) */
  points?: MapPoint[];
  /** Let the lecturer drag the centre pin to the exact building */
  draggable?: boolean;
  onMove?: (pos: { lat: number; lng: number }) => void;
  className?: string;
  zoom?: number;
};

/**
 * Free street map (OpenStreetMap tiles via Leaflet) — no API key, no billing.
 * Leaflet touches `window`, so it is only loaded in the browser.
 */
export function LeafletMap({ center, radius, points = [], draggable, onMove, className, zoom = 17 }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const lib = useRef<typeof L | null>(null);
  const centreMarker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  // Create the map once
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      const Lf = (mod as unknown as { default?: typeof L }).default ?? (mod as unknown as typeof L);
      if (cancelled || !el.current || map.current) return;
      lib.current = Lf;
      const m = Lf.map(el.current, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], zoom);
      Lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      // Default marker images don't resolve through bundlers; use a simple pin
      const icon = Lf.divIcon({
        className: "",
        html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#121a2b;border:3px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 22],
      });
      centreMarker.current = Lf.marker([center.lat, center.lng], { icon, draggable: Boolean(draggable), title: "Class location" }).addTo(m);
      centreMarker.current.on("dragend", () => {
        const p = centreMarker.current!.getLatLng();
        circle.current?.setLatLng(p);
        onMoveRef.current?.({ lat: p.lat, lng: p.lng });
      });
      if (radius) {
        circle.current = Lf.circle([center.lat, center.lng], {
          radius, color: "#12b886", weight: 2, dashArray: "6 5", fillColor: "#12b886", fillOpacity: 0.1,
        }).addTo(m);
      }
      layer.current = Lf.layerGroup().addTo(m);
      map.current = m;
      drawPoints();
      // The container may have been sized after mount
      setTimeout(() => m.invalidateSize(), 50);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow centre / radius changes (e.g. re-verified, venue picked)
  useEffect(() => {
    if (!map.current) return;
    centreMarker.current?.setLatLng([center.lat, center.lng]);
    circle.current?.setLatLng([center.lat, center.lng]);
    if (radius) circle.current?.setRadius(radius);
    map.current.setView([center.lat, center.lng], map.current.getZoom());
  }, [center.lat, center.lng, radius]);

  useEffect(() => { drawPoints(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [points]);

  function drawPoints() {
    const Lf = lib.current;
    if (!Lf || !layer.current) return;
    layer.current.clearLayers();
    for (const p of points) {
      Lf.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: p.color, fillOpacity: 1 })
        .bindTooltip(p.label)
        .addTo(layer.current);
    }
  }

  return <div ref={el} className={className} style={{ minHeight: 220, zIndex: 0 }} role="region" aria-label="Map" />;
}
