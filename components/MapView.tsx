import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AlertTriangle, Crosshair, MapPin, Navigation, Radio, ShieldAlert } from 'lucide-react';

import { Entity, Relation } from '../types';
import { getCaseMapWithSidecar, resolveLocationsWithSidecar } from '../services/sidecarClient';
import { buildLocationMentionsForEntities, buildLocationQueriesForEntity } from '../services/locationResolutionUtils';
import { CaseMapResponse, LocationCandidateSet, ResolvedLocationRecord } from '../services/sidecar/location/types';

interface MapViewProps {
  locations: Entity[];
  relations: Relation[];
  onLocationClick: (id: string) => void;
  caseId?: string;
}

type HeuristicResolvedLocation = {
  location_id: string;
  canonical_name: string;
  lat: number;
  lon: number;
  confidence: number;
  pin_confidence: 'medium';
  resolution_method: 'heuristic_fallback';
  source: 'heuristic_fallback';
  evidence_mentions: string[];
};

const HEURISTIC_KNOWN_LOCATIONS: Record<string, { lat: number; lon: number }> = {
  'ashdod port': { lat: 31.8184, lon: 34.65 },
  'port of ashdod': { lat: 31.8184, lon: 34.65 },
  'נמל אשדוד': { lat: 31.8184, lon: 34.65 },
  'tel aviv': { lat: 32.0853, lon: 34.7818 },
  'haifa': { lat: 32.794, lon: 34.9896 },
  'jerusalem': { lat: 31.7683, lon: 35.2137 },
  'amman': { lat: 31.9539, lon: 35.9106 },
  'beirut': { lat: 33.8938, lon: 35.5018 },
};

const normalize = (value: string): string =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['"״׳`]/g, '')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const resolveHeuristicLocation = (entity: Entity): HeuristicResolvedLocation | null => {
  const queries = buildLocationQueriesForEntity(entity);
  for (const query of queries) {
    const hit = HEURISTIC_KNOWN_LOCATIONS[normalize(query)];
    if (hit) {
      return {
        location_id: `heuristic_${entity.id}`,
        canonical_name: query,
        lat: hit.lat,
        lon: hit.lon,
        confidence: 0.61,
        pin_confidence: 'medium',
        resolution_method: 'heuristic_fallback',
        source: 'heuristic_fallback',
        evidence_mentions: [entity.id],
      };
    }
  }
  return null;
};

const markerColor = (location: Pick<ResolvedLocationRecord, 'pin_confidence' | 'resolution_method'> | HeuristicResolvedLocation): string => {
  if (location.resolution_method === 'heuristic_fallback') return '#f59e0b';
  if (location.pin_confidence === 'high') return '#05DF9C';
  if (location.pin_confidence === 'medium') return '#f59e0b';
  return '#64748b';
};

