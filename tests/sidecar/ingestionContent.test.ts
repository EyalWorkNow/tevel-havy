import assert from "node:assert/strict";
import test from "node:test";

import { composeIngestionAnalysisBody } from "../../services/ingestionContent";

test("composeIngestionAnalysisBody preserves full extracted attachment text when analyst notes change", () => {
  const body = composeIngestionAnalysisBody("Analyst note: focus on the transfer window.", [
    {
      analysisText:
        "[SYSTEM ATTACHMENT]\nFILENAME: report.pdf\nTYPE: TEXT\nMETADATA: 1024 bytes\n[EXTRACTED_TEXT_START]\nFull PDF text about Maya Cohen at Ashdod Port.\n[EXTRACTED_TEXT_END]",
    },
  ]);

  assert.match(body, /Analyst note: focus on the transfer window\./);
  assert.match(body, /Full PDF text about Maya Cohen at Ashdod Port\./);
});

test("composeIngestionAnalysisBody preserves ordering across multiple uploaded artifacts", () => {
  const body = composeIngestionAnalysisBody("Top note", [
    { analysisText: "[SYSTEM ATTACHMENT]\nFILENAME: alpha.txt\nTYPE: TEXT\nAlpha block" },
    { analysisText: "[SYSTEM ATTACHMENT]\nFILENAME: bravo.txt\nTYPE: TEXT\nBravo block" },
  ]);

  assert.ok(body.indexOf("Top note") < body.indexOf("alpha.txt"));
  assert.ok(body.indexOf("alpha.txt") < body.indexOf("bravo.txt"));
});
