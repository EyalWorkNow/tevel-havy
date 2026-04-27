import { PersonDossier, PersonEntity, PersonExtractionResponse, PersonFact, PersonResolutionResponse } from "./types";

const extractionStore = new Map<string, PersonExtractionResponse>();
const resolutionStore = new Map<string, PersonResolutionResponse>();
const dossierStore = new Map<string, PersonDossier>();
const entityStore = new Map<string, PersonEntity>();
const factStore = new Map<string, PersonFact>();
const caseEntityIndex = new Map<string, string[]>();

export const persistPersonExtraction = (response: PersonExtractionResponse): void => {
  extractionStore.set(response.caseId, response);
  response.facts.forEach((fact) => factStore.set(fact.factId, fact));
};

export const persistPersonResolution = (response: PersonResolutionResponse): void => {
  resolutionStore.set(response.caseId, response);
  response.entities.forEach((entity) => entityStore.set(entity.entityId, entity));
  response.facts.forEach((fact) => factStore.set(fact.factId, fact));
  caseEntityIndex.set(response.caseId, response.entities.map((entity) => entity.entityId));
};

export const persistPersonDossier = (dossier: PersonDossier): void => {
  dossierStore.set(dossier.entityId, dossier);
};

export const getPersonEntity = (entityId: string): PersonEntity | null => entityStore.get(entityId) ?? null;
export const getPersonDossier = (entityId: string): PersonDossier | null => dossierStore.get(entityId) ?? null;
export const getCasePersons = (caseId: string): PersonEntity[] => (caseEntityIndex.get(caseId) || []).map((id) => entityStore.get(id)).filter((v): v is PersonEntity => Boolean(v));
export const getPersonResolution = (caseId: string): PersonResolutionResponse | null => resolutionStore.get(caseId) ?? null;