const MapView: React.FC<MapViewProps> = ({ locations, relations, onLocationClick, caseId = 'browser_case' }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [caseMap, setCaseMap] = useState<CaseMapResponse | null>(null);
  const [fallbackMode, setFallbackMode] = useState<'resolved' | 'heuristic'>('resolved');
  const [focusedLocationId, setFocusedLocationId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap &copy; CARTO',
          },
        },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
      },
      center: [35, 31.5],
      zoom: 4.5,
    });

    mapRef.current.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    mapRef.current.on('load', () => setMapReady(true));

    return () => {
      setMapReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const mentions = buildLocationMentionsForEntities(locations, relations, caseId);
      if (!mentions.length) {
        if (!cancelled) {
          setCaseMap({ case_id: caseId, resolved_locations: [], unresolved_candidates: [], generated_at: new Date().toISOString() });
          setFallbackMode('resolved');
        }
        return;
      }

      const resolved = await resolveLocationsWithSidecar(caseId, mentions);
      if (cancelled) return;

      if (resolved) {
        const hydrated = await getCaseMapWithSidecar(caseId);
        setCaseMap(
          hydrated ?? {
            case_id: resolved.case_id,
            resolved_locations: resolved.resolved_locations,
            unresolved_candidates: resolved.candidate_sets.filter((set) => !set.accepted_location_id),
            generated_at: resolved.generated_at,
          },
        );
        setFallbackMode(resolved.fallback_mode === 'heuristic' ? 'heuristic' : 'resolved');
        return;
      }

      const heuristic = locations
        .map(resolveHeuristicLocation)
        .filter((item): item is HeuristicResolvedLocation => Boolean(item));
      setCaseMap({
        case_id: caseId,
        resolved_locations: heuristic as unknown as ResolvedLocationRecord[],
        unresolved_candidates: [],
        generated_at: new Date().toISOString(),
      });
      setFallbackMode('heuristic');
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [caseId, locations, relations]);

  const unresolvedCandidates = caseMap?.unresolved_candidates ?? [];

  const visibleLocations = useMemo(() => {
    const resolved = caseMap?.resolved_locations ?? [];
    if (!focusedLocationId) return resolved;
    return resolved.filter((location) => location.location_id === focusedLocationId || location.evidence_mentions.includes(focusedLocationId));
  }, [caseMap, focusedLocationId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const lineFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const bounds = new LngLatBounds();

    const resolvedByEntity = new Map<string, ResolvedLocationRecord>();
    (caseMap?.resolved_locations ?? []).forEach((location) => {
      location.evidence_mentions.forEach((mentionId) => {
        const entityId = mentionId.replace(/_loc_\d+$/, '');
        resolvedByEntity.set(entityId, location);
      });
    });

    visibleLocations.forEach((location) => {
      if (location.lon == null || location.lat == null) return;
      const el = document.createElement('button');
      el.className = 'tevel-map-marker';
      el.style.width = location.pin_confidence === 'high' ? '18px' : '14px';
      el.style.height = location.pin_confidence === 'high' ? '18px' : '14px';
      el.style.borderRadius = '999px';
      el.style.border = '2px solid rgba(255,255,255,0.9)';
      el.style.background = markerColor(location);
      el.style.boxShadow = `0 0 18px ${markerColor(location)}`;
      el.style.cursor = 'pointer';
      el.title = `${location.canonical_name} (${location.pin_confidence})`;

      el.addEventListener('click', () => {
        setFocusedLocationId(location.location_id);
        onLocationClick(location.evidence_mentions[0] ?? location.location_id);
      });

      const popup = new maplibregl.Popup({ offset: 18 }).setHTML(
        `<div style="min-width:220px">
          <div style="font-weight:700;color:#fff">${location.canonical_name}</div>
          <div style="font-size:12px;color:#94a3b8">${location.country ?? 'Unknown country'}${location.region ? ` · ${location.region}` : ''}${location.locality ? ` · ${location.locality}` : ''}</div>
          <div style="font-size:11px;color:${location.pin_confidence === 'high' ? '#05DF9C' : '#f59e0b'};margin-top:6px">
            ${location.pin_confidence === 'high' ? 'High confidence exact pin' : location.pin_confidence === 'medium' ? 'Approximate pin' : 'Low confidence'}
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px">Method: ${location.resolution_method}</div>
        </div>`,
      );

      const marker = new maplibregl.Marker({ element: el }).setLngLat([location.lon, location.lat]).setPopup(popup).addTo(map);
      markersRef.current.push(marker);
      bounds.extend([location.lon, location.lat]);
    });

    relations.forEach((relation) => {
      const sourceLoc = resolvedByEntity.get(String(relation.source));
      const targetLoc = resolvedByEntity.get(String(relation.target));
      if (!sourceLoc || !targetLoc || sourceLoc.lon == null || sourceLoc.lat == null || targetLoc.lon == null || targetLoc.lat == null) {
        return;
      }

      lineFeatures.push({
        type: 'Feature',
        properties: { relationType: relation.type },
        geometry: {
          type: 'LineString',
          coordinates: [
            [sourceLoc.lon, sourceLoc.lat],
            [targetLoc.lon, targetLoc.lat],
          ],
        },
      });
    });

    const sourceId = 'tevel-location-lines';
    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: lineFeatures,
      });
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: lineFeatures,
        },
      });
      map.addLayer({
        id: sourceId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#38bdf8',
          'line-width': 2,
          'line-opacity': 0.45,
        },
      });
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 64, maxZoom: 10, duration: 800 });
    }
  }, [caseMap, visibleLocations, relations, onLocationClick, mapReady]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="absolute inset-0" />
        <div className="absolute top-4 left-4 z-10 max-w-sm rounded-xl border border-slate-700/70 bg-[rgba(10,16,27,0.88)] p-4 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-2 text-white">
            <Crosshair size={16} className="text-[#05DF9C]" />
            <div className="text-sm font-bold">Location Resolution Layer</div>
          </div>
          <div className="mt-2 text-[11px] font-mono uppercase tracking-wide text-slate-400">
            {fallbackMode === 'heuristic' ? 'Heuristic fallback active' : 'Backend geoparsing active'}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-slate-500">Resolved</div>
              <div className="font-bold text-white">{caseMap?.resolved_locations.length ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-500">Unresolved</div>
              <div className="font-bold text-amber-400">{unresolvedCandidates.length}</div>
            </div>
            <div>
              <div className="text-slate-500">Case</div>
              <div className="font-bold text-slate-200 truncate">{caseId}</div>
            </div>
          </div>
          {fallbackMode === 'heuristic' && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-200">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              <span>Map pins are coming from the heuristic fallback, not the Pelias-backed resolver.</span>
            </div>
          )}
        </div>
      </div>

      <aside className="w-[360px] border-l border-slate-800 bg-[rgba(8,12,20,0.95)] p-4 overflow-y-auto">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <MapPin size={16} className="text-[#05DF9C]" />
          Resolved Locations
        </div>
        <div className="mt-4 space-y-3">
          {(caseMap?.resolved_locations ?? []).map((location) => (
            <button
              key={location.location_id}
              onClick={() => {
                setFocusedLocationId(location.location_id);
                onLocationClick(location.evidence_mentions[0] ?? location.location_id);
              }}
              className={`w-full rounded-xl border p-3 text-left transition-all ${
                focusedLocationId === location.location_id
                  ? 'border-[#05DF9C]/60 bg-[#05DF9C]/10'
                  : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-white">{location.canonical_name}</div>
                <div className={`rounded-full px-2 py-1 text-[10px] font-mono uppercase ${
                  location.pin_confidence === 'high'
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : location.pin_confidence === 'medium'
                    ? 'bg-amber-500/10 text-amber-300'
                    : 'bg-slate-700 text-slate-300'
                }`}>
                  {location.pin_confidence}
                </div>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {[location.country, location.region, location.locality].filter(Boolean).join(' · ') || 'Administrative hierarchy unavailable'}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                {location.resolution_method} · {location.source}
              </div>
              {location.warning && (
                <div className="mt-2 flex items-start gap-2 text-[11px] text-amber-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{location.warning}</span>
                </div>
              )}
            </button>
          ))}
        </div>

        {!!unresolvedCandidates.length && (
          <div className="mt-6">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
              <Radio size={15} />
              Unresolved Candidates
            </div>
            <div className="mt-3 space-y-3">
              {unresolvedCandidates.map((set: LocationCandidateSet) => (
                <div key={set.mention_id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="text-sm font-semibold text-white">{set.candidates[0]?.raw_text ?? set.mention_id}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">{set.mention_type}</div>
                  <div className="mt-2 text-[12px] text-amber-200">{set.unresolved_reason ?? 'Multiple plausible candidates remain.'}</div>
                  <div className="mt-3 space-y-2">
                    {set.candidates.slice(0, 3).map((candidate) => (
                      <div key={candidate.location_id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                        <div className="text-sm text-slate-100">{candidate.canonical_name}</div>
                        <div className="text-[11px] text-slate-500">
                          {[candidate.country, candidate.region, candidate.locality].filter(Boolean).join(' · ') || 'No admin hierarchy'}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">confidence {candidate.confidence.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!(caseMap?.resolved_locations.length || unresolvedCandidates.length) && (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
            <div className="flex items-center gap-2 text-slate-200">
              <Navigation size={14} />
              No resolved map entities yet
            </div>
            <div className="mt-2 text-xs">
              Upload more location-rich evidence or improve extraction confidence to populate the map.
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};

export default MapView;
