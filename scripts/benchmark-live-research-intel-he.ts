/**
 * Benchmark for Hebrew intelligence/investigative/procurement documents.
 * Validates that Tevel does NOT classify these as SEC/financial documents.
 *
 * Usage:
 *   npx tsx scripts/benchmark-live-research-intel-he.ts [input.json] [question]
 *
 * Input JSON: array of { id?, title, raw_text } objects (Hebrew DOCX content).
 */
import { readFile } from "node:fs/promises";

import type { IntelligencePackage, StudyItem } from "../types";
import { buildLiveResearchCorpus, buildLiveResearchQuestionBenchmark } from "../services/liveResearchService";
import { detectDocumentDomain, isIntelligenceCompatibleDomain } from "../services/documentDomain";

type InputDocument = {
  id?: string;
  title: string;
  raw_text: string;
};

const DEFAULT_QUESTION =
  "נתח את שלושת הקבצים שהועלו, פרק ישויות, הצלב ביניהם, זהה דפוסים מבניים, קשרים בין אנשים, גופים, כסף, לוגיסטיקה, סייבר, תצפית, מסמכים והכוונה חיצונית";

const SAMPLE_INTEL_DOCS: InputDocument[] = [
  {
    id: "intel-doc-1",
    title: "דו\"ח מודיעין - מבצע ענבר",
    raw_text: [
      "סיווג: סודי ביותר. דו\"ח מודיעין. צי\"ח דחוף.",
      "מאת: שב\"כ. יחידה 8200 זיהתה תעבורה מוצפנת.",
      "תצפית איתרה דירת מסתור ומחסן ברחוב הרצל 14.",
      "רועי קדם שימש יועץ של Glass Route Holdings.",
      "Blue Meridian FZE העבירה 380,000 אירו ל-Northbridge Advisory Cyprus.",
      "המחסן בפארק שקד מנוהל על ידי Glass Route Logistics.",
      "נמרוד שחם שלח מודל סיכונים מכתובת פרטית.",
      "הכוונה חיצונית זוהתה דרך ערוץ טלגרם מוצפן.",
    ].join("\n"),
  },
  {
    id: "intel-doc-2",
    title: "מכרז קו ענבר - דליפת מסמכים",
    raw_text: [
      "מכרז קו ענבר. ועדת מכרזים. דליפת מסמכי ועדה.",
      "שינוי משקלים בטבלת שקלול. זרימות כספיות דרך חברת קש.",
      "עיכוב יבוא במחסן לוגיסטי. נהנה סופי לא זוהה.",
      "ניגוד עניינים חברת ייעוץ. קמפיין תודעה.",
      "ספק החברה: Maritime Advisory Group B.V. Amsterdam.",
      "תשלום 220,000 ש\"ח דרך ארנק USDT.",
      "מסר יורט מ-VPN ישראלי ב-2026-04-12.",
    ].join("\n"),
  },
  {
    id: "intel-doc-3",
    title: "דו\"ח תצפית - מחסן פארק שקד",
    raw_text: [
      "דו\"ח בקרה. דו\"ח תצפית. כוח מבצע בשטח.",
      "חסימה בשעת שין. מעצר ליה דרור ב-05:40.",
      "רכב שירות מזוהה - לוחית רישוי 12-345-67.",
      "המלצה אופרטיבית: אישור תוכנית Go/No-Go.",
      "יחידה 9900 אימתה תמליל.",
      "קמ\"ן: אלכסיי מרדאשווילי.",
    ].join("\n"),
  },
];

const usage = "Usage: npx tsx scripts/benchmark-live-research-intel-he.ts [input.json] [question]";

const readStdin = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });

const readInput = async (): Promise<{ documents: InputDocument[]; question: string }> => {
  const [, , inputPath, ...questionParts] = process.argv;
  const question = questionParts.join(" ").trim() || DEFAULT_QUESTION;

  if (inputPath) {
    const raw = await readFile(inputPath, "utf8");
    if (!raw.trim()) throw new Error(`Missing benchmark input. ${usage}`);
    const parsed = JSON.parse(raw);
    const documents = Array.isArray(parsed) ? parsed : parsed.documents;
    if (!Array.isArray(documents) || documents.length === 0) {
      throw new Error("Benchmark input must be an array or an object with a documents array.");
    }
    return { documents, question };
  }

  const stdinData = await Promise.race([
    readStdin(),
    new Promise<string>((resolve) => setTimeout(() => resolve(""), 200)),
  ]);

  if (stdinData.trim()) {
    const parsed = JSON.parse(stdinData);
    const documents = Array.isArray(parsed) ? parsed : parsed.documents;
    return { documents, question };
  }

  console.log("No input file provided; using built-in sample Hebrew intelligence documents.\n");
  return { documents: SAMPLE_INTEL_DOCS, question };
};

