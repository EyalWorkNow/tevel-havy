import { readFile } from "node:fs/promises";

import type { IntelligencePackage, StudyItem } from "../types";
import { buildLiveResearchCorpus, buildLiveResearchQuestionBenchmark } from "../services/liveResearchService";

type InputDocument = {
  id?: string;
  title: string;
  raw_text: string;
};

const DEFAULT_QUESTION =
  "זו משימת ניתוח פיננסי של מסמכי SEC, לא משימת מודיעין או גרף קשרים. קרא את שלושת המסמכים שהעליתי וענה בעברית פשוטה בלבד, בלי קודי מערכת, בלי מזהי ראיות, בלי FCF, בלי timeline, בלי entity, בלי confidence, ובלי קשרים כמו communicated_with";

const usage = "Usage: npx tsx scripts/benchmark-live-research-sec.ts [input.json] [question]";

const readStdin = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });

const readInput = async (): Promise<{ documents: InputDocument[]; question: string }> => {
  const [, , inputPath, ...questionParts] = process.argv;
  const question = questionParts.join(" ").trim() || DEFAULT_QUESTION;
  const raw = inputPath
    ? await readFile(inputPath, "utf8")
    : await readStdin();
  if (!raw.trim()) {
    throw new Error(`Missing benchmark input. ${usage}`);
  }
  const parsed = JSON.parse(raw);
  const documents = Array.isArray(parsed) ? parsed : parsed.documents;
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error("Benchmark input must be an array or an object with a documents array.");
  }
  return { documents, question };
};

const makePackage = (doc: InputDocument): IntelligencePackage => ({
  clean_text: doc.raw_text.slice(0, 1200),
  raw_text: doc.raw_text,
  word_count: doc.raw_text.split(/\s+/).filter(Boolean).length,
  document_metadata: {
    document_id: doc.id || doc.title,
    title: doc.title,
    classification: "SEC",
    author: "SEC",
    source_orgs: "SEC",
    language: "en",
  },
  research_profile: "FINANCE",
  research_profile_detection: undefined,
  entities: [],
  relations: [],
  insights: [],
  timeline: [],
  statements: [],
  intel_questions: [],
  intel_tasks: [],
  tactical_assessment: {
    ttps: [],
    recommendations: [],
    gaps: [],
  },
  context_cards: {},
  graph: {
    nodes: [],
    edges: [],
  },
  reliability: 0.72,
});

const makeStudy = (doc: InputDocument, index: number): StudyItem => ({
  id: doc.id || `sec-doc-${index + 1}`,
  title: doc.title,
  date: "2026-05-03",
  source: "Report",
  status: "Review",
  tags: ["SEC", "Finance", "Benchmark"],
  intelligence: makePackage(doc),
  super_intelligence: {},
  knowledge_intelligence: {},
});

const summarizeDocumentKind = (text: string): string => {
  if (/\bFORM\s+10-K\b/i.test(text)) return "FORM 10-K";
  if (/\bFORM\s+10-Q\b/i.test(text)) return "FORM 10-Q";
  if (/\bFORM\s+4\b/i.test(text)) return "FORM 4";
  if (/\bFORM\s+8-K\b/i.test(text)) return "FORM 8-K";
  return "SEC document";
};

const main = async () => {
  const { documents, question } = await readInput();
  const studies = documents.map(makeStudy);
  const corpus = buildLiveResearchCorpus(question, studies);
  const benchmark = buildLiveResearchQuestionBenchmark(question, studies, undefined, { reasoningEngineId: "ollama-local" });

  const result = {
    question,
    document_count: documents.length,
    route: benchmark.route,
    selected_records: corpus.sources.map((source) => source.title),
    token_benchmark: benchmark,
    source_documents: documents.map((doc) => ({
      title: doc.title,
      kind: summarizeDocumentKind(doc.raw_text),
      chars: doc.raw_text.length,
      estimated_tokens: Math.ceil(doc.raw_text.length / 4),
      selected: corpus.sources.some((source) => source.title === doc.title),
    })),
  };

  console.log(JSON.stringify(result, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
