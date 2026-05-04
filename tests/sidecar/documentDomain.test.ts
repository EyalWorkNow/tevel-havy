import assert from "node:assert/strict";
import test from "node:test";

import { detectDocumentDomain, isIntelligenceCompatibleDomain } from "../../services/documentDomain";

// Test A: Hebrew intelligence classification — must NOT be financial_regulatory
test("detectDocumentDomain: Hebrew intelligence report is classified as intelligence_investigative, not financial_regulatory", () => {
  const text = 'סיווג: סודי ביותר. דו"ח מודיעין. צי"ח דחוף. מאת: שב"כ. יחידה 8200 זיהתה תעבורה מוצפנת. תצפית איתרה דירת מסתור ומחסן.';
  const result = detectDocumentDomain(text);

  assert.notEqual(result.domain, "financial_regulatory", `Expected not financial_regulatory, got: ${result.domain} (rationale: ${result.rationale})`);
  assert.ok(
    isIntelligenceCompatibleDomain(result.domain),
    `Expected intelligence-compatible domain, got: ${result.domain}`,
  );
  assert.ok(result.confidence >= 0.45, `Expected confidence >= 0.45, got: ${result.confidence}`);
  assert.ok(result.signals.length > 0, "Expected at least one signal");
});

// Test B: Hebrew procurement investigation — not financial_regulatory
test("detectDocumentDomain: Hebrew procurement investigation is NOT financial_regulatory", () => {
  const text = 'מכרז קו ענבר. ועדת מכרזים. דליפת מסמכי ועדה. שינוי משקלים. זרימות כספיות דרך חברת קש. עיכוב יבוא. מחסן לוגיסטי.';
  const result = detectDocumentDomain(text);

  assert.notEqual(result.domain, "financial_regulatory", `Expected not financial_regulatory, got: ${result.domain}`);
  assert.ok(
    result.domain === "procurement_investigation" || result.domain === "intelligence_investigative" || result.domain === "unknown",
    `Expected procurement/intelligence domain, got: ${result.domain}`,
  );
});

// Test C: Real SEC document IS classified as financial_regulatory
test("detectDocumentDomain: Real SEC FORM 10-K is classified as financial_regulatory", () => {
  const text = [
    "UNITED STATES SECURITIES AND EXCHANGE COMMISSION",
    "FORM 10-K",
    "Management's Discussion and Analysis",
    "Consolidated Balance Sheets",
    "GAAP",
  ].join("\n");
  const result = detectDocumentDomain(text);

  assert.equal(result.domain, "financial_regulatory", `Expected financial_regulatory, got: ${result.domain}`);
  assert.ok(result.confidence >= 0.72, `Expected confidence >= 0.72, got: ${result.confidence}`);
});

// Test: Money amounts alone do NOT classify as financial_regulatory
test("detectDocumentDomain: Money amounts alone do not make a document financial_regulatory", () => {
  const text = "העביר 380,000 אירו דרך חשבון בקפריסין. תשלום 220,000 ש\"ח דרך ארנק USDT. ארגון קש קיבל $1.2 million.";
  const result = detectDocumentDomain(text);

  assert.notEqual(result.domain, "financial_regulatory", `Expected not financial_regulatory, got: ${result.domain}`);
});

// Test: Lone "SEC" word does not classify as financial_regulatory
test("detectDocumentDomain: Lone 'SEC' word does not classify as financial_regulatory", () => {
  const text = "The SEC may investigate this matter. No other SEC-specific content here.";
  const result = detectDocumentDomain(text);

  assert.notEqual(result.domain, "financial_regulatory", `Expected not financial_regulatory — lone 'SEC' word should not trigger, got: ${result.domain}`);
});

// Test: Operational report signals
test("detectDocumentDomain: Operational report with Hebrew signals", () => {
  const text = 'דו"ח תצפית. כוח מבצע בשטח. חסימה בשעת שין. מעצר ב-05:40. המלצה אופרטיבית: Go/No-Go. יחידה 9900 אימתה תמליל.';
  const result = detectDocumentDomain(text);

  assert.notEqual(result.domain, "financial_regulatory", `Expected not financial_regulatory, got: ${result.domain}`);
  assert.ok(
    isIntelligenceCompatibleDomain(result.domain),
    `Expected intelligence-compatible domain, got: ${result.domain}`,
  );
});

// Test: isIntelligenceCompatibleDomain covers the right domains
test("isIntelligenceCompatibleDomain: correct domain coverage", () => {
  assert.ok(isIntelligenceCompatibleDomain("intelligence_investigative"));
  assert.ok(isIntelligenceCompatibleDomain("procurement_investigation"));
  assert.ok(isIntelligenceCompatibleDomain("operational_report"));
  assert.ok(isIntelligenceCompatibleDomain("unknown"));
  assert.ok(isIntelligenceCompatibleDomain("generic_document"));
  assert.ok(!isIntelligenceCompatibleDomain("financial_regulatory"));
  assert.ok(!isIntelligenceCompatibleDomain("legal_contractual"));
});
