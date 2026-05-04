export interface IngestionArtifactContext {
  id: string;
  previewText: string;
  analysisText: string;
}

const normalizeSection = (value: string): string => value.trim();

export const composeIngestionAnalysisBody = (
  analystNotes: string,
  artifactContexts: Pick<IngestionArtifactContext, "analysisText">[],
): string =>
  [normalizeSection(analystNotes), ...artifactContexts.map((context) => normalizeSection(context.analysisText))]
    .filter(Boolean)
    .join("\n\n");
