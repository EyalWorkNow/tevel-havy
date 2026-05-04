import assert from "node:assert/strict";
import test from "node:test";

import { detectResearchProfile } from "../../services/researchProfiles";

// Test F: Hebrew entity-dense intelligence text — INTEL profile must win
test("detectResearchProfile: Hebrew intelligence text with entity names resolves to INTEL", () => {
  const text = [
    'רועי קדם שימש יועץ של Glass Route Holdings.',
    'Blue Meridian FZE העבירה 380,000 אירו ל-Northbridge Advisory Cyprus.',
    'המחסן בפארק שקד מנוהל על ידי Glass Route Logistics.',
    'נמרוד שחם שלח מודל סיכונים מכתובת פרטית.',
    'הכוונה חיצונית זוהתה דרך ערוץ טלגרם מוצפן.',
  ].join("\n");

  const result = detectResearchProfile(text);
  assert.equal(result.resolvedProfile, "INTEL", `Expected INTEL, got ${result.resolvedProfile} (rationale: ${result.rationale})`);
});

// Test: Hebrew intelligence report header strongly signals INTEL
test("detectResearchProfile: Classification and TSIYACH markers resolve to INTEL", () => {
  const text = 'סיווג: סודי ביותר. דו"ח מודיעין. צי"ח דחוף. מאת: שב"כ. יחידה 8200 זיהתה תעבורה מוצפנת. תצפית איתרה דירת מסתור ומחסן.';

  const result = detectResearchProfile(text);
  assert.equal(result.resolvedProfile, "INTEL", `Expected INTEL, got ${result.resolvedProfile}`);
  assert.ok(result.confidence >= 0.5, `Expected confidence >= 0.5, got ${result.confidence}`);
});

// Test: Hebrew procurement text resolves to INTEL (not FINANCE)
test("detectResearchProfile: Hebrew procurement investigation resolves to INTEL (not FINANCE)", () => {
  const text = 'מכרז קו ענבר. ועדת מכרזים. דליפת מסמכי ועדה. שינוי משקלים. זרימות כספיות דרך חברת קש. עיכוב יבוא. נהנה סופי.';

  const result = detectResearchProfile(text);
  assert.notEqual(result.resolvedProfile, "FINANCE", `Expected not FINANCE, got ${result.resolvedProfile}`);
});

// Test: Genuine SEC document resolves to FINANCE
test("detectResearchProfile: Genuine SEC FORM 10-K text resolves to FINANCE", () => {
  const text = [
    "UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 10-K.",
    "Management's Discussion and Analysis. Consolidated Balance Sheets.",
    "Revenue was USD 120 million. EBITDA was USD 18 million.",
    "GAAP. Fiscal year 2025. Annual filing.",
  ].join(" ");

  const result = detectResearchProfile(text);
  assert.equal(result.resolvedProfile, "FINANCE", `Expected FINANCE, got ${result.resolvedProfile}`);
});

// Test: INTEL signals overpower isolated money amounts
test("detectResearchProfile: INTEL signals overpower money amounts in investigative context", () => {
  const text = [
    'צי"ח דחוף. שב"כ. 8200. מפעיל חיצוני.',
    'מסר יורט. תמליל. איכון. קמ"ן.',
    'העביר 380,000 אירו דרך חשבון בקפריסין.',
    'תשלום 220,000 ש"ח דרך ארנק USDT.',
  ].join("\n");

  const result = detectResearchProfile(text);
  assert.equal(result.resolvedProfile, "INTEL", `Expected INTEL to win over FINANCE, got ${result.resolvedProfile}`);
});
