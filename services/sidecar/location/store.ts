import { CaseMapResponse, LocationResolutionResponse, ResolvedLocationRecord } from "./types";

const locationStore = new Map<string, ResolvedLocationRecord>();
const caseStore = new Map<string, LocationResolutionResponse>();

export const persistResolvedLocations = (response: LocationResolutionResponse): void => {
  caseStore.set(response.case_id, response);
  response.resolved_locations.forEach((location) => {
    locationStore.set(location.location_id, location);
  });
};

export const getResolvedLocationById = (locationId: string): ResolvedLocationRecord | null =>
  locationStore.get(locationId) ?? null;

export const getCaseMapResponse = (caseId: string): CaseMapResponse | null => {
  const response = caseStore.get(caseId);
  if (!response) return null;
  return {
    case_id: response.case_id,
    resolved_locations: response.resolved_locations,
    unresolved_candidates: response.candidate_sets.filter((set) => !set.accepted_location_id),
    generated_at: response.generated_at,
  };
};
