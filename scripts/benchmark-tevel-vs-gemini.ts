import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildFcfR3ReadPath } from "../services/fcfR3Service";
import { askLiveResearchQuestion, buildLiveResearchCorpus } from "../services/liveResearchService";
import type { IntelligencePackage, Relation, Statement, StudyItem } from "../types";

type BenchmarkMode = "gemini_with_fcf" | "gemini_without_fcf" | "tevel_architecture";

type TokenUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

type BenchmarkResult = {
  runId: string;
  mode: BenchmarkMode;
  iteration: number;
  query: string;
  startedAt: string;
  durationMs: number;
  success: boolean;
  skipped: boolean;
  error?: string;
  answer: string;
  tokens?: TokenUsage | null;
  technical: Record<string, unknown>;
  quality: QualityAssessment;
};

type QualityAssessment = {
  score: number;
  maxScore: number;
  directCommandOrControl: boolean;
  directCommunication: boolean;
  financeDirectness: boolean;
  tikaCaution: boolean;
  sadatAsEei: boolean;
  citationsOrEvidenceIds: boolean;
  bottomLine: boolean;
  notes: string[];
};

type BenchmarkSummary = {
  mode: BenchmarkMode;
  runs: number;
  successes: number;
  skipped: number;
  successRate: number;
  avgDurationMs: number;
  avgPromptTokens: number | null;
  avgTotalTokens: number | null;
  avgQualityScore: number;
  maxQualityScore: number;
};

const BENCHMARK_QUERY =
  "Find all entity-contexts for Turkey in this corpus. Cover command/control, explicit Turkish agencies, Hamas-Turkey communications, finance, technology/equipment, logistics, proxy geography, human operators, communications, doctrine/tactics, TIKA indicators, SADAT/EEI, and limiting or alternative-actor evidence. Start with synthesis, cite evidence IDs, distinguish confirmed facts from indirect indicators and hypotheses, and state what it means.";

const RUNS_PER_MODE = Number.parseInt(process.env.BENCHMARK_RUNS || "3", 10);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const OUTPUT_DIR = path.join(process.cwd(), "benchmark_results");

const escapeCsv = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const nowIso = (): string => new Date().toISOString();

const uniq = <T,>(items: T[]): T[] => Array.from(new Set(items));

const makePackage = (
  idPrefix: string,
  title: string,
  cleanText: string,
  statements: Statement[],
  relations: Relation[],
): IntelligencePackage => {
  const entities = uniq(
    [
      "Turkey",
      "MIT",
      "Ankara",
      "Istanbul",
      "Hamas external liaison",
      "TIKA",
      "SADAT",
      "Qatar Charity",
      "crypto wallet TR-884",
      "Baykar",
      "Gaza logistics cell",
    ],
  ).map((name, index) => ({
    id: `${idPrefix}-ent-${index + 1}`,
    name,
    type: /Ankara|Istanbul|Turkey/.test(name) ? "LOCATION" : /wallet/i.test(name) ? "FINANCIAL_ACCOUNT" : "ORGANIZATION",
    aliases: name === "Turkey" ? ["Turkish", "Türkiye", "Turkiye", "טורקיה", "תורכיה"] : [],
    confidence: 0.9,
  }));

  return {
    clean_text: cleanText,
    raw_text: cleanText,
    word_count: cleanText.split(/\s+/).filter(Boolean).length,
    document_metadata: {
      document_id: idPrefix,
      title,
      classification: "BENCHMARK_FIXTURE",
      author: "TEVEL benchmark harness",
      source_orgs: "local synthetic corpus",
      language: "en",
    },
    statements,
    intel_questions: statements
      .filter((statement) => statement.intelligence_gap)
      .map((statement, index) => ({
        question_id: `${idPrefix}-eei-${index + 1}`,
        statement_id: statement.statement_id,
        question_text: statement.statement_text,
        priority: statement.impact,
        owner: "benchmark",
      })),
    intel_tasks: [],
    entities,
    relations,
    insights: statements.map((statement) => ({
      type: statement.intelligence_gap ? "anomaly" : "summary",
      importance: statement.impact === "CRITICAL" ? 95 : statement.impact === "HIGH" ? 80 : 60,
      text: statement.statement_text,
    })),
    timeline: [],
    tactical_assessment: {
      ttps: ["external command liaison", "compartmented finance", "dual-use logistics"],
      recommendations: ["Separate direct evidence from indirect indicators before synthesis."],
      gaps: ["Verify SADAT only if independent source spans confirm involvement."],
    },
    context_cards: {},
    graph: { nodes: [], edges: [] },
    reliability: 0.86,
  };
};

