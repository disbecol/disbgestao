import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapPoint = { latitude: number; longitude: number; label?: string; source?: string; capturedAt?: string };
export function RouteMap({ points }: { points: MapPoint[] }) {
  const host = useRef<HTMLDivElement>(null);
  const geometry = JSON.stringify(points);
  useEffect(() => {
    if (!host.current || !points.length) return;
    const map = L.map(host.current, { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
    }).addTo(map);
    const path = points.map(p => L.latLng(p.latitude, p.longitude));
    L.polyline(path, { color: '#246be4', weight: 4, opacity: 0.85 }).addTo(map);
    points.filter(p => p.label).forEach(p => {
      const label = document.createElement('div');
      label.textContent = `${p.label}${p.source === 'Manual' ? ' · posição manual' : ''}`;
      L.circleMarker([p.latitude, p.longitude], { radius: 7, color: '#fff', weight: 3,
        fillColor: p.source === 'Manual' ? '#bf8524' : '#246be4', fillOpacity: 1 }).bindPopup(label).addTo(map);
    });
    if (path.length === 1) map.setView(path[0], 13); else map.fitBounds(L.latLngBounds(path), { padding: [25, 35], maxZoom: 14 });
    const resize = new ResizeObserver(() => map.invalidateSize()); resize.observe(host.current);
    return () => { resize.disconnect(); map.remove(); };
  }, [geometry]);
  return <div ref={host} role="img" aria-label="Trajeto registrado, com posições das etapas. O mapa base precisa de internet." className="leaflet-container" />;
}
