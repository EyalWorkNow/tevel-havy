import assert from "node:assert/strict";
import test from "node:test";

import {
  __estimatePersonExtractTimeoutMsForTests,
  __estimateSmartExtractTimeoutMsForTests,
} from "../../services/sidecarClient";

test("sidecar client expands smart extraction timeout for larger documents", () => {
  const shortTimeout = __estimateSmartExtractTimeoutMsForTests("Maya Cohen met Orion Logistics.");
  const longTimeout = __estimateSmartExtractTimeoutMsForTests("Signal ".repeat(10000));

  assert.ok(shortTimeout >= 35000);
  assert.ok(longTimeout > shortTimeout);
  assert.ok(longTimeout <= 180000);
});

test("sidecar client expands person extraction timeout for larger documents", () => {
  const shortTimeout = __estimatePersonExtractTimeoutMsForTests("John contacted Mary.");
  const longTimeout = __estimatePersonExtractTimeoutMsForTests("John contacted Mary near Ashdod Port. ".repeat(8000));

  assert.ok(shortTimeout >= 35000);
  assert.ok(longTimeout > shortTimeout);
  assert.ok(longTimeout <= 120000);
});