const statement = (
  id: string,
  text: string,
  category: Statement["category"],
  confidence: number,
  impact: Statement["impact"],
  intelligenceGap = false,
): Statement => ({
  statement_id: id,
  statement_text: text,
  knowledge: intelligenceGap ? "HYPOTHESIS" : "FACT",
  category,
  confidence,
  assumption_flag: intelligenceGap,
  intelligence_gap: intelligenceGap,
  impact,
  operational_relevance: impact === "CRITICAL" ? "IMMEDIATE" : impact === "HIGH" ? "HIGH" : "MEDIUM",
});

const BENCHMARK_STUDIES: StudyItem[] = [
  {
    id: "bench-command",
    title: "Turkey command and communications notes",
    date: "2026-04-01T08:00:00.000Z",
    source: "Report",
    status: "Approved",
    tags: ["Turkey", "MIT", "Hamas", "command"],
    intelligence: makePackage(
      "bench-command",
      "Turkey command and communications notes",
      [
        "[E-CMD-001] The document states that a MIT handler in Ankara approved the Istanbul meeting agenda for the Hamas external liaison and asked for a revised operational timetable.",
        "[E-COMM-001] A Hamas external liaison sent a direct Telegram update to a Turkish contact after the Istanbul meeting, summarizing the requested changes.",
        "[E-LIMIT-001] The same note says weapons procurement was not conducted by the Turkish contact; a separate Hebron broker handled that channel.",
      ].join("\n"),
      [
        statement(
          "E-CMD-001",
          "MIT handler in Ankara approved the Istanbul meeting agenda for the Hamas external liaison.",
          "STRATEGIC",
          0.93,
          "CRITICAL",
        ),
        statement(
          "E-COMM-001",
          "Hamas external liaison sent a direct Telegram update to a Turkish contact after the Istanbul meeting.",
          "TACTICAL",
          0.9,
          "HIGH",
        ),
        statement(
          "E-LIMIT-001",
          "Weapons procurement was not conducted by the Turkish contact; a separate Hebron broker handled that channel.",
          "COLLECTION",
          0.86,
          "MEDIUM",
        ),
      ],
      [
        { source: "MIT", target: "Hamas external liaison", type: "COMMUNICATED_WITH", confidence: 0.92, statement_id: "E-CMD-001" },
        { source: "Turkey", target: "Istanbul", type: "ASSOCIATED_WITH", confidence: 0.88, statement_id: "E-COMM-001" },
      ],
    ),
  },
  {
    id: "bench-finance",
    title: "Turkey-linked finance and crypto channel",
    date: "2026-04-02T09:30:00.000Z",
    source: "Signal",
    status: "Approved",
    tags: ["Turkey", "finance", "crypto"],
    intelligence: makePackage(
      "bench-finance",
      "Turkey-linked finance and crypto channel",
      [
        "[E-FIN-001] A direct transaction record links crypto wallet TR-884, registered to a Turkish operator, with two transfers to the Gaza logistics cell.",
        "[E-FIN-002] The finance annex says the wallet owner used an Istanbul exchange desk before the transfers.",
      ].join("\n"),
      [
        statement(
          "E-FIN-001",
          "Direct transaction record links crypto wallet TR-884, registered to a Turkish operator, with two transfers to the Gaza logistics cell.",
          "FINANCIAL",
          0.91,
          "HIGH",
        ),
        statement(
          "E-FIN-002",
          "The wallet owner used an Istanbul exchange desk before the transfers.",
          "FINANCIAL",
          0.82,
          "MEDIUM",
        ),
      ],
      [
        { source: "crypto wallet TR-884", target: "Gaza logistics cell", type: "FUNDED_BY", confidence: 0.88, statement_id: "E-FIN-001" },
        { source: "Turkey", target: "crypto wallet TR-884", type: "ASSOCIATED_WITH", confidence: 0.86, statement_id: "E-FIN-001" },
      ],
    ),
  },
  {
    id: "bench-logistics",
    title: "Technology, logistics, and TIKA indicators",
    date: "2026-04-03T12:15:00.000Z",
    source: "News",
    status: "Approved",
    tags: ["Turkey", "TIKA", "technology", "logistics"],
    intelligence: makePackage(
      "bench-logistics",
      "Technology, logistics, and TIKA indicators",
      [
        "[E-TECH-001] A procurement list mentions Turkish-made Baykar drone batteries and RF modules routed through a civilian equipment vendor.",
        "[E-TIKA-001] Photos from a foreign-funded farm compound show a TIKA logo near storage sheds later used by the Gaza logistics cell; the source does not prove TIKA financed or controlled the site.",
        "[E-GEO-001] The logistics map connects Istanbul, northern Sinai, and Gaza as proxy geography for non-military cargo movement.",
      ].join("\n"),
      [
        statement(
          "E-TECH-001",
          "Procurement list mentions Turkish-made Baykar drone batteries and RF modules routed through a civilian equipment vendor.",
          "LOGISTICAL",
          0.84,
          "HIGH",
        ),
        statement(
          "E-TIKA-001",
          "Photos from a foreign-funded farm compound show a TIKA logo near storage sheds later used by the Gaza logistics cell; the source does not prove TIKA financed or controlled the site.",
          "LOGISTICAL",
          0.64,
          "MEDIUM",
        ),
        statement(
          "E-GEO-001",
          "The logistics map connects Istanbul, northern Sinai, and Gaza as proxy geography for non-military cargo movement.",
          "LOGISTICAL",
          0.78,
          "MEDIUM",
        ),
      ],
      [
        { source: "Baykar", target: "Gaza logistics cell", type: "USED_IN", confidence: 0.82, statement_id: "E-TECH-001" },
        { source: "TIKA", target: "Gaza logistics cell", type: "ASSOCIATED_WITH", confidence: 0.58, statement_id: "E-TIKA-001" },
      ],
    ),
  },
  {
    id: "bench-eei",
    title: "SADAT and doctrine EEI register",
    date: "2026-04-04T16:00:00.000Z",
    source: "Report",
    status: "Approved",
    tags: ["Turkey", "SADAT", "EEI", "doctrine"],
    intelligence: makePackage(
      "bench-eei",
      "SADAT and doctrine EEI register",
      [
        "[E-EEI-001] EEI: Determine whether SADAT personnel provided doctrine or training support to the Gaza logistics cell; no direct source span confirms this involvement.",
        "[E-DOC-001] A tactics memo describes compartmented courier doctrine copied from a Turkish-language manual, but it does not identify the authoring organization.",
      ].join("\n"),
      [
        statement(
          "E-EEI-001",
          "EEI: Determine whether SADAT personnel provided doctrine or training support to the Gaza logistics cell; no direct source span confirms this involvement.",
          "COLLECTION",
          0.52,
          "HIGH",
          true,
        ),
        statement(
          "E-DOC-001",
          "A tactics memo describes compartmented courier doctrine copied from a Turkish-language manual, but it does not identify the authoring organization.",
          "TACTICAL",
          0.66,
          "MEDIUM",
        ),
      ],
      [
        { source: "SADAT", target: "Gaza logistics cell", type: "ASSOCIATED_WITH", confidence: 0.45, statement_id: "E-EEI-001" },
      ],
    ),
  },
];

