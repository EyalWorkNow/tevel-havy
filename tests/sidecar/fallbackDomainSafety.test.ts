import assert from "node:assert/strict";
import test from "node:test";

import { detectDocumentDomain } from "../../services/documentDomain";
import { detectResearchProfile } from "../../services/researchProfiles";

// Test E: Fallback domain safety — Hebrew intel docs must not produce SEC-framed output

// Verify that the underlying classification functions used by fallback
// correctly identify Hebrew intel docs and do NOT classify as SEC/FINANCE.

test("fallback domain safety: Hebrew intel text does not resolve to FINANCE profile", () => {
  const texts = [
    'סיווג: סודי. דו"ח מודיעין. צי"ח. שב"כ. 8200. מפעיל חיצוני. תצפית.',
    'מכרז קו ענבר. ועדת מכרזים. דליפה. נהנה סופי. חברת קש. עיכוב יבוא.',
    'כוח מבצע. דו"ח תצפית. דירת מסתור. המלצה אופרטיבית. Go/No-Go.',
  ];

  for (const text of texts) {
    const profile = detectResearchProfile(text);
    assert.notEqual(
      profile.resolvedProfile,
      "FINANCE",
      `Expected not FINANCE for: "${text.slice(0, 60)}..." — got ${profile.resolvedProfile}`,
    );
    const domain = detectDocumentDomain(text);
    assert.notEqual(
      domain.domain,
      "financial_regulatory",
      `Expected not financial_regulatory for: "${text.slice(0, 60)}..." — got ${domain.domain}`,
    );
  }
});

test("fallback domain safety: Hebrew fallback text does not contain SEC/financial bias markers", () => {
  // Verify detectDocumentDomain returns non-SEC for mixed Hebrew investigative+money text
  const mixedText = [
    'דו"ח מודיעין. צי"ח. שב"כ.',
    'העביר 380,000 אירו ל-Cyprus Holdings.',
    'ערוץ תשלום: USDT ארנק. העברה בנקאית 220,000 ש"ח.',
    'מחסן לוגיסטי. רכב שירות. הכוונה חיצונית.',
  ].join("\n");

  const domain = detectDocumentDomain(mixedText);
  assert.notEqual(domain.domain, "financial_regulatory",
    `Mixed Hebrew intel+money text must NOT be financial_regulatory. Got: ${domain.domain}`);

  const profile = detectResearchProfile(mixedText);
  assert.notEqual(profile.resolvedProfile, "FINANCE",
    `Mixed Hebrew intel+money text must NOT resolve to FINANCE. Got: ${profile.resolvedProfile}`);
});

test("fallback domain safety: SEC classification requires 2+ strong signals", () => {
  // Just SECURITIES AND EXCHANGE COMMISSION but no form type — not enough
  const weakSec = "The SECURITIES AND EXCHANGE COMMISSION may review this filing.";
  const domain = detectDocumentDomain(weakSec);
  // Confidence should be < 0.72 because only 1 strong signal
  const isWeakSec = domain.domain === "financial_regulatory" && domain.confidence >= 0.72;
  assert.ok(!isWeakSec, `Expected weak SEC text to not reach financial_regulatory with high confidence. Got domain=${domain.domain}, confidence=${domain.confidence}`);
});

test("fallback domain safety: Full SEC 10-K still classified correctly", () => {
  const strongSec = [
    "UNITED STATES SECURITIES AND EXCHANGE COMMISSION",
    "FORM 10-K",
    "Management Discussion and Analysis",
    "Consolidated Balance Sheets",
    "GAAP",
  ].join("\n");

  const domain = detectDocumentDomain(strongSec);
  assert.equal(domain.domain, "financial_regulatory",
    `Strong SEC text must be financial_regulatory. Got: ${domain.domain}`);
  assert.ok(domain.confidence >= 0.72,
    `Strong SEC confidence must be >= 0.72. Got: ${domain.confidence}`);
});