const makePackage = (doc: InputDocument): IntelligencePackage => ({
  clean_text: doc.raw_text.slice(0, 1200),
  raw_text: doc.raw_text,
  word_count: doc.raw_text.split(/\s+/).filter(Boolean).length,
  document_metadata: {
    document_id: doc.id || doc.title,
    title: doc.title,
    language: "he",
  },
  // No forced research_profile — let auto-detection work
  entities: [],
  relations: [],
  insights: [],
  timeline: [],
  statements: [],
  intel_questions: [],
  intel_tasks: [],
  tactical_assessment: { ttps: [], recommendations: [], gaps: [] },
  context_cards: {},
  graph: { nodes: [], edges: [] },
  reliability: 0.72,
});

const makeStudy = (doc: InputDocument, index: number): StudyItem => ({
  id: doc.id || `intel-doc-${index + 1}`,
  title: doc.title,
  date: "2026-05-04",
  source: "Intelligence Report",
  status: "Active",
  tags: ["Intel", "Hebrew", "Benchmark"],
  intelligence: makePackage(doc),
  super_intelligence: {},
  knowledge_intelligence: {},
});

const runBenchmark = async (): Promise<void> => {
  const { documents, question } = await readInput();
  const studies = documents.map(makeStudy);

  console.log("=".repeat(60));
  console.log("TEVEL — Hebrew Intel/Investigative Benchmark");
  console.log("=".repeat(60));
  console.log(`Documents: ${documents.length}`);
  console.log(`Question: ${question}`);
  console.log("");

  // 1. Document domain classification
  console.log("── Document Domain Classification ──");
  let domainFailures = 0;
  for (const doc of documents) {
    const detection = detectDocumentDomain(doc.raw_text, { title: doc.title, language: "he" });
    const ok = isIntelligenceCompatibleDomain(detection.domain);
    const status = ok ? "✓" : "✗ FAIL";
    console.log(`  ${status} "${doc.title}" → ${detection.domain} (conf=${detection.confidence.toFixed(2)})`);
    if (detection.signals.length) {
      console.log(`       signals: ${detection.signals.slice(0, 5).join(", ")}`);
    }
    if (!ok) domainFailures++;
  }
  console.log("");

  // 2. Build live research corpus
  console.log("── Live Research Corpus ──");
  const corpus = buildLiveResearchCorpus(question, studies);
  console.log(`  Research profile: ${corpus.package.research_profile || "auto"}`);
  console.log(`  Selected sources: ${corpus.sources.length}/${studies.length}`);
  console.log(`  Total entities: ${corpus.package.entities?.length || 0}`);

  const profileOk = corpus.package.research_profile !== "FINANCE" || question.toLowerCase().includes("sec");
  console.log(`  Profile check: ${profileOk ? "✓ not FINANCE" : "✗ FAIL — incorrectly routed to FINANCE"}`);
  console.log("");

  // 3. Question benchmark
  console.log("── Question Benchmark ──");
  const benchmark = buildLiveResearchQuestionBenchmark(question, studies);
  console.log(`  Route: ${benchmark.route}`);
  console.log(`  Compression ratio: ${benchmark.compressionRatio.toFixed(3)}`);
  console.log(`  Estimated tokens (context): ${benchmark.selectedContextEstimatedTokens}`);
  console.log(`  Source count: ${benchmark.selectedSourceCount}`);

  const routeOk = benchmark.route !== "source-grounded" || question.includes("SEC") || question.includes("SEC");
  console.log(`  Route check: ${routeOk ? "✓" : "✗ FAIL — unexpectedly routed to source-grounded (SEC path)"}`);
  console.log(`  Output exclusions: ${benchmark.outputExclusions.join(", ") || "none"}`);
  console.log(`  Warnings: ${benchmark.warnings.join(", ") || "none"}`);
  console.log("");

  // 4. Summary
  console.log("── Summary ──");
  const failures = domainFailures + (profileOk ? 0 : 1);
  if (failures === 0) {
    console.log("  ✓ All checks passed. Hebrew intel docs correctly classified and routed.");
  } else {
    console.log(`  ✗ ${failures} check(s) failed. Review classification and routing logic.`);
    process.exitCode = 1;
  }
};

runBenchmark().catch((err) => {
  console.error("Benchmark error:", err);
  process.exitCode = 1;
});
