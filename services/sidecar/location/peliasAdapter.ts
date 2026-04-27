import { PeliasCandidate } from "./types";

const getPeliasApiBase = (): string => process.env.TEVEL_PELIAS_API_BASE?.trim() || "";
const getPeliasApiKey = (): string => process.env.TEVEL_PELIAS_API_KEY?.trim() || "";

export const isPeliasConfigured = (): boolean => Boolean(getPeliasApiBase());

const normalizeQuery = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"״׳`]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenOverlap = (left: string, right: string): number => {
  const a = new Set(normalizeQuery(left).split(" ").filter(Boolean));
  const b = new Set(normalizeQuery(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((token) => {
    if (b.has(token)) overlap += 1;
  });
  return overlap / Math.max(a.size, b.size);
};

const bboxFromCoords = (coordinates?: [number, number][]): [number, number, number, number] | null => {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lons = coordinates.map((point) => point[0]);
  const lats = coordinates.map((point) => point[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
};

const mapPeliasFeature = (feature: any, rawQuery: string): PeliasCandidate | null => {
  const geometry = feature?.geometry?.coordinates;
  if (!Array.isArray(geometry) || geometry.length < 2) {
    return null;
  }

  const properties = feature?.properties ?? {};
  const label = typeof properties.label === "string" ? properties.label : "";
  const country = typeof properties.country === "string" ? properties.country : undefined;
  const region = typeof properties.region === "string" ? properties.region : undefined;
  const locality = typeof properties.locality === "string" ? properties.locality : undefined;
  const neighbourhood = typeof properties.neighbourhood === "string" ? properties.neighbourhood : undefined;
  const name = typeof properties.name === "string" ? properties.name : label || rawQuery;
  const overlap = Math.max(tokenOverlap(rawQuery, label || name), tokenOverlap(rawQuery, name));
  const baseConfidence = typeof properties.confidence === "number" ? properties.confidence : overlap;

  return {
    canonical_name: name,
    normalized_query: normalizeQuery(rawQuery),
    lat: geometry[1],
    lon: geometry[0],
    bbox: bboxFromCoords(feature?.bbox) ?? null,
    country,
    region,
    locality,
    neighbourhood,
    source: "pelias",
    gid: typeof properties.gid === "string" ? properties.gid : undefined,
    wof_id: typeof properties.source_id === "string" && properties.source === "whosonfirst" ? properties.source_id : undefined,
    geonameid: typeof properties.source_id === "string" && properties.source === "geonames" ? properties.source_id : undefined,
    confidence: Math.max(0, Math.min(1, baseConfidence || overlap)),
    match_label: label || name,
    raw_payload: properties,
  };
};

const fetchPelias = async (pathname: string, searchParams: URLSearchParams): Promise<PeliasCandidate[]> => {
  const peliasApiBase = getPeliasApiBase();
  if (!peliasApiBase) return [];
  const url = new URL(pathname, peliasApiBase.endsWith("/") ? peliasApiBase : `${peliasApiBase}/`);
  searchParams.forEach((value, key) => url.searchParams.set(key, value));
  const peliasApiKey = getPeliasApiKey();
  if (peliasApiKey) {
    url.searchParams.set("api_key", peliasApiKey);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Pelias request failed with status ${response.status}`);
  }

  const data = await response.json() as { features?: any[] };
  return (data.features ?? [])
    .map((feature) => mapPeliasFeature(feature, searchParams.get("text") ?? searchParams.get("address") ?? ""))
    .filter((candidate): candidate is PeliasCandidate => Boolean(candidate));
};

export const queryPelias = async (
  query: string,
  context?: { country?: string; region?: string; locality?: string },
): Promise<PeliasCandidate[]> => {
  const params = new URLSearchParams();
  params.set("text", query);
  params.set("size", "6");
  if (context?.country) params.set("boundary.country", context.country);
  if (context?.region) params.set("boundary.region", context.region);
  if (context?.locality) params.set("boundary.locality", context.locality);
  return fetchPelias("search", params);
};

export const structuredPeliasQuery = async (
  components: Record<string, string>,
  fallbackText: string,
): Promise<PeliasCandidate[]> => {
  const params = new URLSearchParams();
  Object.entries(components).forEach(([key, value]) => {
    if (value?.trim()) params.set(key, value);
  });
  if (!Array.from(params.keys()).length) {
    params.set("text", fallbackText);
    return fetchPelias("search", params);
  }
  params.set("size", "6");
  const candidates = await fetchPelias("search/structured", params);
  return candidates.map((candidate) => ({ ...candidate, normalized_query: normalizeQuery(fallbackText) }));
};