const buildRawContext = (studies: StudyItem[]): string =>
  studies
    .map((study) => {
      const statements = (study.intelligence.statements || [])
        .map((entry) => `- ${entry.statement_id}: ${entry.statement_text}`)
        .join("\n");
      return `SOURCE ${study.id}: ${study.title}\n${study.intelligence.clean_text}\nSTRUCTURED STATEMENTS:\n${statements}`;
    })
    .join("\n\n");

const callGemini = async (prompt: string, systemInstruction: string): Promise<{ answer: string; tokens: TokenUsage | null; metadata: Record<string, unknown> }> => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY. Set it to run Gemini benchmark modes.");
  }

  const controller = new AbortController();
  const timeoutMs = Number.parseInt(process.env.BENCHMARK_GEMINI_TIMEOUT_MS || "60000", 10);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const urls = [
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
  ];

  try {
    let lastError: Error | undefined;
    for (const url of urls) {
      try {
        const isV1Beta = url.includes("/v1beta/");
        const requestPrompt = isV1Beta ? prompt : `${systemInstruction}\n\n${prompt}`;
        const body: Record<string, unknown> = {
          contents: [{ role: "user", parts: [{ text: requestPrompt }] }],
          generationConfig: {
            temperature: 0.2,
            topP: 0.9,
            maxOutputTokens: 4096,
          },
        };
        if (isV1Beta) {
          body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(`Gemini HTTP ${response.status}: ${JSON.stringify(data).slice(0, 600)}`);
        }
        const answer = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("\n").trim();
        return {
          answer: answer || "",
          tokens: data.usageMetadata || null,
          metadata: {
            model: GEMINI_MODEL,
            endpoint: url.includes("/v1beta/") ? "v1beta" : "v1",
            finishReason: data.candidates?.[0]?.finishReason,
            safetyRatings: data.candidates?.[0]?.safetyRatings || [],
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError || new Error("Gemini request failed without a response.");
  } finally {
    clearTimeout(timeout);
  }
};

const assessQuality = (answer: string): QualityAssessment => {
  const lower = answer.toLowerCase();
  const hasEvidenceId = /\[(?:e-[a-z]+-\d+|fcf_[a-z0-9_]+)\]/i.test(answer) || /evidence id/i.test(lower);
  const directCommand = /mit|ankara|command|control|approved|handler|פיקוד|שליטה/.test(lower);
  const directCommunication = /telegram|communication|liaison|contact|תקשורת|קשר/.test(lower);
  const finance = /tr-884|crypto|transaction|transfer|finance|wallet|מימון|העברה/.test(lower);
  const tika = /tika/.test(lower) && /(indirect|indicator|does not prove|possible|אינדיקציה|אפשר|לא מוכיח)/.test(lower);
  const sadat = /sadat/.test(lower) && /(eei|hypothesis|verify|not confirm|gap|בירור|אימות|השערה)/.test(lower);
  const bottomLine = /bottom line|assessment|meaning|means|מסקנה|שורה תחתונה|משמעות/.test(lower);
  const notes: string[] = [];

  if (!hasEvidenceId) notes.push("No visible evidence IDs/citations were detected.");
  if (!directCommand) notes.push("Direct command/control context was not clearly covered.");
  if (!directCommunication) notes.push("Direct Hamas-Turkey communication context was not clearly covered.");
  if (!finance) notes.push("Finance/crypto context was not clearly covered.");
  if (!tika) notes.push("TIKA/logo indicator was not phrased cautiously.");
  if (!sadat) notes.push("SADAT/EEI was not clearly separated as a hypothesis or validation gap.");
  if (!bottomLine) notes.push("No explicit bottom-line or meaning assessment was detected.");

  const checks = [hasEvidenceId, directCommand, directCommunication, finance, tika, sadat, bottomLine];
  return {
    score: checks.filter(Boolean).length,
    maxScore: checks.length,
    directCommandOrControl: directCommand,
    directCommunication,
    financeDirectness: finance,
    tikaCaution: tika,
    sadatAsEei: sadat,
    citationsOrEvidenceIds: hasEvidenceId,
    bottomLine,
    notes,
  };
};

const runOne = async (mode: BenchmarkMode, iteration: number): Promise<BenchmarkResult> => {
  const startedAt = nowIso();
  const start = performance.now();
  const runId = `${mode}-${iteration}-${Date.now()}`;

  try {
    if (mode === "gemini_without_fcf") {
      const answer = await callGemini(
        `QUERY:\n${BENCHMARK_QUERY}\n\nRAW CORPUS:\n${buildRawContext(BENCHMARK_STUDIES)}`,
        "You are an intelligence analyst. Answer only from the provided corpus. Do not invent facts. Cite evidence IDs when present.",
      );
      const durationMs = Math.round(performance.now() - start);
      return {
        runId,
        mode,
        iteration,
        query: BENCHMARK_QUERY,
        startedAt,
        durationMs,
        success: Boolean(answer.answer),
        skipped: false,
        answer: answer.answer,
        tokens: answer.tokens,
        technical: { ...answer.metadata, contextMode: "raw_context_dump", studies: BENCHMARK_STUDIES.length },
        quality: assessQuality(answer.answer),
      };
    }

    if (mode === "gemini_with_fcf") {
      const corpus = buildLiveResearchCorpus(BENCHMARK_QUERY, BENCHMARK_STUDIES);
      const fcfRun = buildFcfR3ReadPath(BENCHMARK_QUERY, corpus.package, {
        maxContextChars: 5200,
        maxEvidenceItems: 12,
        maxSnippetChars: 180,
      });
      const fcfSummary = [
        `status=${fcfRun.audit.answer_status}`,
        `selected=${fcfRun.audit.selected_count}/${fcfRun.audit.candidate_count}`,
        `clusters=${fcfRun.audit.cluster_count || 0}`,
        fcfRun.audit.found_context_types?.length ? `coverage=${fcfRun.audit.found_context_types.join(",")}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      const answer = await callGemini(
        `QUERY:\n${BENCHMARK_QUERY}\n\n${fcfRun.materialized_context}\n\nFCF SUMMARY: ${fcfSummary}`,
        [
          "You are TEVEL's FCF-aware analytical generator.",
          "Start with executive synthesis, then evidence clusters, interpretation, confidence, citations, and bottom-line assessment.",
          "Do not present hypotheses or EEI as confirmed facts. Prefer source spans over relation labels.",
        ].join(" "),
      );
      const durationMs = Math.round(performance.now() - start);
      return {
        runId,
        mode,
        iteration,
        query: BENCHMARK_QUERY,
        startedAt,
        durationMs,
        success: Boolean(answer.answer),
        skipped: false,
        answer: answer.answer,
        tokens: answer.tokens,
        technical: {
          ...answer.metadata,
          contextMode: "fcf_r3_materialized_context",
          selectedEvidence: fcfRun.audit.selected_count,
          candidateEvidence: fcfRun.audit.candidate_count,
          coverageChecklist: fcfRun.audit.coverage_checklist,
          warnings: fcfRun.audit.warnings,
        },
        quality: assessQuality(answer.answer),
      };
    }

    const tevelAnswer = await askLiveResearchQuestion(BENCHMARK_QUERY, BENCHMARK_STUDIES, [], undefined, {
      reasoningEngineId: "gemini-cloud",
      geminiApiKey: process.env.GEMINI_API_KEY,
    });
    const durationMs = Math.round(performance.now() - start);
    return {
      runId,
      mode,
      iteration,
      query: BENCHMARK_QUERY,
      startedAt,
      durationMs,
      success: Boolean(tevelAnswer.answer),
      skipped: false,
      answer: tevelAnswer.answer,
      tokens: null,
      technical: {
        contextMode: "askLiveResearchQuestion",
        citationGuard: tevelAnswer.citationGuard,
        verificationNote: tevelAnswer.verificationNote,
        warnings: tevelAnswer.warnings,
        scope: tevelAnswer.scope,
        engineTrace: tevelAnswer.engineTrace,
        fcfAudit: tevelAnswer.fcfAudit,
      },
      quality: assessQuality(tevelAnswer.answer),
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);
    const message = error instanceof Error ? error.message : String(error);
    return {
      runId,
      mode,
      iteration,
      query: BENCHMARK_QUERY,
      startedAt,
      durationMs,
      success: false,
      skipped: /GEMINI_API_KEY/.test(message),
      error: message,
      answer: "",
      tokens: null,
      technical: {
        model: mode === "tevel_architecture" ? `TEVEL via ${GEMINI_MODEL}` : GEMINI_MODEL,
        apiKeyPresent: Boolean(process.env.GEMINI_API_KEY?.trim()),
      },
      quality: assessQuality(""),
    };
  }
};

const averageTokenCount = (rows: BenchmarkResult[], selector: (tokens: TokenUsage) => number | undefined): number | null => {
  const values = rows
    .map((row) => (row.tokens ? selector(row.tokens) : undefined))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const summarize = (results: BenchmarkResult[]): BenchmarkSummary[] => {
  const modes = uniq(results.map((result) => result.mode));
  return modes.map((mode) => {
    const rows = results.filter((result) => result.mode === mode);
    const completedRows = rows.filter((result) => !result.skipped);
    const successfulRows = rows.filter((result) => result.success);
    const avgDuration = completedRows.length
      ? Math.round(completedRows.reduce((sum, result) => sum + result.durationMs, 0) / completedRows.length)
      : 0;
    const avgQuality = successfulRows.length
      ? Number((successfulRows.reduce((sum, result) => sum + result.quality.score, 0) / successfulRows.length).toFixed(2))
      : 0;
    return {
      mode,
      runs: rows.length,
      successes: successfulRows.length,
      skipped: rows.filter((result) => result.skipped).length,
      successRate: Number((successfulRows.length / rows.length).toFixed(3)),
      avgDurationMs: avgDuration,
      avgPromptTokens: averageTokenCount(successfulRows, (tokens) => tokens.promptTokenCount),
      avgTotalTokens: averageTokenCount(successfulRows, (tokens) => tokens.totalTokenCount),
      avgQualityScore: avgQuality,
      maxQualityScore: rows[0]?.quality.maxScore || 7,
    };
  });
};

const buildCsv = (results: BenchmarkResult[]): string => {
  const header = [
    "mode",
    "iteration",
    "success",
    "skipped",
    "duration_ms",
    "quality_score",
    "quality_max",
    "prompt_tokens",
    "candidate_tokens",
    "total_tokens",
    "error",
  ];
  const rows = results.map((result) => [
    result.mode,
    result.iteration,
    result.success,
    result.skipped,
    result.durationMs,
    result.quality.score,
    result.quality.maxScore,
    result.tokens?.promptTokenCount ?? "",
    result.tokens?.candidatesTokenCount ?? "",
    result.tokens?.totalTokenCount ?? "",
    result.error || "",
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
};

const modeDescription = (mode: BenchmarkMode): string => {
  if (mode === "gemini_with_fcf") {
    return "Gemini receives the FCF-R3 materialized read path, selected evidence audit, and analytical generation instructions.";
  }
  if (mode === "gemini_without_fcf") {
    return "Gemini receives the same corpus as a direct raw-context dump, without FCF retrieval, clustering, evidence typing, or audit metadata.";
  }
  return "TEVEL runs askLiveResearchQuestion end-to-end: study scoping, FCF-R3 read path, model call, citation verification, and deterministic fallback when the model path fails.";
};

const buildReport = (results: BenchmarkResult[]): string => {
  const summaries = summarize(results);
  const apiKeyPresent = Boolean(process.env.GEMINI_API_KEY?.trim());
  const summaryRows = summaries
    .map(
      (entry) =>
        `| ${entry.mode} | ${entry.runs} | ${entry.successes} | ${entry.skipped} | ${Math.round(entry.successRate * 100)}% | ${entry.avgDurationMs} | ${entry.avgPromptTokens ?? "n/a"} | ${entry.avgTotalTokens ?? "n/a"} | ${entry.avgQualityScore}/${entry.maxQualityScore} |`,
    )
    .join("\n");
  const resultRows = results
    .map(
      (result) =>
        `| ${result.mode} | ${result.iteration} | ${result.success ? "yes" : "no"} | ${result.skipped ? "yes" : "no"} | ${result.durationMs} | ${result.quality.score}/${result.quality.maxScore} | ${result.error ? result.error.replace(/\|/g, "/").slice(0, 140) : ""} |`,
    )
    .join("\n");
  const qualityRows = summaries
    .map((summary) => {
      const best = results
        .filter((result) => result.mode === summary.mode)
        .sort((a, b) => b.quality.score - a.quality.score || a.durationMs - b.durationMs)[0];
      return `### ${summary.mode}\n- Mode: ${modeDescription(summary.mode)}\n- Best quality score: ${best?.quality.score || 0}/${best?.quality.maxScore || 7}\n- Main gaps: ${best?.quality.notes.length ? best.quality.notes.join(" ") : "No heuristic gaps detected."}\n- Representative answer excerpt:\n\n> ${(best?.answer || "No answer generated.").replace(/\s+/g, " ").slice(0, 700)}${(best?.answer || "").length > 700 ? "..." : ""}`;
    })
    .join("\n\n");
  const failures = results
    .filter((result) => !result.success || result.error || result.technical.warnings)
    .map((result) => `- ${result.mode} run ${result.iteration}: ${result.error || JSON.stringify(result.technical.warnings || []).slice(0, 300)}`)
    .join("\n");
  const recommendation = (() => {
    const missingGeminiKey = results.some((result) => result.skipped && /GEMINI_API_KEY/.test(result.error || ""));
    if (missingGeminiKey) {
      return "The full cloud comparison is incomplete because GEMINI_API_KEY is not configured. TEVEL deterministic fallback completed and produced usable benchmark output, but Gemini-with-FCF and Gemini-without-FCF must be rerun with a key before making a final engine recommendation.";
    }
    const successful = summaries.filter((entry) => entry.successes > 0);
    if (successful.length === 0) {
      return "No live Gemini comparison could complete. Configure GEMINI_API_KEY and rerun before choosing an engine; TEVEL deterministic fallback remains the only locally observed path.";
    }
    const ranked = [...successful].sort(
      (a, b) =>
        b.avgQualityScore - a.avgQualityScore ||
        (a.avgPromptTokens ?? Number.MAX_SAFE_INTEGER) - (b.avgPromptTokens ?? Number.MAX_SAFE_INTEGER) ||
        a.avgDurationMs - b.avgDurationMs,
    );
    return `Recommended mode: ${ranked[0].mode}. It produced the strongest observed quality/token tradeoff in this run; review raw_results.json for full-answer inspection before treating the result as statistically stable.`;
  })();

  return `# TEVEL FCF/Gemini Benchmark Report

Generated: ${nowIso()}

## Query Tested

${BENCHMARK_QUERY}

## Execution

- Command: \`npm run bench:tevel-gemini\`
- Runs per mode: ${RUNS_PER_MODE}
- Gemini model: ${GEMINI_MODEL}
- GEMINI_API_KEY present: ${apiKeyPresent ? "yes" : "no"}
- Corpus: local repeatable benchmark fixture with command/control, communications, finance, technology/logistics, TIKA indirect indicator, SADAT EEI, proxy geography, and limiting evidence.

## Modes

- \`gemini_with_fcf\`: ${modeDescription("gemini_with_fcf")}
- \`gemini_without_fcf\`: ${modeDescription("gemini_without_fcf")}
- \`tevel_architecture\`: ${modeDescription("tevel_architecture")}

## Summary

| Mode | Runs | Successes | Skipped | Success Rate | Avg Duration ms | Avg Prompt Tokens | Avg Total Tokens | Avg Quality |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${summaryRows}

## Per-Run Results

| Mode | Iteration | Success | Skipped | Duration ms | Quality | Error |
| --- | ---: | --- | --- | ---: | ---: | --- |
${resultRows}

## Quality Comparison

The quality score is a deterministic inspection heuristic for this fixture. It checks whether the answer covers direct command/control, direct communication, finance, cautious TIKA wording, SADAT as EEI/hypothesis, citations/evidence IDs, and bottom-line meaning.

${qualityRows}

## Failures and Warnings

${failures || "No failures or warnings recorded."}

## Conclusions and Recommendation

${recommendation}

## Rerun Instructions

1. Set a Gemini key when cloud modes are required: \`export GEMINI_API_KEY=...\`
2. Optional: set \`GEMINI_MODEL=${GEMINI_MODEL}\` and \`BENCHMARK_RUNS=${RUNS_PER_MODE}\`.
3. Rerun with one command: \`npm run bench:tevel-gemini\`

Full answers, token metadata when available, FCF audit details, TEVEL engine traces, and warnings are stored in \`benchmark_results/raw_results.json\`.
`;
};

const main = async () => {
  if (!Number.isFinite(RUNS_PER_MODE) || RUNS_PER_MODE < 1) {
    throw new Error("BENCHMARK_RUNS must be a positive integer.");
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const modes: BenchmarkMode[] = ["gemini_with_fcf", "gemini_without_fcf", "tevel_architecture"];
  const results: BenchmarkResult[] = [];

  for (const mode of modes) {
    for (let iteration = 1; iteration <= RUNS_PER_MODE; iteration += 1) {
      console.log(`Running ${mode} iteration ${iteration}/${RUNS_PER_MODE}...`);
      results.push(await runOne(mode, iteration));
    }
  }

  const rawPayload = {
    generatedAt: nowIso(),
    query: BENCHMARK_QUERY,
    runsPerMode: RUNS_PER_MODE,
    model: GEMINI_MODEL,
    apiKeyPresent: Boolean(process.env.GEMINI_API_KEY?.trim()),
    modes: {
      gemini_with_fcf: modeDescription("gemini_with_fcf"),
      gemini_without_fcf: modeDescription("gemini_without_fcf"),
      tevel_architecture: modeDescription("tevel_architecture"),
    },
    corpus: BENCHMARK_STUDIES,
    summary: summarize(results),
    results,
  };

  await writeFile(path.join(OUTPUT_DIR, "raw_results.json"), JSON.stringify(rawPayload, null, 2));
  await writeFile(path.join(OUTPUT_DIR, "summary.csv"), buildCsv(results));
  await writeFile(path.join(OUTPUT_DIR, "benchmark_report.md"), buildReport(results));

  console.log(`Benchmark complete. Results written to ${OUTPUT_DIR}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
