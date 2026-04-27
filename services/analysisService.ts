import {
  ContextCard,
  Entity,
  GraphData,
  Insight,
  IntelligencePackage,
  IntelQuestion,
  IntelTask,
  Relation,
  Statement,
  TacticalAssessment,
  TimelineEvent,
} from "../types";
import { EntityCreationEngine } from "./intelligence/entityCreation";
import { runFastExtractionPipeline } from "./sidecar/pipeline";
import {
  SidecarClaimCandidate,
  SidecarEntityRecord,
  SidecarEventCandidate,
  SidecarExtractionPayload,
  SidecarMention,
} from "./sidecar/types";
import { buildTemporalEventRecords, buildTemporalRelations, projectTimelineEvents } from "./sidecar/temporal/projector";
import { buildRetrievalArtifactsFromPayload, buildRetrievalArtifactsFromPayloadWithSemanticSearch } from "./sidecar/retrieval";
import { buildSummaryPanelsFromRetrievalArtifacts } from "./sidecar/summarization/evidencePack";
import { buildResearchDossier, mergeResearchDossierIntoContextCards } from "./researchDossierService";
import {
  analyzeWithLocalSidecar,
  enrichKnowledgeWithSidecar,
  extractPersonsWithSidecar,
  resolvePersonsWithSidecar,
} from "./sidecarClient";
import { CanonicalFtMEntity, KnowledgeEnrichmentResult, ReferenceKnowledgeProfile, WatchlistHit } from "./sidecar/knowledge/contracts";
import { PersonDossier, PersonEntity as SidecarPersonEntity, PersonFact as SidecarPersonFact } from "./sidecar/person/types";
import { buildEntityIntelligenceCase } from "./sidecar/entityIntelligence/service";
import { EntityIntelligenceCaseResult, EntityProfileRecord } from "./sidecar/entityIntelligence/types";

type CandidateRelation = {
  source: string;
  target: string;
  type: string;
  confidence: number;
  sentence: string;
  date?: string;
};

type HeuristicCandidate = {
  name: string;
  type: string;
  role: string;
  confidence: number;
  aliases?: string[];
};

const BLOCKED_ENTITY_KEYS = new Set([
  "admiralty code",
  "metadata start",
  "metadata end",
  "system attachment",
  "extracted text start",
  "extracted text end",
  "external link",
  "biometric target",
  "biometric scan face",
  "biometric scan voice",
]);

const PLACEHOLDER_CONTEXT_PATTERNS = [
  /Relevant passages were found for .* but the local model could not produce a full context card\./i,
  /Unable to generate a full profile/i,
  /Profile Loaded from Super Intelligence\./i,
];

const RELATION_CUES = [
  { terms: ["funded", "financed", "backed", "paid", "מימן", "מימנה"], type: "FUNDED" },
  { terms: ["funded by", "owned by", "belongs to", "reported to", "כפוף ל", "שייך ל", "בבעלות", "בשליטת"], type: "OWNED_BY" },
  { terms: ["emailed", "wrote", "contacted", "forwarded", "copied", "sent", "כתב ל", "שלח ל", "שלח מייל אל", "שלח מייל ל", "פנה אל", "יצר קשר עם", "שוחח עם"], type: "COMMUNICATED_WITH" },
  { terms: ["moved", "transported", "routed", "delivered", "redirected", "coordinated", "הועבר ל", "נשלח ל", "הועבר דרך", "תואם עם", "הוזז ל", "העביר", "העבירה"], type: "MOVED_TO" },
  { terms: ["used", "operated", "activated", "deployed", "הפעיל", "השתמש ב", "הופעל", "נפרס"], type: "USED_IN" },
  { terms: ["linked", "associated", "ties", "tied", "with", "קשור ל", "מקושר ל", "זוהה עם", "לצד"], type: "ASSOCIATED_WITH" },
];

const dateRegexes = [/\b\d{4}-\d{2}-\d{2}\b/g, /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g];
const HEBREW_CHAR_REGEX = /[\u0590-\u05FF]/u;
const ARABIC_CHAR_REGEX = /[\u0600-\u06FF]/u;
const PERSON_TITLE_REGEX = /\b(?:mr|mrs|ms|dr|capt|colonel|commander|director|agent)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/gi;
const HEBREW_PERSON_TITLE_REGEX = /(?:^|[\s([{"'׳״])(?:מר|גב׳|גברת|ד"ר|פרופ(?:׳|')?|רס["״]ן|סרן|רפ["״]ק|רב-כלאי|תא["״]ל|סא["״]ל|אל["״]ם)\s+([א-ת]{1,}(?:[-'״׳][א-ת]{1,})?(?:\s+[א-ת]{1,}(?:[-'״׳][א-ת]{1,})?){0,2})/g;
const ARABIC_PERSON_TITLE_REGEX = /(?:السيد|السيدة|د\.?|دكتور|دكتورة|عميد|عقيد|لواء|رائد|نقيب|مقدم|مدير)\s+[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+){0,2}/gu;
const ENGLISH_PERSON_CONTEXT_REGEX = /\b(?:met|contacted|emailed|called|briefed|interviewed|questioned|reviewed by|signed by|reported by|spoke with|spoke to|asked|told|directed)\s+([A-Z][a-z]+(?:\s+(?:(?:bin|ibn|al|de|del|van|von|ben|abu)\s+)?(?:al-[A-Z][a-z]+|[A-Z][a-z]+(?:-[A-Z]?[a-z]+)?)){1,3})\b/g;
const ENGLISH_PERSON_SUBJECT_ACTION_REGEX = /\b([A-Z][a-z]+(?:\s+(?:(?:bin|ibn|al|de|del|van|von|ben|abu)\s+)?(?:al-[A-Z][a-z]+|[A-Z][a-z]+(?:-[A-Z]?[a-z]+)?)){1,3})\s+(?:met|contacted|emailed|called|briefed|interviewed|questioned|reviewed|signed|reported|spoke|asked|told|directed)\b/g;
const ENGLISH_PERSON_FULLNAME_REGEX = /\b[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?(?:\s+(?:(?:bin|ibn|al|de|del|van|von|ben|abu)\s+)?(?:al-[A-Z][a-z]+|[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)){1,3}\b/g;
const HEBREW_PERSON_CONTEXT_REGEX = /(?:^|[\s([{"'׳״])(?:פגש(?:ה)?(?:\s+(?:עם|את))?|נפגש(?:ה)?\s+עם|שוחח(?:ה)?\s+עם|דיבר(?:ה)?\s+עם|אמר(?:ה)?|כתב(?:ה)?(?:\s+(?:אל|בידי|מאת|על\s+ידי))?|פנה(?:ה)?\s+אל|ביקש(?:ה)?\s+מ|הורה(?:ה)?\s+ל|תחקר(?:ה)?\s+את|ראיין(?:ה)?\s+את)\s+([א-ת]{1,}(?:[-'״׳][א-ת]{1,})?(?:\s+(?:בן|בת|אבו|אל|דה|דל|ואן|פון))?(?:\s+[א-ת]{2,}(?:[-'״׳][א-ת]{1,})?){1,2})/g;
const HEBREW_PERSON_FULLNAME_REGEX = /[א-ת]{1,}(?:[-'״׳][א-ת]{1,})?(?:\s+(?:(?:בן|בת|אבו|אל|דה|דל|ואן|פון)\s+)?[א-ת]{1,}(?:[-'״׳][א-ת]{1,})?){1,3}/g;
const HEBREW_PERSON_ROLE_CONTEXT_REGEX = /(?:^|[\s([{"'׳״])(?:היעד|החלפן|הפעיל|המקור|השליח|ל?איש\s+הקשר(?:\s+הפיננסי)?|האסיר(?:\s+הביטחוני)?|האחיין|ל?אחיינו|ל?אחייניתו|הנחקר|ראש\s+הצוות|ראש\s+היחידה|מפקד(?:ת)?\s+הצוות|סגנו(?:\s+של)?|סגניתו(?:\s+של)?|רס["״]ן|סא["״]ל|אל["״]ם)\s+([א-ת]{1,}(?:[-'״׳][א-ת]{1,})?(?:\s+(?:בן|בת|אבו|אל))?(?:\s+[א-ת]{2,}(?:[-'״׳][א-ת]{1,})?){1,2})/g;
const HEBREW_PERSON_NICKNAME_REGEX = /([א-ת]{1,}(?:[-'״׳][א-ת]{1,})?(?:\s+(?:בן|בת|אבו|אל))?(?:\s+[א-ת]{2,}(?:[-'״׳][א-ת]{1,})?){1,2})\s+\((?:["'׳״][^()"'\n]{2,24}["'׳״])\)/g;
const ARABIC_PERSON_CONTEXT_REGEX = /(?:اجتمع|التقى|تحدث|اتصل|كتب|قال|طلب|أبلغ|وجّه)\s+(?:مع\s+)?([\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?(?:\s+(?:بن|ابن|بنت|أبو|ال|عبد))?(?:\s+[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?){1,2})/gu;
const ARABIC_PERSON_FULLNAME_REGEX = /[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?(?:\s+(?:(?:بن|ابن|بنت|أبو|ال|عبد)\s+)?[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?){1,3}/gu;
const ARABIC_PERSON_ROLE_CONTEXT_REGEX = /(?:الهدف|الصراف|الناشط|المصدر|الوسيط|نائبه|نائبته|العقيد|الرائد|النقيب|المدير)\s+([\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?(?:\s+(?:بن|ابن|بنت|أبو|ال|عبد))?(?:\s+[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?){0,2})/gu;
const ARABIC_PERSON_NICKNAME_REGEX = /([\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?(?:\s+(?:بن|ابن|بنت|أبو|ال|عبد))?(?:\s+[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?){1,2})\s+\(["'«»]?[^()"'\n]{2,24}["'«»]?\)/gu;
const HEBREW_ORG_REGEX = /(?:חברת|חברה|קבוצת|קבוצה|ארגון|עמותה|רשות|משרד|יחידה|צוות|בנק|תאגיד)\s+[א-תA-Za-z0-9"׳״'-]+(?:\s+[א-תA-Za-z0-9"׳״'-]+){0,2}/g;
const HEBREW_LOCATION_REGEX = /(?:נמל|רציף|מחסן|מסוף|שדה התעופה|גבול|עיר|מחוז|אזור|מתחם|חווה|בסיס)\s+[א-תA-Za-z0-9"׳״'-]+(?:\s+[א-תA-Za-z0-9"׳״'-]+){0,1}/g;
const HEBREW_LOCATION_EXTENDED_REGEX = /(?:רחוב|כביש|בניין|מגדל|מרפאה|אוניברסיטה|בית חולים|כפר|נמל|רציף|מחסן|מסוף|שדה התעופה|גבול|עיר|מחוז|אזור|מתחם|חווה|בסיס)\s+[א-תA-Za-z0-9"׳״'-]+(?:\s+[א-תA-Za-z0-9"׳״'-]+){0,2}/g;
const HEBREW_EVENT_REGEX = /(?:פגישה|העברה|משלוח|פשיטה|מעצר|תשלום|ישיבה|שיחה|הנחיה|הפעלה|הדלפה|עסקה|מבצע)\s+[א-תA-Za-z0-9"׳״'-]+(?:\s+[א-תA-Za-z0-9"׳״'-]+){0,1}/g;
const HEBREW_METHOD_REGEX = /(?:שיטת|נוהל|מסלול|פרוטוקול|תכנית)\s+[א-תA-Za-z0-9"׳״'-]+(?:\s+[א-תA-Za-z0-9"׳״'-]+){0,1}/g;
const HEBREW_OBJECT_REGEX = /(?:מכולה|טלפון|מכשיר|שרת|מסמך|חשבון|רכב|רחפן|טלגרם|דוא"ל|כתובת|דירה)\s+[א-תA-Za-z0-9@._:/#-]+(?:\s+[א-תA-Za-z0-9@._:/#-]+){0,1}/g;
const HEBREW_VEHICLE_REGEX = /(?:רכב|משאית|ואן|אופנוע|מלגזה|טרקטור|אוטובוס|רחפן)\s+[א-תA-Za-z0-9"׳״-]+(?:\s+[א-תA-Za-z0-9"׳״-]+){0,2}/g;
const ENGLISH_LOCATION_REGEX = /\b(?:North|South|East|West|Upper|Lower|Old|New)?\s*(?:Pier|Port|Wharf|Warehouse|Terminal|Airport|Border|Base|Station|Crossing|District|Camp|Farm|Street|Road|Avenue|Boulevard|Building|Tower|Campus|Clinic|Hospital|University|Valley|Village|County|Province|Harbor)\s+[A-Z0-9-]+\b/g;
const ENGLISH_GEO_NAME_REGEX = /\b(?:Ashdod|Haifa|Eilat|Jerusalem|Tel Aviv|Gaza|Rafah|Amman|Tehran|Damascus|Beirut)\b(?:\s+(?:Port|Crossing|District|Airport|Base))?/g;
const ENGLISH_VEHICLE_REGEX = /\b(?:Toyota|Ford|Chevrolet|Mercedes(?:-Benz)?|BMW|Audi|Volkswagen|Honda|Hyundai|Kia|Nissan|Mazda|Mitsubishi|Isuzu|Volvo|Scania|Tesla|BYD|Renault|Peugeot|Citroen|Fiat|Skoda|MAN|DAF|Iveco|DJI|Caterpillar|CAT|Komatsu|John Deere)\s+[A-Z]?[A-Za-z0-9-]{1,}(?:\s+(?:van|truck|sedan|pickup|bus|tractor|trailer|forklift|drone|excavator))?\b/g;
const LICENSE_PLATE_REGEX = /\b(?:\d{2,3}-\d{2,3}-\d{2,3}|[A-Z]{1,3}-\d{3,4}(?:-\d{1,3})?)\b/g;
const VIN_REGEX = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const CONTAINER_ID_REGEX = /\b[A-Z]{4}\d{7}\b/g;
const IBAN_REGEX = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const SWIFT_REGEX = /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g;
const ENGLISH_TITLE_PHRASE_REGEX =
  /\b(?:[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?|\d+[A-Za-z-]*)(?:\s+(?:[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?|\d+[A-Za-z-]*|of|the|and|for|de|del|al|bin|ibn)){1,4}\b/g;
const ENGLISH_ORG_HINTS = /\b(?:Group|Logistics|Finance|Holdings|Ministry|Authority|Unit|Agency|Brokers|Systems|Labs|Network|Maritime|Shipping|Marine|Industries|Services|Solutions)\b/i;
const ENGLISH_LOCATION_HINTS = /\b(?:Pier|Port|Wharf|Warehouse|Terminal|Airport|Border|Base|District|Farm|Street|Road|Avenue|Boulevard|Building|Tower|Campus|Clinic|Hospital|University|Valley|Village|County|Province|Harbor)\b/i;
const ENGLISH_EVENT_HINTS = /\b(?:Meeting|Transfer|Shipment|Raid|Arrest|Payment|Call|Directive|Operation)\b/i;
const ENGLISH_METHOD_HINTS = /\b(?:Protocol|Method|Operation|Plan|Scheme|Route)\b/i;
const ENGLISH_OBJECT_HINTS = /\b(?:Container|Device|Server|Account|Drone|Phone|Wallet|File|Document)\b/i;
const ENGLISH_VEHICLE_HINTS = /\b(?:Toyota|Ford|Chevrolet|Mercedes|BMW|Audi|Volkswagen|Honda|Hyundai|Kia|Nissan|Mazda|Mitsubishi|Isuzu|Volvo|Scania|Tesla|BYD|Renault|Peugeot|Citroen|Fiat|Skoda|MAN|DAF|Iveco|DJI|Caterpillar|CAT|Komatsu|John Deere|truck|sedan|pickup|van|bus|tractor|trailer|forklift|excavator|drone)\b/i;
const ENGLISH_PERSON_LIST_REGEX =
  /\b([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|bin|ibn|al|de|del|van|von|ben|abu)){1,2})\s+(?:and|&)\s+([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|bin|ibn|al|de|del|van|von|ben|abu)){1,2})\b/g;
const HEBREW_PERSON_LIST_REGEX =
  /\b([א-ת]{2,}(?:[-'״׳][א-ת]{1,})?(?:\s+(?:בן|בת|אבו|אל|דה|דל|ואן|פון))?(?:\s+[א-ת]{2,}(?:[-'״׳][א-ת]{1,})?){1,2})\s+ו(?:את|עם)?\s*([א-ת]{2,}(?:[-'״׳][א-ת]{1,})?(?:\s+(?:בן|בת|אבו|אל|דה|דל|ואן|פון))?(?:\s+[א-ת]{2,}(?:[-'״׳][א-ת]{1,})?){1,2})/g;
const ENGLISH_TITLE_PREFIX_REGEX = /^(?:mr|mrs|ms|dr|prof|capt|commander|colonel|director|agent)\.?\s+/i;
const TRAILING_ACTION_REGEX = /\s+(?:reviewed|emailed|contacted|called|briefed|interviewed|questioned|asked|told|directed|met|signed|reported|spoke|wrote|flagged|requested|inspected)\b.*$/i;
const LEADING_DATE_NOISE_REGEX = /^(?:on\s+)?(?:\d{4}-\d{2}-\d{2}|\d{1,2})\s+/i;
const PHRASE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "onto",
  "report",
  "document",
  "analysis",
  "section",
  "appendix",
  "metadata",
  "attachment",
]);
const HEBREW_PERSON_NON_NAME_TOKENS = new Set([
  "לחלפנות", "חלפנות", "כספים", "הכספים", "לכספים", "מודיעין", "תמונת", "מצב", "שאלות", "דחיפות", "עליונה",
  "ציר", "מימון", "טרור", "אמצעי", "לחימה", "כוונות", "פיגועים", "רגישות", "מקורות", "אימות", "צולב",
  "ידיעות", "זהב", "הנחיות", "להפעלה", "מטרת", "הצי\"ח", "צי\"ח", "מיידי", "התארגנות", "הקשר", "העברה",
  "הזרמה", "חיצונית", "שאלת", "דגשים", "רקע", "מחקר", "לוגיסטיקה", "מידע", "בין", "פיזי", "שעות", "האחרונות",
  "רשימת", "שמות", "יעד", "נצפים", "בזמן", "אמת", "חסימת", "תקשורת", "סלקטיבית", "כוח", "הלוחמים", "נמצא",
  "אינו", "כסף", "המשמעות", "המבצעית", "תוכן", "המסר", "החקירה", "המידע", "המפליל", "שורת", "הסיכום", "המלצה",
  "אופרטיבית", "הפער", "המודיעיני", "המבצעי", "פנימי", "תמליל", "השיחה", "דרישת", "השלמות", "לביצוע",
  "אישור", "תוכנית", "מנוי", "מוצפן", "רשת", "סלולר", "ישראלית", "בידי", "האסיר", "הביטחוני", "פיננסי", "בשם",
  "קישוריות", "חיצונית", "והפעלה", "מרחוק", "והציוד", "דווקא", "להזמנה", "ספציפית", "סיכול", "רחב", "הפללה",
  "מלאה", "חטיבת", "אגף", "המודיעין", "החקירות", "והמודיעין", "מבצעים", "מיוחדים", "יחידה", "מבצעית",
  "בית", "סוהר", "יחידת", "זירה", "מחוז", "מוסד", "איסוף", "חופי", "צפונית", "מחקר", "טכנולוגי", "הוא",
  "אחסון", "בשטח", "ככל", "נשמע", "אומר", "תחייב", "דיווח", "מיידי", "שיש", "לו", "בלבד", "מקום", "לינה",
  "והיה", "והיא", "והוא", "מיועד", "הפועל", "פועל", "שימש", "ששימש",
]);
const ARABIC_PERSON_NON_NAME_TOKENS = new Set([
  "الأموال", "مال", "تمويل", "لوجستية", "لوجستي", "معلومات", "استخبارات", "أسئلة", "عاجل", "فوري", "سياق",
  "تحويل", "شبكة", "خلية", "عملية", "تنسيق", "مخزن", "مستودع", "طريق", "فوري", "الوقت", "الأخيرة",
  "الأسماء", "المرصودة",
]);
const ENGLISH_PERSON_NON_NAME_TOKENS = new Set([
  "essential", "elements", "information", "intelligence", "requirements", "summary", "update", "background", "document",
  "analysis", "report", "questions", "urgent", "immediate", "context", "observed", "names", "target", "list",
]);
const HEBREW_HEURISTIC_NOISE_TOKENS = new Set([
  "של", "עם", "אל", "או", "גם", "רק", "בלבד", "כי", "אם", "האם", "כדי", "יש", "אין", "הוא", "היא", "אינו",
  "אינה", "נמצא", "מיועד", "נועד", "מיידי", "מיידית", "למנוע", "למעצר", "ולחסימת", "ובסמוך", "שיש", "לו",
  "ככל", "נשמע", "אומר", "תחייב", "דיווח", "בשטח", "מקום", "לינה",
]);
const ENGLISH_HEURISTIC_NOISE_TOKENS = new Set([
  "of", "the", "and", "or", "for", "with", "from", "into", "onto", "only", "just", "appears", "seems", "report",
  "summary", "update", "document", "analysis", "question", "questions",
]);
const TITLE_CASE_CONNECTORS = new Set(["of", "the", "and", "for", "de", "del", "al", "bin", "ibn"]);
const PERSON_LIST_LABEL_PREFIX_REGEX = /^(?:רשימת יעד|רשימת שמות|שמות יעד|Observed names|Target list|Target names|الأسماء المرصودة|الأسماء(?:\s+المستهدفة)?)[\s:：-]*/iu;
const ACTION_VERB_STOPWORDS = new Set([
  "reviewed",
  "emailed",
  "contacted",
  "called",
  "briefed",
  "interviewed",
  "questioned",
  "asked",
  "told",
  "directed",
  "met",
  "signed",
  "reported",
  "spoke",
  "wrote",
  "flagged",
  "requested",
  "inspected",
]);

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const normalizeName = (value: string): string => EntityCreationEngine.normalizeEntityKey(value);
const isBlockedEntityName = (value: string): boolean => BLOCKED_ENTITY_KEYS.has(normalizeName(value));
const isPlaceholderContextText = (value?: string): boolean =>
  Boolean(value && PLACEHOLDER_CONTEXT_PATTERNS.some((pattern) => pattern.test(value)));
const hasHebrew = (value: string): boolean => HEBREW_CHAR_REGEX.test(value);
const hasArabic = (value: string): boolean => ARABIC_CHAR_REGEX.test(value);
const isHebrewDominant = (value: string): boolean => {
  const hebrewMatches = value.match(/[\u0590-\u05FF]/gu) || [];
  const latinMatches = value.match(/[A-Za-z]/g) || [];
  return hebrewMatches.length > 10 && hebrewMatches.length >= latinMatches.length;
};

const typePriority = (type?: string): number => {
  switch (toEntityType(type)) {
    case "EVENT":
      return 8;
    case "DATE":
      return 7;
    case "LOCATION":
      return 6;
    case "ASSET":
      return 5;
    case "VEHICLE":
      return 5;
    case "IDENTIFIER":
      return 5;
    case "METHOD":
      return 4;
    case "OBJECT":
      return 3;
    case "ORGANIZATION":
      return 2;
    case "PERSON":
      return 1;
    default:
      return 0;
  }
};

const sanitizeHeuristicName = (value: string, type: string): string => {
  let cleaned = value
    .trim()
    .replace(LEADING_DATE_NOISE_REGEX, "")
    .replace(ENGLISH_TITLE_PREFIX_REGEX, "")
    .replace(/^(?:את|עם|אל|ליד|לידי)\s+/u, "")
    .replace(/^(?:with|near|at|by)\s+/iu, "")
      .replace(/[.,;:!?]+$/g, "")
      .replace(TRAILING_ACTION_REGEX, "")
      .replace(/\s+(?:וה(?:וא|יא|יה)|ה(?:וא|יא|יה)|מיועד(?:ת)?|הפועל(?:ת)?|פועל(?:ת)?|ששימש(?:ה)?|שימש(?:ה)?).*$/u, "")
      .replace(/\s+(?:לגבי|בנושא|את|עם|אל|על|מול|אחרי|לפני|דרך).*$/u, "")
      .replace(/\s+(?:שלח|שלחה|מימן|מימנה|העביר|העבירה|תיעד|תיעדה|כתב|כתבה|דיווח|דיווחה).*$/u, "")
    .replace(/\s+(?:ולאחר מכן|לאחר מכן|ולאחר|לאחר|ובהמשך).*$/u, "")
    .replace(/\s+(?:and|with|near|later|before|after).*$/iu, "")
    .replace(/\s+ב(?:נמל|רציף|מחסן|מסוף|עיר|מתחם|כביש|רחוב|בניין|שדה התעופה).*$/u, "")
    .replace(/\s+ב-\d+.*$/u, "")
    .replace(/\s+ו(?:ב|ל)?(?:שרת|מחסן|נמל|רציף|טלפון).*$/u, "")
    .trim();

  if (type === "PERSON" && /^(?:ראש הצוות|ראש היחידה|מפקד הצוות|מנהל)\s+/u.test(cleaned)) {
    cleaned = cleaned
      .split(/\s+/)
      .slice(-2)
      .join(" ");
  }

  if (type === "PERSON") {
    cleaned = cleaned
      .replace(/^(?:החוקר|החוקרת|האנליסט|האנליסטית|החוקר הראשי|הקצין|הקצינה)\s+/u, "")
      .replace(/^(?:בידי|מאת|על\s+ידי)\s+/u, "")
      .replace(/^(?:היעד|החלפן|הפעיל|המקור|השליח|ל?איש\s+הקשר(?:\s+הפיננסי)?|האסיר(?:\s+הביטחוני)?|האחיין|ל?אחיינו|ל?אחייניתו|הנחקר|הדובר|ראש\s+הצוות|ראש\s+היחידה|מפקד(?:ת)?\s+הצוות|סגנו(?:\s+של)?|סגניתו(?:\s+של)?)\s+/u, "")
      .replace(/^(?:السيد|السيدة|د\.?|دكتور|دكتورة|عميد|عقيد|لواء|رائد|نقيب|مقدم|مدير)\s+/u, "")
      .replace(/^(?:الهدف|الصراف|الناشط|المصدر|الوسيط|نائبه|نائبته)\s+/u, "")
      .replace(/^(?:רשימת יעד|רשימת שמות|שמות יעד|Observed names|Target list|الأسماء المرصودة|الأسماء)\s*[:：]\s*/iu, "")
      .replace(/\s+(?:مع|في|إلى|الى|عن|من|على|لدى).*$/u, "")
      .replace(/^(?:investigator|investigators|reviewer|analyst|operator)\s+/iu, "")
      .replace(/\s+(?:and|or)\s+[A-Z][a-z].*$/i, "")
      .trim();
  }

  return cleaned;
};

const isValidPhraseCandidate = (value: string): boolean => {
  const cleaned = value.trim().replace(/[.,;:!?]+$/g, "");
  if (cleaned.length < 3 || cleaned.length > 80) return false;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  if (parts.every((part) => PHRASE_STOPWORDS.has(part.toLowerCase()))) return false;
  if (parts.some((part) => /^\d{4}$/.test(part))) return false;
  if (parts.some((part) => /^\d+$/.test(part))) return false;
  if (/\b(?:met|contacted|emailed|called|briefed|interviewed|questioned|asked|told|directed|spoke|reviewed)\b/i.test(cleaned)) return false;
  if (/(?:פגש|שוחח|דיבר|אמר|כתב|פנה|ביקש|הורה|תחקר|ראיין)/u.test(cleaned)) return false;
  return true;
};

const isLikelyPersonName = (value: string): boolean => {
  const cleaned = sanitizeHeuristicName(value, "PERSON");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  if (parts.some((part) => /^\d/.test(part))) return false;
  if (parts.some((part) => ACTION_VERB_STOPWORDS.has(part.toLowerCase()))) return false;
  if (hasHebrew(cleaned)) {
    const lowered = parts.map((part) => part.toLowerCase());
    if (lowered.some((part) => HEBREW_PERSON_NON_NAME_TOKENS.has(part))) return false;
    if (/^(?:בן|בת|אבו|אל|דה|דל|ואן|פון)$/u.test(parts[0]) || /^(?:בן|בת|אבו|אל|דה|דל|ואן|פון)$/u.test(parts[parts.length - 1])) return false;
    const substantive = parts.filter((part) => !/^(?:בן|בת|אבו|אל|דה|דל|ואן|פון)$/u.test(part));
    if (!substantive.length || substantive.every((part) => part.length <= 1)) return false;
    return parts.every((part) => /^[א-ת]{1,}(?:[-'״׳][א-ת]{1,})?$/.test(part) || /^(?:בן|בת|אבו|אל|דה|דל|ואן|פון)$/.test(part));
  }
  if (hasArabic(cleaned)) {
    const lowered = parts.map((part) => part.toLowerCase());
    if (lowered.some((part) => ARABIC_PERSON_NON_NAME_TOKENS.has(part))) return false;
    if (/^(?:بن|ابن|بنت|أبو|ال|عبد|مع|في|إلى|الى|عن|من|على|لدى)$/u.test(parts[0]) || /^(?:بن|ابن|بنت|أبو|ال|عبد|مع|في|إلى|الى|عن|من|على|لدى)$/u.test(parts[parts.length - 1])) return false;
    const substantive = parts.filter((part) => !/^(?:بن|ابن|بنت|أبو|ال|عبد)$/u.test(part));
    if (!substantive.length || substantive.every((part) => part.length <= 1)) return false;
    return parts.every((part) => /^[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?$/u.test(part) || /^(?:بن|ابن|بنت|أبو|ال|عبد)$/u.test(part));
  }
  if (parts.map((part) => part.toLowerCase()).some((part) => ENGLISH_PERSON_NON_NAME_TOKENS.has(part))) return false;
  if (ENGLISH_ORG_HINTS.test(cleaned)) return false;
  const lowered = parts.map((part) => part.toLowerCase());
  if (TITLE_CASE_CONNECTORS.has(lowered[0] || "") || TITLE_CASE_CONNECTORS.has(lowered[lowered.length - 1] || "")) return false;
  const substantive = parts.filter((part) => !TITLE_CASE_CONNECTORS.has(part.toLowerCase()));
  if (!substantive.length || substantive.every((part) => part.length <= 1)) return false;
  return parts.every(
    (part) => /^(?:al-[A-Z][a-z]+|[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)$/.test(part) || TITLE_CASE_CONNECTORS.has(part.toLowerCase()),
  );
};

const isLikelyTypedHeuristicCandidate = (value: string, type: string): boolean => {
  const cleaned = sanitizeHeuristicName(value, type);
  if (!cleaned || !isValidPhraseCandidate(cleaned)) return false;
  if (type === "PERSON") return isLikelyPersonName(cleaned);

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  if (cleaned.includes("\n") || /[|]/.test(cleaned)) return false;

  const minimumTokens = type === "IDENTIFIER" || type === "VEHICLE" ? 1 : 2;
  const maximumTokens = type === "OBJECT" ? 4 : 5;
  if (parts.length < minimumTokens || parts.length > maximumTokens) return false;

  const trailingParts = parts.slice(1).map((part) => part.toLowerCase());
  if (hasHebrew(cleaned)) {
    if (trailingParts.some((part) => HEBREW_HEURISTIC_NOISE_TOKENS.has(part) || HEBREW_PERSON_NON_NAME_TOKENS.has(part))) return false;
  } else if (!hasArabic(cleaned)) {
    if (trailingParts.some((part) => ENGLISH_HEURISTIC_NOISE_TOKENS.has(part))) return false;
  }

  if (type === "EVENT" || type === "METHOD") {
    return parts.length >= 2;
  }

  return true;
};

const shouldRetainEntity = (entity: Entity): boolean => {
  const type = toEntityType(entity.type);
  const cleanedName = sanitizeHeuristicName(entity.name, type);
  if (!cleanedName || isBlockedEntityName(cleanedName)) return false;
  if (type === "MISC") return false;
  if (type === "OTHER") return false;
  if (type === "PERSON" && !isLikelyPersonName(cleanedName)) return false;
  if (type === "DATE") return /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/.test(cleanedName);
  if ((type === "OTHER" || type === "OBJECT") && cleanedName.split(/\s+/).length > 5) return false;
  return true;
};

const isSubstantiveEntityType = (type?: string): boolean => !["DATE", "OTHER", "MISC"].includes(toEntityType(type));

const pickLeadEntities = (entities: Entity[], limit: number): Entity[] =>
  entities
    .filter((entity) => !isBlockedEntityName(entity.name))
    .filter((entity) => isSubstantiveEntityType(entity.type))
    .sort((left, right) =>
      (right.salience || 0) - (left.salience || 0) ||
      (right.confidence || 0) - (left.confidence || 0) ||
      (right.evidence?.length || 0) - (left.evidence?.length || 0),
    )
    .slice(0, limit);

const harvestLineCandidates = (sourceText: string): HeuristicCandidate[] => {
  const candidates = new Map<string, HeuristicCandidate>();

  const pushCandidate = (name: string, fallbackType: string, confidence: number, role: string) => {
    const cleaned = sanitizeHeuristicName(name, fallbackType);
    if (!isValidPhraseCandidate(cleaned)) return;
    const inferredType = inferHeuristicType(cleaned, fallbackType);
    if (!isLikelyTypedHeuristicCandidate(cleaned, inferredType)) return;
    const normalized = normalizeName(cleaned);
    const candidate: HeuristicCandidate = {
      name: cleaned,
      type: inferredType,
      role,
      confidence,
      aliases: [cleaned],
    };
    const existing = candidates.get(normalized);
    if (!existing || candidate.confidence > existing.confidence) {
      candidates.set(normalized, candidate);
    }
  };

  const lines = sourceText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (isHebrewDominant(sourceText)) {
    return [];
  }
  lines.forEach((line) => {
    if (line.length > 220) return;
    const fragments = line.split(/\s*[;,|]\s*/).map((fragment) => fragment.trim()).filter(Boolean);
    fragments.forEach((fragment) => {
      if (/[A-Z][a-z]+/.test(fragment) || /[\u0590-\u05FF]{2,}/u.test(fragment)) {
        pushCandidate(fragment, hasHebrew(fragment) ? "OBJECT" : "OTHER", 0.58, "Line-level named phrase candidate");
      }
    });
  });

  const titleMatches = sourceText.match(ENGLISH_TITLE_PHRASE_REGEX) || [];
  titleMatches.forEach((match) => {
    pushCandidate(match, "OTHER", 0.62, "Expanded title-cased phrase candidate");
  });

  return Array.from(candidates.values());
};

const toEntityType = (value?: string): string => {
  const normalized = (value || "OTHER").toUpperCase();
  if (["PERSON"].includes(normalized)) return "PERSON";
  if (["ORG", "ORGANIZATION"].includes(normalized)) return "ORGANIZATION";
  if (["LOCATION", "PLACE", "FACILITY"].includes(normalized)) return "LOCATION";
  if (["ASSET", "URL", "EMAIL", "IP"].includes(normalized)) return "ASSET";
  if (["VEHICLE"].includes(normalized)) return "VEHICLE";
  if (["IDENTIFIER", "ACCOUNT", "BANK_ACCOUNT", "LICENSE_PLATE", "VIN"].includes(normalized)) return "IDENTIFIER";
  if (["DATE", "TIME"].includes(normalized)) return "DATE";
  if (["EVENT"].includes(normalized)) return "EVENT";
  if (["METHOD"].includes(normalized)) return "METHOD";
  if (["OBJECT"].includes(normalized)) return "OBJECT";
  return normalized || "OTHER";
};

const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matchesPatternOnce = (value: string, regex: RegExp): boolean => new RegExp(regex.source, regex.flags.replace(/g/g, "")).test(value);

const extractEvidenceSnippets = (sourceText: string, aliases: string[]): string[] => {
  const snippets: string[] = [];
  const seen = new Set<string>();
  aliases
    .filter(Boolean)
    .slice(0, 5)
    .forEach((alias) => {
      const regex = new RegExp(escapeRegex(alias), "ig");
      let match: RegExpExecArray | null = null;
      let iterations = 0;
      while ((match = regex.exec(sourceText)) && iterations < 3) {
        const start = Math.max(0, match.index - 140);
        const end = Math.min(sourceText.length, match.index + alias.length + 180);
        const snippet = sourceText.slice(start, end).trim();
        if (snippet && !seen.has(snippet)) {
          snippets.push(snippet);
          seen.add(snippet);
        }
        iterations += 1;
      }
    });
  return snippets.slice(0, 4);
};

const normalizeDate = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return value;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

export const sanitizeAnalysisInput = (text: string): string => {
  if (!text.trim()) return "";

  const attachmentBodiesUnwrapped = text.replace(
    /\[SYSTEM ATTACHMENT\][\s\S]*?\[EXTRACTED_TEXT_START\]\s*([\s\S]*?)\s*\[EXTRACTED_TEXT_END\]/g,
    "\n$1\n",
  );

  return attachmentBodiesUnwrapped
    .replace(/\[METADATA_START\][\s\S]*?\[METADATA_END\]/g, " ")
    .replace(/^\[SYSTEM ATTACHMENT\].*$/gm, "")
    .replace(/^\[EXTRACTED_TEXT_START\].*$/gm, "")
    .replace(/^\[EXTRACTED_TEXT_END\].*$/gm, "")
    .replace(/^\[EXTERNAL LINK\].*$/gm, "")
    .replace(/^FILENAME:.*$/gm, "")
    .replace(/^TYPE:.*$/gm, "")
    .replace(/^METADATA:.*$/gm, "")
    .replace(/^ATTACHMENTS:.*$/gm, "")
    .replace(/^BIOMETRIC_.*$/gm, "")
    .replace(/\(\s*Admiralty Code\s*\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

const detectDates = (text: string): string[] =>
  dateRegexes.flatMap((regex) => Array.from(text.matchAll(regex)).map((match) => normalizeDate(match[0])));

const extractPrimaryDate = (value: string): string | undefined => detectDates(value)[0];

const inferHeuristicType = (name: string, fallback: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  if (
    ENGLISH_LOCATION_HINTS.test(trimmed) ||
    matchesPatternOnce(trimmed, ENGLISH_GEO_NAME_REGEX) ||
    /^(?:נמל|רציף|מחסן|מסוף|שדה התעופה|גבול|עיר|מחוז|אזור|מתחם|חווה|בסיס)\b/.test(trimmed)
  ) {
    return "LOCATION";
  }
  if (ENGLISH_VEHICLE_HINTS.test(trimmed) || /^(?:רכב|משאית|ואן|אופנוע|מלגזה|טרקטור|אוטובוס|רחפן)\b/.test(trimmed)) {
    return "VEHICLE";
  }
  if (
    matchesPatternOnce(trimmed, LICENSE_PLATE_REGEX) ||
    matchesPatternOnce(trimmed, VIN_REGEX) ||
    matchesPatternOnce(trimmed, CONTAINER_ID_REGEX) ||
    matchesPatternOnce(trimmed, IBAN_REGEX) ||
    matchesPatternOnce(trimmed, SWIFT_REGEX)
  ) {
    return "IDENTIFIER";
  }
  if (ENGLISH_EVENT_HINTS.test(trimmed) || /^(?:פגישה|העברה|משלוח|פשיטה|מעצר|תשלום|ישיבה|שיחה|הנחיה|הפעלה|הדלפה|עסקה|מבצע)\b/.test(trimmed)) {
    return "EVENT";
  }
  if (ENGLISH_METHOD_HINTS.test(trimmed) || /^(?:שיטת|נוהל|מסלול|פרוטוקול|תכנית)\b/.test(trimmed)) {
    return "METHOD";
  }
  if (ENGLISH_OBJECT_HINTS.test(trimmed) || /^(?:מכולה|טלפון|מכשיר|שרת|מסמך|חשבון|רכב|רחפן|טלגרם|דוא"ל|כתובת|דירה)\b/.test(trimmed)) {
    return "OBJECT";
  }
  if (ENGLISH_ORG_HINTS.test(trimmed) || /^(?:חברת|חברה|קבוצת|קבוצה|ארגון|עמותה|רשות|משרד|יחידה|צוות|בנק|תאגיד)\b/.test(trimmed)) {
    return "ORGANIZATION";
  }
  return fallback;
};

const collectRegexMatches = (
  text: string,
  regex: RegExp,
  fallbackType: string,
  role: string,
  confidence: number,
  candidates: Map<string, HeuristicCandidate>,
) => {
  const matches = text.match(regex) || [];
  matches.forEach((match) => {
    const cleaned = sanitizeHeuristicName(match, fallbackType);
    if (cleaned.length < 3) return;
    const inferredType = inferHeuristicType(cleaned, fallbackType);
    if (!isLikelyTypedHeuristicCandidate(cleaned, inferredType)) return;
    const key = normalizeName(cleaned);
    const candidate: HeuristicCandidate = {
      name: cleaned,
      type: inferredType,
      role,
      confidence,
      aliases: [cleaned],
    };
    const existing = candidates.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      candidates.set(key, candidate);
    }
  });
};

const collectCaptureMatches = (
  text: string,
  regex: RegExp,
  fallbackType: string,
  role: string,
  confidence: number,
  candidates: Map<string, HeuristicCandidate>,
) => {
  const matches = Array.from(text.matchAll(regex));
  matches.forEach((match) => {
    const captured = (match[1] || match[0] || "").trim();
    if (!captured) return;
    const cleaned = sanitizeHeuristicName(captured, fallbackType);
    if (cleaned.length < 3) return;
    const inferredType = inferHeuristicType(cleaned, fallbackType);
    if (!isLikelyTypedHeuristicCandidate(cleaned, inferredType)) return;
    const key = normalizeName(cleaned);
    const candidate: HeuristicCandidate = {
      name: cleaned,
      type: inferredType,
      role,
      confidence,
      aliases: [cleaned],
    };
    const existing = candidates.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      candidates.set(key, candidate);
    }
  });
};

const collectDelimitedPersonFragments = (text: string, candidates: Map<string, HeuristicCandidate>) => {
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      if (!PERSON_LIST_LABEL_PREFIX_REGEX.test(line)) return;
      const candidateLine = line.replace(PERSON_LIST_LABEL_PREFIX_REGEX, "").trim();
      if (!candidateLine) return;
      candidateLine
        .split(/\s*[;,،|]\s*/u)
        .map((fragment) => sanitizeHeuristicName(fragment, "PERSON"))
        .filter(Boolean)
        .forEach((fragment) => {
          if (!isLikelyPersonName(fragment)) return;
          const key = normalizeName(fragment);
          const candidate: HeuristicCandidate = {
            name: fragment,
            type: "PERSON",
            role: "Person name inferred from delimited list fragment",
            confidence: 0.69,
            aliases: [fragment],
          };
          const existing = candidates.get(key);
          if (!existing || candidate.confidence > existing.confidence) {
            candidates.set(key, candidate);
          }
        });
    });
};

const extractHeuristicCandidates = (sourceText: string): HeuristicCandidate[] => {
  const candidates = new Map<string, HeuristicCandidate>();

  collectRegexMatches(sourceText, PERSON_TITLE_REGEX, "PERSON", "Titled personal name candidate", 0.78, candidates);
  collectCaptureMatches(sourceText, HEBREW_PERSON_TITLE_REGEX, "PERSON", "שם אדם עם תואר", 0.79, candidates);
  collectCaptureMatches(sourceText, ARABIC_PERSON_TITLE_REGEX, "PERSON", "اسم شخص مع لقب", 0.8, candidates);
  collectCaptureMatches(sourceText, ENGLISH_PERSON_CONTEXT_REGEX, "PERSON", "Person name inferred from action context", 0.77, candidates);
  collectCaptureMatches(sourceText, ENGLISH_PERSON_SUBJECT_ACTION_REGEX, "PERSON", "Person name inferred before action verb", 0.76, candidates);
  collectCaptureMatches(sourceText, HEBREW_PERSON_CONTEXT_REGEX, "PERSON", "שם אדם שזוהה מתוך הקשר פעולה", 0.76, candidates);
  collectCaptureMatches(sourceText, HEBREW_PERSON_ROLE_CONTEXT_REGEX, "PERSON", "שם אדם שזוהה מתוך תפקיד מבצעי", 0.84, candidates);
  collectCaptureMatches(sourceText, HEBREW_PERSON_NICKNAME_REGEX, "PERSON", "שם אדם עם כינוי או כינוי מבצעי", 0.81, candidates);
  collectCaptureMatches(sourceText, ARABIC_PERSON_CONTEXT_REGEX, "PERSON", "اسم شخص من سياق פעולה בערבית", 0.78, candidates);
  collectCaptureMatches(sourceText, ARABIC_PERSON_ROLE_CONTEXT_REGEX, "PERSON", "اسم شخص من תפקיד מבצעי בערבית", 0.84, candidates);
  collectCaptureMatches(sourceText, ARABIC_PERSON_NICKNAME_REGEX, "PERSON", "اسم شخص مع كنية أو لقب", 0.8, candidates);
  collectCaptureMatches(sourceText, ENGLISH_PERSON_LIST_REGEX, "PERSON", "Person name inferred from coordinated English list", 0.8, candidates);
  collectCaptureMatches(sourceText, HEBREW_PERSON_LIST_REGEX, "PERSON", "שם אדם מתוך רשימה עברית", 0.79, candidates);
  collectDelimitedPersonFragments(sourceText, candidates);
  collectRegexMatches(sourceText, HEBREW_ORG_REGEX, "ORGANIZATION", "ארגון שזוהה לפי מילת הובלה", 0.76, candidates);
  collectRegexMatches(sourceText, HEBREW_LOCATION_REGEX, "LOCATION", "מיקום שזוהה לפי מילת הובלה", 0.77, candidates);
  collectRegexMatches(sourceText, HEBREW_LOCATION_EXTENDED_REGEX, "LOCATION", "כתובת או אתר בעברית", 0.74, candidates);
  collectRegexMatches(sourceText, ENGLISH_LOCATION_REGEX, "LOCATION", "English location/facility candidate", 0.78, candidates);
  collectRegexMatches(sourceText, ENGLISH_GEO_NAME_REGEX, "LOCATION", "Known geo-location candidate", 0.76, candidates);
  collectRegexMatches(sourceText, HEBREW_VEHICLE_REGEX, "VEHICLE", "רכב או כלי שזוהו לפי מילת הובלה", 0.78, candidates);
  collectRegexMatches(sourceText, ENGLISH_VEHICLE_REGEX, "VEHICLE", "Vehicle, drone, or equipment model candidate", 0.81, candidates);
  collectRegexMatches(sourceText, LICENSE_PLATE_REGEX, "IDENTIFIER", "Vehicle or registration identifier", 0.84, candidates);
  collectRegexMatches(sourceText, VIN_REGEX, "IDENTIFIER", "VIN identifier", 0.91, candidates);
  collectRegexMatches(sourceText, CONTAINER_ID_REGEX, "IDENTIFIER", "Container identifier", 0.9, candidates);
  collectRegexMatches(sourceText, IBAN_REGEX, "IDENTIFIER", "IBAN or banking identifier", 0.9, candidates);
  collectRegexMatches(sourceText, SWIFT_REGEX, "IDENTIFIER", "SWIFT/BIC identifier", 0.82, candidates);
  collectRegexMatches(sourceText, HEBREW_EVENT_REGEX, "EVENT", "אירוע שזוהה לפי מילת הובלה", 0.72, candidates);
  collectRegexMatches(sourceText, HEBREW_METHOD_REGEX, "METHOD", "שיטה או מבצע שזוהו לפי מילת הובלה", 0.7, candidates);
  collectRegexMatches(sourceText, HEBREW_OBJECT_REGEX, "OBJECT", "אובייקט שזוהה לפי מילת הובלה", 0.72, candidates);

  Array.from(sourceText.matchAll(ENGLISH_PERSON_LIST_REGEX)).forEach((match) => {
    [match[1], match[2]].forEach((name) => {
      const cleaned = sanitizeHeuristicName(name || "", "PERSON");
      if (!isLikelyPersonName(cleaned)) return;
      const key = normalizeName(cleaned);
      const existing = candidates.get(key);
      const candidate: HeuristicCandidate = {
        name: cleaned,
        type: "PERSON",
        role: "Person extracted from coordinated English list",
        confidence: 0.82,
        aliases: [cleaned],
      };
      if (!existing || candidate.confidence > existing.confidence) {
        candidates.set(key, candidate);
      }
    });
  });

  Array.from(sourceText.matchAll(HEBREW_PERSON_LIST_REGEX)).forEach((match) => {
    [match[1], match[2]].forEach((name) => {
      const cleaned = sanitizeHeuristicName(name || "", "PERSON");
      if (!isLikelyPersonName(cleaned)) return;
      const key = normalizeName(cleaned);
      const existing = candidates.get(key);
      const candidate: HeuristicCandidate = {
        name: cleaned,
        type: "PERSON",
        role: "שם אדם שזוהה מתוך רשימה מתואמת",
        confidence: 0.81,
        aliases: [cleaned],
      };
      if (!existing || candidate.confidence > existing.confidence) {
        candidates.set(key, candidate);
      }
    });
  });

  splitSentences(sourceText).forEach((sentence) => {
    const quotedMatches = sentence.match(/["“”'׳״]([^"“”'׳״]{3,40})["“”'׳״]/g) || [];
    quotedMatches.forEach((rawMatch) => {
      const cleaned = rawMatch.replace(/["“”'׳״]/g, "").trim();
      if (cleaned.length < 3) return;
      const context = `${sentence} ${cleaned}`;
      const inferredType = inferHeuristicType(context, hasHebrew(cleaned) ? "OBJECT" : "OBJECT");
      if (inferredType === "OTHER" || inferredType === "PERSON") return;
      if (!isLikelyTypedHeuristicCandidate(cleaned, inferredType)) return;
      const key = normalizeName(cleaned);
      const existing = candidates.get(key);
      const candidate: HeuristicCandidate = {
        name: cleaned,
        type: inferredType,
        role: hasHebrew(cleaned) ? "מונח מודגש מתוך המשפט" : "Quoted operational term",
        confidence: inferredType === "EVENT" ? 0.74 : 0.68,
        aliases: [cleaned],
      };
      if (!existing || candidate.confidence > existing.confidence) {
        candidates.set(key, candidate);
      }
    });
  });

  harvestLineCandidates(sourceText).forEach((candidate) => {
    const key = normalizeName(candidate.name);
    const existing = candidates.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      candidates.set(key, candidate);
    }
  });

  return Array.from(candidates.values());
};

const buildGraph = (entities: Entity[], relations: Relation[]): GraphData => ({
  nodes: entities.map((entity) => ({
    id: entity.name,
    group:
      entity.type === "PERSON"
        ? 1
        : entity.type === "ORGANIZATION"
          ? 2
          : entity.type === "LOCATION"
            ? 3
            : entity.type === "ASSET"
              ? 4
              : entity.type === "VEHICLE"
                ? 5
                : entity.type === "IDENTIFIER"
                  ? 6
              : entity.type === "EVENT"
                ? 7
                : entity.type === "DATE"
                  ? 8
                  : 9,
    type: entity.type,
  })),
  edges: relations
    .filter((relation) => normalizeName(relation.source) && normalizeName(relation.source) !== normalizeName(relation.target))
    .map((relation) => ({
      source: relation.source,
      target: relation.target,
      value: Math.max(1, Math.round((relation.confidence || 0.6) * 4)),
      label: relation.type,
    })),
});

const buildEntityEvidenceFromMentions = (mentions: SidecarMention[]): string[] =>
  Array.from(
    new Set(
      mentions
        .map((mention) => mention.evidence.raw_supporting_snippet || mention.evidence.normalized_supporting_snippet)
        .filter(Boolean),
    ),
  ).slice(0, 4);

const buildEntityEvidenceFromPayload = (payload: SidecarExtractionPayload, entityId: string): string[] =>
  Array.from(
    new Set(
      payload.mentions
        .filter((mention) => mention.entity_id === entityId)
        .map((mention) => mention.evidence.raw_supporting_snippet || mention.evidence.normalized_supporting_snippet)
        .filter(Boolean),
    ),
  ).slice(0, 4);

const buildPersonChunks = (sourceText: string): Array<{ chunkId: string; text: string; page?: number }> =>
  splitSentences(sourceText).map((sentence, index) => ({
    chunkId: `person_chunk_${index}`,
    text: sentence,
    page: undefined,
  }));

const buildUiEntityFromPersonEntity = (
  entity: SidecarPersonEntity,
  facts: SidecarPersonFact[],
  dossiers: Record<string, PersonDossier>,
): Entity => {
  const entityFacts = facts.filter((fact) => fact.entityId === entity.entityId);
  const evidence = Array.from(new Set(entityFacts.map((fact) => fact.value).filter(Boolean))).slice(0, 6);
  const organizations = entityFacts.filter((fact) => fact.kind === "organization").map((fact) => fact.value);
  const roles = entityFacts.filter((fact) => fact.kind === "role").map((fact) => fact.value);
  const dossier = dossiers[entity.entityId];

  return {
    id: entity.entityId,
    name: entity.canonicalName,
    type: "PERSON",
    description:
      dossier?.roles?.length || dossier?.organizations?.length
        ? [dossier.roles?.[0], dossier.organizations?.[0]].filter(Boolean).join(" @ ")
        : [roles[0], organizations[0]].filter(Boolean).join(" @ ") || "Evidence-backed person entity",
    confidence: entity.confidence,
    aliases: Array.from(new Set([entity.canonicalName, ...entity.aliases])).filter(Boolean),
    salience: Math.min(1, 0.42 + Math.min(0.5, entity.mentions.length * 0.08)),
    evidence,
    source_chunks: [],
  };
};

const mergePersonPipelineIntoEntities = (
  entities: Entity[],
  personEntities: SidecarPersonEntity[],
  personFacts: SidecarPersonFact[],
  personDossiers: Record<string, PersonDossier>,
): Entity[] => {
  const next = new Map<string, Entity>();

  entities.forEach((entity) => {
    next.set(normalizeName(entity.name), entity);
  });

  personEntities.forEach((person) => {
    const uiEntity = buildUiEntityFromPersonEntity(person, personFacts, personDossiers);
    const key = normalizeName(uiEntity.name);
    const existing = next.get(key);
    if (!existing) {
      next.set(key, uiEntity);
      return;
    }

    next.set(key, {
      ...existing,
      id: person.entityId,
      type: "PERSON",
      confidence: Math.max(existing.confidence || 0, uiEntity.confidence || 0),
      aliases: Array.from(new Set([...(existing.aliases || []), ...(uiEntity.aliases || []), existing.name, uiEntity.name])),
      evidence: Array.from(new Set([...(existing.evidence || []), ...(uiEntity.evidence || [])])).slice(0, 6),
      description: uiEntity.description || existing.description,
      salience: Math.max(existing.salience || 0, uiEntity.salience || 0),
    });
  });

  return Array.from(next.values());
};

const attachPersonDossiersToContextCards = (
  cards: Record<string, ContextCard>,
  entities: Entity[],
  personDossiers: Record<string, PersonDossier>,
): Record<string, ContextCard> => {
  const next = { ...cards };
  entities.forEach((entity) => {
    if (entity.type !== "PERSON") return;
    const dossier =
      personDossiers[entity.id] ||
      Object.values(personDossiers).find((candidate) => normalizeName(candidate.canonicalName) === normalizeName(entity.name));
    if (!dossier) return;
    const existing = next[entity.name];
    next[entity.name] = {
      ...(existing || {
        entityName: entity.name,
        summary: "",
        key_mentions: [],
        role_in_document: "",
      }),
      aliases: Array.from(new Set([...(existing?.aliases || []), ...(dossier.aliases || []), entity.name])),
      affiliation:
        dossier.organizations[0] ||
        existing?.affiliation ||
        "Unknown",
      extended_profile:
        [
          "## Person Dossier",
          dossier.roles.length ? `- Roles: ${dossier.roles.join(", ")}` : "",
          dossier.organizations.length ? `- Organizations: ${dossier.organizations.join(", ")}` : "",
          dossier.locations.length ? `- Locations: ${dossier.locations.join(", ")}` : "",
          dossier.dates.length ? `- Dates: ${dossier.dates.join(", ")}` : "",
          dossier.relationships.length
            ? `## Relationships\n${dossier.relationships.map((item) => `- ${item.type}: ${item.target} (${Math.round(item.confidence * 100)}%)`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      personDossier: dossier,
    };
  });
  return next;
};

const resolveReferenceProfileForEntity = (
  entity: Entity,
  referenceKnowledge?: Record<string, ReferenceKnowledgeProfile>,
): ReferenceKnowledgeProfile | undefined => {
  if (!referenceKnowledge) return undefined;
  return (
    referenceKnowledge[entity.id] ||
    Object.values(referenceKnowledge).find(
      (profile) =>
        normalizeName(profile.entity_id) === normalizeName(entity.id) ||
        normalizeName(profile.canonical_name) === normalizeName(entity.name) ||
        normalizeName(profile.ftm_id) === normalizeName(entity.ftm_id || ""),
    )
  );
};

const resolveCanonicalFtMEntity = (
  entity: Entity,
  canonicalEntities?: CanonicalFtMEntity[],
): CanonicalFtMEntity | undefined =>
  canonicalEntities?.find(
    (candidate) =>
      candidate.source_entity_ids.includes(entity.id) ||
      normalizeName(candidate.caption) === normalizeName(entity.name) ||
      normalizeName(candidate.ftm_id) === normalizeName(entity.ftm_id || ""),
  );

const deriveWatchlistStatus = (entity: Entity, watchlistHits: WatchlistHit[] = []): Entity["watchlist_status"] => {
  const entityHits = watchlistHits.filter(
    (hit) => hit.entity_id === entity.id || hit.canonical_ftm_id === entity.ftm_id,
  );
  if (!entityHits.length) return entity.watchlist_status;
  if (entityHits.some((hit) => hit.status === "match")) return "match";
  if (entityHits.some((hit) => hit.status === "candidate")) return "candidate";
  return "clear";
};

const mergeKnowledgeIntoEntities = (
  entities: Entity[],
  knowledge?: KnowledgeEnrichmentResult | null,
): Entity[] => {
  if (!knowledge) return entities;
  return entities.map((entity) => {
    const canonicalEntity = resolveCanonicalFtMEntity(entity, knowledge.canonical_entities);
    const referenceProfile = resolveReferenceProfileForEntity(entity, knowledge.reference_knowledge);
    const referenceConfidence = Math.max(
      entity.reference_confidence || 0,
      ...(referenceProfile?.links || []).map((link) => link.match_confidence),
      0,
    );

    return {
      ...entity,
      ftm_schema: canonicalEntity?.schema || entity.ftm_schema,
      ftm_id: canonicalEntity?.ftm_id || entity.ftm_id,
      aliases: Array.from(new Set([...(entity.aliases || []), ...(canonicalEntity?.aliases || []), ...(referenceProfile?.aliases || []), entity.name])).filter(Boolean),
      external_refs: referenceProfile?.links?.length ? referenceProfile.links : entity.external_refs,
      reference_confidence: referenceProfile?.links?.length ? referenceConfidence : entity.reference_confidence,
      watchlist_status: deriveWatchlistStatus(
        {
          ...entity,
          ftm_id: canonicalEntity?.ftm_id || entity.ftm_id,
        },
        knowledge.watchlist_hits,
      ),
    };
  });
};

const attachReferenceProfilesToContextCards = (
  cards: Record<string, ContextCard>,
  entities: Entity[],
  referenceKnowledge?: Record<string, ReferenceKnowledgeProfile>,
): Record<string, ContextCard> => {
  if (!referenceKnowledge) return cards;
  const next = { ...cards };
  entities.forEach((entity) => {
    const profile = resolveReferenceProfileForEntity(entity, referenceKnowledge);
    if (!profile) return;
    const existing = next[entity.name];
    next[entity.name] = {
      ...(existing || {
        entityName: entity.name,
        summary: "",
        key_mentions: entity.evidence || [],
        role_in_document: "",
      }),
      aliases: Array.from(new Set([...(existing?.aliases || []), ...(entity.aliases || []), ...profile.aliases, entity.name])).filter(Boolean),
      referenceProfile: profile,
    };
  });
  return next;
};

const resolveEntityProfileForUiEntity = (
  entity: Entity,
  intelligence?: EntityIntelligenceCaseResult,
): EntityProfileRecord | undefined => {
  if (!intelligence) return undefined;
  return (
    intelligence.entity_profiles[entity.id] ||
    Object.values(intelligence.entity_profiles).find(
      (profile) =>
        normalizeName(profile.entity_id) === normalizeName(entity.id) ||
        normalizeName(profile.canonical_name) === normalizeName(entity.name) ||
        profile.aliases.some((alias) => normalizeName(alias) === normalizeName(entity.name)),
    )
  );
};

const mergeEntityIntelligenceIntoEntities = (
  entities: Entity[],
  intelligence?: EntityIntelligenceCaseResult,
): Entity[] => {
  if (!intelligence) return entities;
  return entities.map((entity) => {
    const profile = resolveEntityProfileForUiEntity(entity, intelligence);
    if (!profile) return entity;
    return {
      ...entity,
      aliases: Array.from(new Set([...(entity.aliases || []), ...(profile.aliases || []), entity.name])).filter(Boolean),
      confidence: Math.max(entity.confidence || 0, profile.overall_confidence),
      confidence_band: profile.confidence_band,
      review_state:
        intelligence.canonical_entities.find((candidate) => candidate.id === profile.entity_id)?.review_state || entity.review_state,
    };
  });
};

const attachEntityProfilesToContextCards = (
  cards: Record<string, ContextCard>,
  entities: Entity[],
  intelligence?: EntityIntelligenceCaseResult,
): Record<string, ContextCard> => {
  if (!intelligence) return cards;
  const next = { ...cards };
  entities.forEach((entity) => {
    const profile = resolveEntityProfileForUiEntity(entity, intelligence);
    if (!profile) return;
    const existing = next[entity.name];
    next[entity.name] = {
      ...(existing || {
        entityName: entity.name,
        summary: "",
        key_mentions: entity.evidence || [],
        role_in_document: "",
      }),
      aliases: Array.from(new Set([...(existing?.aliases || []), ...(profile.aliases || []), entity.name])).filter(Boolean),
      entityProfile: profile,
    };
  });
  return next;
};

const applyReferenceKnowledgeToPersonEntities = (
  entities: SidecarPersonEntity[],
  warnings: string[],
  referenceKnowledge?: Record<string, ReferenceKnowledgeProfile>,
): { entities: SidecarPersonEntity[]; warnings: string[] } => {
  if (!referenceKnowledge) {
    return { entities, warnings };
  }

  const nextWarnings = [...warnings];
  const nextEntities = entities.map((entity) => {
    const profile =
      referenceKnowledge[entity.entityId] ||
      Object.values(referenceKnowledge).find(
        (candidate) =>
          normalizeName(candidate.entity_id) === normalizeName(entity.entityId) ||
          normalizeName(candidate.canonical_name) === normalizeName(entity.canonicalName),
      );

    if (!profile || profile.ftm_schema !== "Person") {
      return entity;
    }

    if (profile.watchlist_hits.some((hit) => hit.status === "match")) {
      nextWarnings.push(`${entity.canonicalName}: watchlist match retained in the reference lane.`);
    } else if (profile.watchlist_hits.some((hit) => hit.status === "candidate")) {
      nextWarnings.push(`${entity.canonicalName}: watchlist candidate retained in the reference lane.`);
    }

    return {
      ...entity,
      aliases: Array.from(new Set([...entity.aliases, ...profile.aliases])),
      confidence: Math.max(entity.confidence, ...profile.links.map((link) => Math.min(0.96, link.match_confidence))),
    };
  });

  return {
    entities: nextEntities,
    warnings: Array.from(new Set(nextWarnings)),
  };
};

const buildUiEntityFromMention = (mention: SidecarMention, index: number): Entity => {
  const aliases = Array.from(new Set([mention.mention_text, mention.normalized_text])).filter(Boolean);
  const evidenceSnippet = mention.evidence.raw_supporting_snippet || mention.evidence.normalized_supporting_snippet;

  return {
    id: mention.entity_id || mention.mention_id || `smart_mention_${index}_${stableHash(`${mention.entity_type}:${mention.mention_text}`)}`,
    name: mention.mention_text,
    type: toEntityType(mention.entity_type || mention.label),
    description: mention.role || `Extracted from ${mention.metadata?.source_extractor || mention.extraction_source} mention evidence`,
    confidence: mention.confidence,
    aliases,
    salience: Math.min(1, 0.3 + mention.confidence * 0.7),
    evidence: evidenceSnippet ? [evidenceSnippet] : [],
    source_chunks: typeof mention.metadata?.ordinal === "number" ? [mention.metadata.ordinal] : [],
  };
};

function isEntityTypeOrNameMatch(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

const mapSidecarEntitiesToUiEntities = (sourceText: string): Entity[] => {
  const sourceDocId = `analysis_${stableHash(sourceText.slice(0, 200))}`;
  const payload = runFastExtractionPipeline(sourceDocId, sourceText);
  const mentionsByEntityId = new Map<string, SidecarMention[]>();

  payload.mentions.forEach((mention) => {
    if (!mention.entity_id) return;
    const list = mentionsByEntityId.get(mention.entity_id) || [];
    list.push(mention);
    mentionsByEntityId.set(mention.entity_id, list);
  });

  return payload.entities.map((entity: SidecarEntityRecord, index) => {
    const mentions = mentionsByEntityId.get(entity.entity_id) || [];
    const evidence = buildEntityEvidenceFromMentions(mentions);
    const aliases = Array.from(new Set([entity.canonical_name, ...entity.aliases])).filter(Boolean);

    return {
      id: entity.entity_id || `sidecar_${stableHash(`${entity.entity_type}:${entity.canonical_name}:${index}`)}`,
      name: entity.canonical_name,
      type: toEntityType(entity.entity_type),
      description: `Detected from ${mentions.length || entity.mention_ids.length} document mentions`,
      confidence: entity.confidence,
      aliases,
      salience: Math.min(1, 0.35 + Math.min(0.6, (mentions.length || entity.mention_ids.length) * 0.08)),
      evidence: evidence.length ? evidence : extractEvidenceSnippets(sourceText, aliases),
      source_chunks: mentions
        .map((mention) => mention.metadata?.ordinal)
        .filter((value): value is number => typeof value === "number"),
    };
  });
};

const buildBasePackageFromSmartPayload = (payload: SidecarExtractionPayload): IntelligencePackage => {
  const entityNameById = new Map<string, string>();
  const entitiesByKey = new Map<string, Entity>();

  const upsertEntity = (entity: Entity) => {
    if (!entity.name || isBlockedEntityName(entity.name)) return;
    const key = normalizeName(entity.name);
    const existing = entitiesByKey.get(key);
    if (!existing) {
      entitiesByKey.set(key, entity);
      return;
    }
    entitiesByKey.set(key, {
      ...existing,
      name: entity.name.length > existing.name.length ? entity.name : existing.name,
      type: typePriority(entity.type) > typePriority(existing.type) ? entity.type : existing.type,
      description: existing.description || entity.description,
      confidence: Math.max(existing.confidence || 0, entity.confidence || 0),
      aliases: Array.from(new Set([...(existing.aliases || []), ...(entity.aliases || []), existing.name, entity.name])).filter(Boolean),
      evidence: Array.from(new Set([...(existing.evidence || []), ...(entity.evidence || [])])).slice(0, 6),
      source_chunks: Array.from(new Set([...(existing.source_chunks || []), ...(entity.source_chunks || [])])),
      salience: Math.max(existing.salience || 0, entity.salience || 0),
    });
  };

  payload.entities.forEach((entity, index) => {
    entityNameById.set(entity.entity_id, entity.canonical_name);
    const aliases = Array.from(new Set([entity.canonical_name, ...entity.aliases])).filter(Boolean);
    upsertEntity({
      id: entity.entity_id || `smart_${stableHash(`${entity.canonical_name}:${index}`)}`,
      name: entity.canonical_name,
      type: toEntityType(entity.entity_type),
      description: `Extracted from ${entity.mention_ids.length} evidence-backed mentions`,
      confidence: entity.confidence,
      ftm_id: entity.canonical_ftm_id,
      ftm_schema: entity.canonical_ftm_schema as Entity["ftm_schema"],
      aliases,
      salience: Math.min(1, 0.35 + Math.min(0.55, entity.mention_ids.length * 0.08)),
      evidence: buildEntityEvidenceFromPayload(payload, entity.entity_id),
      source_chunks: [],
    });
  });

  payload.mentions
    .filter((mention) => !mention.entity_id || !entityNameById.has(mention.entity_id))
    .forEach((mention, index) => upsertEntity(buildUiEntityFromMention(mention, index)));

  const entities = Array.from(entitiesByKey.values()).sort(
    (left, right) =>
      (right.salience || 0) - (left.salience || 0) ||
      (right.confidence || 0) - (left.confidence || 0) ||
      right.name.length - left.name.length,
  );

  const resolveEntityName = (entityId: string): string => entityNameById.get(entityId) || entityId;

  const relations: Relation[] = payload.relation_candidates.map((relation) => ({
    source: resolveEntityName(relation.source_entity_id),
    target: resolveEntityName(relation.target_entity_id),
    type: relation.relation_type,
    confidence: relation.confidence,
    statement_id: relation.relation_id,
  })).filter((relation) => normalizeName(relation.source) && normalizeName(relation.source) !== normalizeName(relation.target));

  const claimToStatement = (claim: SidecarClaimCandidate, index: number): Statement => ({
    statement_id: claim.claim_id || `claim_${index}`,
    knowledge: "ASSESSMENT",
    category: "OTHER",
    statement_text: claim.claim_text,
    confidence: claim.confidence,
    assumption_flag: false,
    intelligence_gap: false,
    impact: claim.confidence >= 0.8 ? "HIGH" : "MEDIUM",
    operational_relevance: "MEDIUM",
    related_entities: [
      ...(claim.speaker_entity_ids || []).map(resolveEntityName),
      ...(claim.subject_entity_ids || []).map(resolveEntityName),
      ...(claim.object_entity_ids || []).map(resolveEntityName),
    ].filter(Boolean),
  });

  const relationToStatement = (relation: Relation, index: number): Statement => ({
    statement_id: `sidecar_rel_${index}_${stableHash(`${relation.source}:${relation.type}:${relation.target}`)}`,
    knowledge: "FACT",
    category:
      relation.type === "FUNDED"
        ? "FINANCIAL"
        : relation.type === "COMMUNICATED_WITH"
          ? "TACTICAL"
          : relation.type === "MOVED_TO"
            ? "LOGISTICAL"
            : "OTHER",
    statement_text: `${relation.source} ${relation.type.replace(/_/g, " ").toLowerCase()} ${relation.target}.`,
    confidence: relation.confidence,
    assumption_flag: false,
    intelligence_gap: false,
    impact: relation.confidence >= 0.85 ? "HIGH" : "MEDIUM",
    operational_relevance: relation.confidence >= 0.82 ? "HIGH" : "MEDIUM",
    related_entities: [relation.source, relation.target],
  });

  const eventRecords = buildTemporalEventRecords(
    payload.event_candidates,
    resolveEntityName,
    payload.source_parser?.published_at || payload.generated_at?.slice(0, 10),
  );
  const temporalRelations = buildTemporalRelations(eventRecords);
  const retrievalArtifacts = buildRetrievalArtifactsFromPayload(payload, eventRecords, relations, resolveEntityName);
  const summaryPanels = buildSummaryPanelsFromRetrievalArtifacts(retrievalArtifacts);

  return {
    clean_text: summaryPanels.case_brief?.summary_text || "",
    raw_text: payload.raw_text,
    word_count: payload.raw_text.split(/\s+/).filter(Boolean).length,
    entities,
    relations,
    insights: [],
    timeline: projectTimelineEvents(eventRecords),
    statements: [
      ...payload.claim_candidates.map(claimToStatement),
      ...relations.slice(0, 12).map(relationToStatement),
    ],
    intel_questions: [],
    intel_tasks: [],
    tactical_assessment: {
      ttps: [],
      recommendations: [],
      gaps: [],
    },
    context_cards: {},
    graph: buildGraph(entities, relations),
    reliability: 0.76,
    event_records: eventRecords,
    temporal_relations: temporalRelations,
    summary_panels: summaryPanels,
    retrieval_artifacts: retrievalArtifacts,
    canonical_entities: [],
    reference_knowledge: {},
    watchlist_hits: [],
    knowledge_sources: [],
    reference_warnings: [],
  };
};

const mergeEntities = (baseEntities: Entity[], sourceText: string): Entity[] => {
  const sidecarEntities = mapSidecarEntitiesToUiEntities(sourceText);
  const candidates = [
    ...EntityCreationEngine.extractDeterministicSignals(sourceText),
    ...extractHeuristicCandidates(sourceText),
  ];
  const entityMap = new Map<string, Entity>();

  const upsert = (entity: Entity) => {
    const normalizedType = toEntityType(entity.type);
    const cleanedName = sanitizeHeuristicName(entity.name, normalizedType);
    const inferredType = normalizedType === "PERSON" && cleanedName ? toEntityType(inferHeuristicType(cleanedName, normalizedType)) : normalizedType;
    const normalizedEntity = {
      ...entity,
      name: cleanedName || entity.name,
      type: inferredType,
    };
    if (!shouldRetainEntity(normalizedEntity)) return;
    const key = normalizeName(normalizedEntity.name);
    if (!key) return;
    const existing = entityMap.get(key);
    if (!existing) {
      entityMap.set(key, normalizedEntity);
      return;
    }

    entityMap.set(key, {
      ...existing,
      name: normalizedEntity.name.length > existing.name.length ? normalizedEntity.name : existing.name,
      type: typePriority(normalizedEntity.type) > typePriority(existing.type) ? normalizedEntity.type : existing.type,
      description: existing.description || normalizedEntity.description,
      confidence: Math.max(existing.confidence || 0, normalizedEntity.confidence || 0),
      aliases: Array.from(new Set([...(existing.aliases || []), ...(normalizedEntity.aliases || []), existing.name, normalizedEntity.name])),
      evidence: Array.from(new Set([...(existing.evidence || []), ...(normalizedEntity.evidence || [])])).slice(0, 4),
      source_chunks: Array.from(new Set([...(existing.source_chunks || []), ...(normalizedEntity.source_chunks || [])])).sort((a, b) => a - b),
      salience: Math.max(existing.salience || 0, normalizedEntity.salience || 0),
    });
  };

  baseEntities.forEach((entity) =>
    upsert({
      ...entity,
      type: toEntityType(entity.type),
      aliases: Array.from(new Set([...(entity.aliases || []), entity.name])),
      evidence: entity.evidence?.length ? entity.evidence : extractEvidenceSnippets(sourceText, [entity.name, ...(entity.aliases || [])]),
    }),
  );

  sidecarEntities.forEach((entity) =>
    upsert({
      ...entity,
      type: toEntityType(entity.type),
      aliases: Array.from(new Set([...(entity.aliases || []), entity.name])),
      evidence: entity.evidence?.length ? entity.evidence : extractEvidenceSnippets(sourceText, [entity.name, ...(entity.aliases || [])]),
    }),
  );

  candidates.forEach((candidate, index) => {
    if (isBlockedEntityName(candidate.name)) return;
    const aliases = [candidate.name];
    const evidence = extractEvidenceSnippets(sourceText, aliases);
    upsert({
      id: `det_${stableHash(`${candidate.type}:${candidate.name}:${index}`)}`,
      name: candidate.name,
      type: toEntityType(candidate.type),
      description: candidate.role || (isHebrewDominant(sourceText) ? `זוהה כ-${toEntityType(candidate.type)}` : `Detected as ${toEntityType(candidate.type)}`),
      confidence: candidate.confidence || 0.66,
      aliases: Array.from(new Set([...(candidate.aliases || []), ...aliases])),
      salience: Math.min(1, (candidate.confidence || 0.66) * 0.9),
      evidence,
      source_chunks: [],
    });
  });

  return Array.from(entityMap.values())
    .filter(shouldRetainEntity)
    .sort(
    (a, b) =>
      (b.salience || 0) - (a.salience || 0) ||
      (b.evidence?.length || 0) - (a.evidence?.length || 0) ||
      b.name.length - a.name.length,
  );
};

const detectSentenceEntities = (sentence: string, entities: Entity[]): Array<{ entity: Entity; index: number }> => {
  const hits = entities
    .flatMap((entity) =>
      [entity.name, ...(entity.aliases || [])]
        .filter(Boolean)
        .map((alias) => ({ entity, alias, index: sentence.toLowerCase().indexOf(alias.toLowerCase()) }))
        .filter((hit) => hit.index >= 0),
    )
    .sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = normalizeName(hit.entity.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const deriveRelations = (sourceText: string, entities: Entity[], baseRelations: Relation[]): Relation[] => {
  const relationMap = new Map<string, Relation>();

  const upsert = (relation: Relation) => {
    if (!relation.source || !relation.target || normalizeName(relation.source) === normalizeName(relation.target)) return;
    const normalizedType = relation.type || "ASSOCIATED_WITH";
    if (normalizedType === "CO_MENTION_SAME_TEXT_UNIT") return;
    const key = `${normalizeName(relation.source)}|${normalizedType}|${normalizeName(relation.target)}`;
    const existing = relationMap.get(key);
    if (!existing || relation.confidence > existing.confidence) {
      relationMap.set(key, relation);
    }
  };

  baseRelations.forEach((relation) =>
    upsert({
      ...relation,
      source: relation.source,
      target: relation.target,
      type: relation.type || "ASSOCIATED_WITH",
      confidence: relation.confidence || 0.7,
    }),
  );

  splitSentences(sourceText).forEach((sentence, sentenceIndex) => {
    const sentenceEntities = detectSentenceEntities(sentence, entities);
    if (sentenceEntities.length < 2) return;

    RELATION_CUES.forEach(({ terms, type }) => {
      const cueIndex = terms
        .map((term) => sentence.toLowerCase().indexOf(term))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0];
      if (cueIndex == null) return;

      const left = [...sentenceEntities].reverse().find((hit) => hit.index <= cueIndex);
      const right = sentenceEntities.find((hit) => hit.index > cueIndex);
      if (!left || !right) return;

      upsert({
        source: left.entity.name,
        target: right.entity.name,
        type,
        confidence: type === "FUNDED" ? 0.86 : type === "COMMUNICATED_WITH" ? 0.82 : 0.74,
        statement_id: `rel_${stableHash(`${sentenceIndex}:${left.entity.name}:${type}:${right.entity.name}`)}`,
      });
    });
  });

  return Array.from(relationMap.values()).sort((a, b) => b.confidence - a.confidence);
};

const buildEntityExtendedProfile = (
  entity: Entity,
  relations: Relation[],
  timeline: TimelineEvent[],
  statements: Statement[],
  intelQuestions: IntelQuestion[],
  intelTasks: IntelTask[],
  sourceText: string,
): string | undefined => {
  const hebrew = isHebrewDominant(sourceText);
  const snippets = (entity.evidence?.length ? entity.evidence : extractEvidenceSnippets(sourceText, [entity.name, ...(entity.aliases || [])])).slice(0, 3);
  const relatedTimeline = timeline.filter((event) => event.event.toLowerCase().includes(entity.name.toLowerCase())).slice(0, 3);
  const relatedStatements = statements
    .filter((statement) => (statement.related_entities || []).some((name) => isEntityTypeOrNameMatch(name, entity.name)))
    .slice(0, 3);
  const relatedQuestions = intelQuestions
    .filter((question) => question.question_text.toLowerCase().includes(entity.name.toLowerCase()))
    .slice(0, 2);
  const relatedTasks = intelTasks
    .filter((task) => task.task_text.toLowerCase().includes(entity.name.toLowerCase()))
    .slice(0, 2);

  const lines: string[] = [];

  if (snippets.length) {
    lines.push("## Evidence Highlights");
    snippets.forEach((snippet) => lines.push(`- ${snippet}`));
  }

  if (relations.length) {
    lines.push("## Network Links");
    relations.slice(0, 5).forEach((relation) => {
      const counterparty = normalizeName(relation.source) === normalizeName(entity.name) ? relation.target : relation.source;
      lines.push(`- ${relation.type}: ${counterparty} (${Math.round(relation.confidence * 100)}%)`);
    });
  }

  if (relatedTimeline.length) {
    lines.push("## Timeline Anchors");
    relatedTimeline.forEach((event) => lines.push(`- ${event.date}: ${event.event}`));
  }

  if (relatedStatements.length) {
    lines.push("## Working Assessment");
    relatedStatements.forEach((statement) => lines.push(`- ${statement.statement_text}`));
  }

  if (relatedQuestions.length || relatedTasks.length) {
    lines.push("## Research Leads");
    relatedQuestions.forEach((question) => lines.push(`- Question: ${question.question_text}`));
    relatedTasks.forEach((task) => lines.push(`- Task: ${task.task_text}`));
  }

  if (!lines.length) {
    return snippets[0] || (hebrew ? `${entity.name} זוהה במסמך אך עדיין חסר הקשר מחקרי עשיר יותר.` : `${entity.name} was detected in the document, but richer analytical context is still limited.`);
  }

  return lines.join("\n");
};

const buildGeneratedContextCard = (
  entity: Entity,
  relations: Relation[],
  timeline: TimelineEvent[],
  statements: Statement[],
  intelQuestions: IntelQuestion[],
  intelTasks: IntelTask[],
  sourceText: string,
  existingCard?: ContextCard,
): ContextCard => {
  const hebrew = isHebrewDominant(sourceText);
  const snippets = entity.evidence?.length ? entity.evidence : extractEvidenceSnippets(sourceText, [entity.name, ...(entity.aliases || [])]);
  const relationSummary = relations.slice(0, 4).map((relation) => {
    const counterparty = normalizeName(relation.source) === normalizeName(entity.name) ? relation.target : relation.source;
    return `${relation.type} ${counterparty}`;
  });
  const relatedTimeline = timeline.filter((event) => event.event.toLowerCase().includes(entity.name.toLowerCase())).slice(0, 2);
  const relatedOrg = relations
    .map((relation) => (normalizeName(relation.source) === normalizeName(entity.name) ? relation.target : relation.source))
    .find((name) => {
      const matched = entity.aliases?.find((alias) => normalizeName(alias) === normalizeName(name));
      return !matched;
    });
  const significance =
    relations.length >= 8 || (entity.salience || 0) >= 0.9
      ? "CRITICAL"
      : relations.length >= 4 || (entity.salience || 0) >= 0.7
        ? "HIGH"
        : relations.length >= 2 || (entity.salience || 0) >= 0.45
          ? "MEDIUM"
          : "LOW";

  const generatedSummary = [
    entity.description ||
      (hebrew
        ? `${entity.name} סווג כ-${entity.type} עם ${relations.length} קשרים ישירים שניתן לעגן בראיות.`
        : `${entity.name} was classified as ${entity.type} with ${relations.length} direct evidence-backed links.`),
    relationSummary.length
      ? hebrew
        ? `הקשרים הבולטים: ${relationSummary.slice(0, 3).join("; ")}.`
        : `Top observed links: ${relationSummary.slice(0, 3).join("; ")}.`
      : "",
    relatedTimeline[0]
      ? hebrew
        ? `עוגן הזמן הקרוב ביותר: ${relatedTimeline[0].date} - ${relatedTimeline[0].event}`
        : `Closest timeline anchor: ${relatedTimeline[0].date} - ${relatedTimeline[0].event}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const summary =
    existingCard?.summary && !isPlaceholderContextText(existingCard.summary)
      ? existingCard.summary
      : generatedSummary;

  const keyMentions = Array.from(
    new Set([...(existingCard?.key_mentions || []), ...snippets].filter(Boolean)),
  ).slice(0, 6);

  return {
    entityName: entity.name,
    type: entity.type,
    summary,
    key_mentions: keyMentions,
    role_in_document:
      existingCard?.role_in_document ||
      (relationSummary.length
        ? hebrew
          ? `מקושר דרך ${relationSummary.slice(0, 3).join(", ")}.`
          : `Linked via ${relationSummary.slice(0, 3).join(", ")}.`
        : hebrew
          ? `זוהה במסמך כ-${entity.type}.`
          : `Detected in the document as ${entity.type}.`),
    extended_profile:
      existingCard?.extended_profile && !isPlaceholderContextText(existingCard.extended_profile)
        ? existingCard.extended_profile
        : buildEntityExtendedProfile(entity, relations, timeline, statements, intelQuestions, intelTasks, sourceText),
    significance: existingCard?.significance || significance,
    affiliation:
      existingCard?.affiliation ||
      (relatedOrg
        ? hebrew
          ? `קשור ל-${relatedOrg}`
          : `Linked to ${relatedOrg}`
        : entity.aliases?.length
          ? hebrew
            ? `כינויים/וריאנטים: ${entity.aliases.join(", ")}`
            : `Aliases: ${entity.aliases.join(", ")}`
          : hebrew
            ? "לא ידוע"
            : "Unknown"),
    aliases: Array.from(new Set([...(existingCard?.aliases || []), ...(entity.aliases || []), entity.name])).filter(Boolean),
    status: existingCard?.status || "UNKNOWN",
    isShallow: false,
    id: existingCard?.id,
    score: existingCard?.score,
    referenceProfile: existingCard?.referenceProfile,
  };
};

const buildContextCards = (
  entities: Entity[],
  relations: Relation[],
  timeline: TimelineEvent[],
  statements: Statement[],
  intelQuestions: IntelQuestion[],
  intelTasks: IntelTask[],
  sourceText: string,
  baseCards: Record<string, ContextCard> = {},
): Record<string, ContextCard> => {
  const relationLookup = new Map<string, Relation[]>();
  relations.forEach((relation) => {
    const sourceList = relationLookup.get(relation.source) || [];
    sourceList.push(relation);
    relationLookup.set(relation.source, sourceList);

    const targetList = relationLookup.get(relation.target) || [];
    targetList.push(relation);
    relationLookup.set(relation.target, targetList);
  });

  return entities.reduce<Record<string, ContextCard>>((cards, entity) => {
    const existingCard =
      baseCards[entity.name] ||
      Object.entries(baseCards).find(([name]) => normalizeName(name) === normalizeName(entity.name))?.[1];
    cards[entity.name] = buildGeneratedContextCard(
      entity,
      relationLookup.get(entity.name) || [],
      timeline,
      statements,
      intelQuestions,
      intelTasks,
      sourceText,
      existingCard,
    );
    return cards;
  }, {});
};

export const buildEntityContextCardFromPackage = (
  pkg: IntelligencePackage,
  entityIdOrName: string,
): ContextCard | null => {
  const entity =
    pkg.entities.find((item) => item.id === entityIdOrName || normalizeName(item.name) === normalizeName(entityIdOrName)) || null;
  if (!entity) return null;
  const entityRelations = (pkg.relations || []).filter(
    (relation) => normalizeName(relation.source) === normalizeName(entity.name) || normalizeName(relation.target) === normalizeName(entity.name),
  );
  const baseCards = pkg.context_cards || {};
  const dossier =
    entity.type === "PERSON"
      ? pkg.person_dossiers?.[entity.id] ||
        Object.values(pkg.person_dossiers || {}).find((candidate) => normalizeName(candidate.canonicalName) === normalizeName(entity.name))
      : undefined;
  const existingCard =
    baseCards[entity.name] || Object.entries(baseCards).find(([name]) => normalizeName(name) === normalizeName(entity.name))?.[1];
  const referenceProfile = resolveReferenceProfileForEntity(entity, pkg.reference_knowledge);
  const entityProfile = resolveEntityProfileForUiEntity(entity, pkg.entity_intelligence);

  const dossierCard =
    dossier &&
    ({
      entityName: entity.name,
      type: "PERSON",
      summary: existingCard?.summary || `${entity.name} surfaced as a backend-resolved person entity with evidence-linked facts.`,
      key_mentions: existingCard?.key_mentions || entity.evidence || [],
      role_in_document: existingCard?.role_in_document || "Evidence-backed person dossier available.",
      aliases: Array.from(new Set([...(existingCard?.aliases || []), ...(dossier.aliases || []), entity.name])),
      affiliation: dossier.organizations[0] || existingCard?.affiliation || "Unknown",
      extended_profile: existingCard?.extended_profile,
      personDossier: dossier,
      significance: existingCard?.significance,
      status: existingCard?.status,
      referenceProfile: existingCard?.referenceProfile || referenceProfile,
      entityProfile: existingCard?.entityProfile || entityProfile,
    } satisfies ContextCard);

  return buildGeneratedContextCard(
    entity,
    entityRelations,
    pkg.timeline || [],
    pkg.statements || [],
    pkg.intel_questions || [],
    pkg.intel_tasks || [],
    pkg.raw_text || pkg.clean_text || "",
    dossierCard ||
      (referenceProfile || entityProfile
        ? { ...existingCard, referenceProfile: referenceProfile || existingCard?.referenceProfile, entityProfile: entityProfile || existingCard?.entityProfile }
        : existingCard),
  );
};

const buildTimeline = (sourceText: string, entities: Entity[], relations: Relation[], baseTimeline: TimelineEvent[]): TimelineEvent[] => {
  const hebrew = isHebrewDominant(sourceText);
  const events = new Map<string, TimelineEvent>();
  const addEvent = (date: string, event: string) => {
    const normalizedDate = normalizeDate(date);
    const key = `${normalizedDate}|${event}`;
    if (!events.has(key)) {
      events.set(key, { date: normalizedDate, event });
    }
  };

  baseTimeline.forEach((event) => addEvent(event.date, event.event));

  splitSentences(sourceText).forEach((sentence) => {
    const dates = detectDates(sentence);
    if (!dates.length) return;
    const sentenceEntities = detectSentenceEntities(sentence, entities)
      .map((item) => item.entity)
      .filter((entity) => isSubstantiveEntityType(entity.type))
      .map((entity) => entity.name);
    const relation = relations.find((candidate) => sentence.toLowerCase().includes(candidate.source.toLowerCase()) && sentence.toLowerCase().includes(candidate.target.toLowerCase()));
    const eventText =
      relation
        ? `${relation.source} ${relation.type.toLowerCase()} ${relation.target}.`
        : sentenceEntities.length
          ? sentence.trim().length <= 220
            ? sentence.trim()
            : hebrew
              ? `${sentenceEntities.slice(0, 3).join(", ")} הוזכרו בפעילות המתועדת.`
              : `${sentenceEntities.slice(0, 3).join(", ")} referenced in document activity.`
          : sentence;
    dates.forEach((date) => addEvent(date, eventText));
  });

  if (events.size < 3) {
    relations
      .filter((relation) => relation.type !== "ASSOCIATED_WITH")
      .slice(0, 6)
      .forEach((relation, index) => {
        addEvent(
          `9999-12-${String(index + 1).padStart(2, "0")}`,
          hebrew
            ? `${relation.source} ${relation.type.toLowerCase()} ${relation.target}.`
            : `${relation.source} ${relation.type.toLowerCase()} ${relation.target}.`,
        );
      });
  }

  if (events.size === 0) {
    pickLeadEntities(entities, 4)
      .forEach((entity, index) => {
        addEvent(
          `9999-11-${String(index + 1).padStart(2, "0")}`,
          hebrew
            ? `${entity.name} הופיע כעוגן מחקרי במסמך ונדרש להמשך בדיקה.`
            : `${entity.name} surfaced as a document anchor requiring follow-on review.`,
        );
      });
  }

  return Array.from(events.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 25);
};

const buildStatements = (relations: Relation[], timeline: TimelineEvent[], entities: Entity[], sourceText: string, baseStatements: Statement[] = []): Statement[] => {
  const hebrew = isHebrewDominant(sourceText);
  const statements = [...baseStatements];
  const seen = new Set(baseStatements.map((statement) => statement.statement_text));

  relations.slice(0, 12).forEach((relation, index) => {
    const text = `${relation.source} ${relation.type.replace(/_/g, " ").toLowerCase()} ${relation.target}.`;
    if (seen.has(text)) return;
    seen.add(text);
    statements.push({
      statement_id: `stmt_rel_${index}_${stableHash(text)}`,
      knowledge: "FACT",
      category:
        relation.type === "FUNDED"
          ? "FINANCIAL"
          : relation.type === "COMMUNICATED_WITH"
            ? "TACTICAL"
            : relation.type === "MOVED_TO"
              ? "LOGISTICAL"
              : "OTHER",
      statement_text: text,
      confidence: relation.confidence,
      assumption_flag: false,
      intelligence_gap: false,
      impact: relation.confidence >= 0.85 ? "HIGH" : "MEDIUM",
      operational_relevance: relation.confidence >= 0.82 ? "HIGH" : "MEDIUM",
      related_entities: [relation.source, relation.target],
    });
  });

  if (!statements.length && entities.length) {
    statements.push({
      statement_id: `stmt_summary_${stableHash(sourceText.slice(0, 80))}`,
      knowledge: "ASSESSMENT",
      category: "OTHER",
      statement_text: hebrew
        ? `במסמך שהועלה זוהו ${entities.length} ישויות מובחנות בעלות ערך מחקרי.`
        : `${entities.length} distinct intelligence entities were identified in the uploaded document.`,
      confidence: 0.7,
      assumption_flag: false,
      intelligence_gap: false,
      impact: "MEDIUM",
      operational_relevance: "MEDIUM",
      related_entities: entities.slice(0, 6).map((entity) => entity.name),
    });
  }

  timeline.slice(0, 3).forEach((event, index) => {
    const text = `${event.date}: ${event.event}`;
    if (seen.has(text)) return;
    seen.add(text);
    statements.push({
      statement_id: `stmt_timeline_${index}_${stableHash(text)}`,
      knowledge: "FACT",
      category: "TACTICAL",
      statement_text: text,
      confidence: 0.76,
      assumption_flag: false,
      intelligence_gap: false,
      impact: "MEDIUM",
      operational_relevance: "HIGH",
      related_entities: entities.filter((entity) => event.event.toLowerCase().includes(entity.name.toLowerCase())).slice(0, 4).map((entity) => entity.name),
    });
  });

  return statements.slice(0, 20);
};

const buildInsights = (entities: Entity[], relations: Relation[], timeline: TimelineEvent[], baseInsights: Insight[] = []): Insight[] => {
  const hebrew = entities.some((entity) => hasHebrew(entity.name));
  const insights = [...baseInsights];
  const seen = new Set(baseInsights.map((insight) => insight.text));
  const typeCounts = entities.reduce<Record<string, number>>((acc, entity) => {
    acc[entity.type] = (acc[entity.type] || 0) + 1;
    return acc;
  }, {});

  const generated: Insight[] = [
    {
      type: "summary",
      importance: 0.92,
      text: hebrew
        ? `זוהו ${entities.length} ישויות מובחנות על פני ${Object.keys(typeCounts).length} קטגוריות מודיעיניות.`
        : `Detected ${entities.length} distinct entities across ${Object.keys(typeCounts).length} intelligence categories.`,
    },
    relations.find((relation) => relation.type === "FUNDED")
      ? {
          type: "pattern",
          importance: 0.9,
          text: hebrew
            ? `זוהה קשר מימוני: ${relations.find((relation) => relation.type === "FUNDED")!.source} מימן את ${relations.find((relation) => relation.type === "FUNDED")!.target}.`
            : `Financial linkage detected: ${relations.find((relation) => relation.type === "FUNDED")!.source} funded ${relations.find((relation) => relation.type === "FUNDED")!.target}.`,
        }
      : null,
    relations.find((relation) => relation.type === "COMMUNICATED_WITH")
      ? {
          type: "key_event",
          importance: 0.84,
          text: hebrew
            ? `זוהתה תקשורת בין ${relations.find((relation) => relation.type === "COMMUNICATED_WITH")!.source} לבין ${relations.find((relation) => relation.type === "COMMUNICATED_WITH")!.target}.`
            : `Communication activity surfaced between ${relations.find((relation) => relation.type === "COMMUNICATED_WITH")!.source} and ${relations.find((relation) => relation.type === "COMMUNICATED_WITH")!.target}.`,
        }
      : null,
    timeline[0]
      ? {
          type: "summary",
          importance: 0.76,
          text: hebrew ? `עוגן הזמן המוקדם ביותר: ${timeline[0].date} - ${timeline[0].event}` : `Earliest timeline anchor: ${timeline[0].date} - ${timeline[0].event}`,
        }
      : null,
  ].filter((item): item is Insight => Boolean(item));

  generated.forEach((insight) => {
    if (!seen.has(insight.text)) {
      seen.add(insight.text);
      insights.push(insight);
    }
  });

  return insights.slice(0, 12);
};

const buildTacticalAssessment = (entities: Entity[], relations: Relation[], timeline: TimelineEvent[], base?: TacticalAssessment): TacticalAssessment => {
  const hebrew = entities.some((entity) => hasHebrew(entity.name));
  const ttps = new Set(base?.ttps || []);
  const recommendations = new Set(base?.recommendations || []);
  const gaps = new Set(base?.gaps || []);

  if (relations.some((relation) => relation.type === "FUNDED")) ttps.add(hebrew ? "תמיכה או סיוע מימוני בין גורמים מזוהים" : "Financial facilitation between named actors");
  if (relations.some((relation) => relation.type === "COMMUNICATED_WITH")) ttps.add(hebrew ? "תקשורת תפעולית בין גורמים מזוהים" : "Operational communications between named actors");
  if (relations.some((relation) => relation.type === "MOVED_TO")) ttps.add(hebrew ? "תנועת לוגיסטיקה או ניתוב בין מיקומים" : "Movement or logistics routing through named locations");

  if (entities.some((entity) => entity.type === "ASSET")) recommendations.add(hebrew ? "לבצע pivot על נכסים טכניים, כתובות ופרטי קשר שחולצו" : "Review technical assets, addresses, and contact points for pivot opportunities");
  if (timeline.length > 0) recommendations.add(hebrew ? "לאמת את רצף הפעולות מול עוגני הזמן שחולצו" : "Validate the operational sequence against the extracted timeline anchors");
  if (relations.length > 0) recommendations.add(hebrew ? "לתעדף איסוף על הישויות המחוברות ביותר ועל קשרים מפורשים" : "Prioritize collection on the most connected entities and explicit typed relations");

  if (!timeline.length) gaps.add(hebrew ? "לא חולץ רצף מבצעי ברור עם תאריכים" : "No clear dated operational sequence was extracted");
  if (!relations.some((relation) => relation.type !== "ASSOCIATED_WITH")) gaps.add(hebrew ? "רוב הקשרים עדיין אסוציאטיביים ולא סיבתיים" : "Most links remain associative rather than causally explicit");
  if (!entities.some((entity) => entity.type === "LOCATION")) gaps.add(hebrew ? "כיסוי המיקומים עדיין דל ודורש מקורות נוספים" : "Location coverage remains thin and may require additional source material");

  return {
    ttps: Array.from(ttps).slice(0, 6),
    recommendations: Array.from(recommendations).slice(0, 6),
    gaps: Array.from(gaps).slice(0, 6),
  };
};

const buildQuestions = (timeline: TimelineEvent[], relations: Relation[], entities: Entity[], base: IntelQuestion[] = []): IntelQuestion[] => {
  const hebrew = entities.some((entity) => hasHebrew(entity.name));
  const questions = [...base];
  const seen = new Set(base.map((question) => question.question_text));
  const leadEntity = pickLeadEntities(entities, 1)[0];
  const candidates = [
    !timeline.length ? (hebrew ? "איזה מקור נוסף יכול לעגן את רצף האירועים בתאריכים חזקים יותר?" : "What source can anchor the sequence of events with stronger dates?") : "",
    relations.some((relation) => relation.type === "FUNDED") ? (hebrew ? "איזה מנגנון או ערוץ איפשר את הקשר המימוני שזוהה?" : "What mechanism or channel enabled the detected funding relationship?") : "",
    entities.some((entity) => entity.type === "ASSET") ? (hebrew ? "על אילו נכסים טכניים כדאי לבצע pivot קודם לצורך איסוף המשך?" : "Which technical assets should be pivoted first for follow-on collection?") : "",
    leadEntity ? (hebrew ? `מהו ההקשר הרחב יותר של ${leadEntity.name} בתוך התיק הנוכחי?` : `What broader role does ${leadEntity.name} play in the current case?`) : "",
  ].filter(Boolean);

  candidates.forEach((questionText, index) => {
    if (seen.has(questionText)) return;
    seen.add(questionText);
    questions.push({
      question_id: `iq_det_${index}_${stableHash(questionText)}`,
      question_text: questionText,
      priority: index === 0 ? "HIGH" : "MEDIUM",
      owner: "Research",
    });
  });

  return questions.slice(0, 8);
};

const buildTasks = (relations: Relation[], entities: Entity[], base: IntelTask[] = []): IntelTask[] => {
  const hebrew = entities.some((entity) => hasHebrew(entity.name));
  const tasks = [...base];
  const seen = new Set(base.map((task) => task.task_text));
  const leadEntity = pickLeadEntities(entities, 1)[0];
  const candidates = [
    relations.some((relation) => relation.type === "FUNDED") ? (hebrew ? "לאשש את הישויות הקשורות למימון מול רישומי פיננסים ורכש" : "Corroborate funding-linked entities against financial and procurement records") : "",
    relations.some((relation) => relation.type === "COMMUNICATED_WITH") ? (hebrew ? "לבדוק את ישויות התקשורת מול אנשי קשר ונכסים נוספים" : "Review communications-linked entities for additional associated contacts and assets") : "",
    entities.some((entity) => entity.type === "ASSET") ? (hebrew ? "לבצע pivot על הנכסים הטכניים שחולצו ולשמר את כל קטעי הראיה" : "Pivot on extracted technical assets and preserve all matching evidence snippets") : "",
    leadEntity ? (hebrew ? `להכין כרטיס מחקר מלא עבור ${leadEntity.name} ולשמר את כל קטעי הראיה המרכזיים` : `Prepare a full research card for ${leadEntity.name} and preserve the strongest evidence snippets`) : "",
  ].filter(Boolean);

  candidates.forEach((taskText, index) => {
    if (seen.has(taskText)) return;
    seen.add(taskText);
    tasks.push({
      task_id: `task_det_${index}_${stableHash(taskText)}`,
      task_text: taskText,
      urgency: index === 0 ? "HIGH" : "MEDIUM",
      status: "OPEN",
    });
  });

  return tasks.slice(0, 8);
};

const buildSummary = (sourceText: string, entities: Entity[], relations: Relation[], timeline: TimelineEvent[], insights: Insight[]): string => {
  const hebrew = isHebrewDominant(sourceText);
  const topEntities = pickLeadEntities(entities, 6).map((entity) => entity.name);
  const explicitRelations = relations.slice(0, 3).map((relation) => `${relation.source} ${relation.type.toLowerCase()} ${relation.target}`);
  const lines = [
    hebrew ? `זוהו ${entities.length} ישויות לאורך המסמך שהועלה.` : `Detected ${entities.length} entities across the uploaded document.`,
    topEntities.length ? (hebrew ? `הישויות הבולטות ביותר: ${topEntities.join(", ")}.` : `Most prominent entities: ${topEntities.join(", ")}.`) : "",
    explicitRelations.length ? (hebrew ? `הקשרים המפורשים המרכזיים: ${explicitRelations.join("; ")}.` : `Top explicit links: ${explicitRelations.join("; ")}.`) : "",
    timeline[0] ? (hebrew ? `עוגן הזמן המוקדם ביותר: ${timeline[0].date} - ${timeline[0].event}` : `Earliest timeline anchor: ${timeline[0].date} - ${timeline[0].event}`) : "",
    insights[0]?.text || "",
  ].filter(Boolean);
  return lines.join(" ");
};

export const enrichIntelligencePackage = (basePackage: IntelligencePackage, sourceText: string): IntelligencePackage => {
  const hebrew = isHebrewDominant(sourceText);
  const mergedEntities = mergeEntities(basePackage.entities || [], sourceText);
  const relations = deriveRelations(sourceText, mergedEntities, basePackage.relations || []);
  const timeline = buildTimeline(sourceText, mergedEntities, relations, basePackage.timeline || []);
  const statements = buildStatements(relations, timeline, mergedEntities, sourceText, basePackage.statements || []);
  const insights = buildInsights(mergedEntities, relations, timeline, basePackage.insights || []);
  const tacticalAssessment = buildTacticalAssessment(mergedEntities, relations, timeline, basePackage.tactical_assessment);
  const intelQuestions = buildQuestions(timeline, relations, mergedEntities, basePackage.intel_questions || []);
  const intelTasks = buildTasks(relations, mergedEntities, basePackage.intel_tasks || []);
  const contextCards = buildContextCards(
    mergedEntities,
    relations,
    timeline,
    statements,
    intelQuestions,
    intelTasks,
    sourceText,
    basePackage.context_cards || {},
  );
  const cleanText = buildSummary(sourceText, mergedEntities, relations, timeline, insights);
  const researchDossier = buildResearchDossier({
    ...basePackage,
    clean_text: cleanText || basePackage.clean_text || sourceText.slice(0, 180),
    raw_text: basePackage.raw_text || sourceText,
    word_count: sourceText.split(/\s+/).filter(Boolean).length,
    entities: mergedEntities,
    relations,
    statements,
    timeline,
    insights,
    context_cards: contextCards,
    tactical_assessment: tacticalAssessment,
    intel_questions: intelQuestions,
    intel_tasks: intelTasks,
    graph: buildGraph(mergedEntities, relations),
    reliability: Math.min(1, Math.max(basePackage.reliability || 0.72, relations.length ? 0.78 : 0.68)),
  });
  const researchContextCards = mergeResearchDossierIntoContextCards(contextCards, researchDossier, hebrew);
  const shouldPromoteResearchSummary = Boolean(basePackage.retrieval_artifacts || basePackage.summary_panels);

  return {
    ...basePackage,
    clean_text:
      (shouldPromoteResearchSummary ? researchDossier.executive_summary : "") ||
      cleanText ||
      basePackage.clean_text ||
      sourceText.slice(0, 180),
    raw_text: basePackage.raw_text || sourceText,
    word_count: sourceText.split(/\s+/).filter(Boolean).length,
    entities: mergedEntities,
    relations,
    statements,
    timeline,
    insights,
    context_cards: researchContextCards,
    tactical_assessment: tacticalAssessment,
    intel_questions: intelQuestions,
    intel_tasks: intelTasks,
    graph: buildGraph(mergedEntities, relations),
    reliability: Math.min(1, Math.max(basePackage.reliability || 0.72, relations.length ? 0.78 : 0.68)),
    research_dossier: researchDossier,
  };
};

const buildFastBasePackage = (text: string): IntelligencePackage => ({
  clean_text: "",
  raw_text: text,
  word_count: text.split(/\s+/).filter(Boolean).length,
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
  reliability: 0.55,
  canonical_entities: [],
  reference_knowledge: {},
  watchlist_hits: [],
  knowledge_sources: [],
  reference_warnings: [],
});

const LARGE_DOCUMENT_CHAR_THRESHOLD = 180_000;
const LARGE_DOCUMENT_SENTENCE_THRESHOLD = 1_800;
const RESPONSIVE_ANALYSIS_CHAR_LIMIT = 120_000;

const buildResponsiveAnalysisText = (text: string): string => {
  if (text.length <= RESPONSIVE_ANALYSIS_CHAR_LIMIT) {
    return text;
  }

  const headSize = Math.floor(RESPONSIVE_ANALYSIS_CHAR_LIMIT * 0.65);
  const tailSize = RESPONSIVE_ANALYSIS_CHAR_LIMIT - headSize;
  return `${text.slice(0, headSize)}\n\n[CONTENT TRUNCATED FOR RESPONSIVE FALLBACK ANALYSIS]\n\n${text.slice(-tailSize)}`;
};

const shouldBypassHeavyBackendAnalysis = (text: string): boolean =>
  text.length > LARGE_DOCUMENT_CHAR_THRESHOLD || splitSentences(text).length > LARGE_DOCUMENT_SENTENCE_THRESHOLD;

export const analyzeDocument = async (text: string): Promise<IntelligencePackage> => {
  const sanitizedText = sanitizeAnalysisInput(text);
  const analysisText = sanitizedText || text;
  const bypassHeavyBackend = shouldBypassHeavyBackendAnalysis(analysisText);
  const responsiveAnalysisText = bypassHeavyBackend ? buildResponsiveAnalysisText(analysisText) : analysisText;
  const caseId = `case_${stableHash(analysisText.slice(0, 400))}`;
  const provisionalDocumentId = `doc_${stableHash(analysisText.slice(0, 200))}`;
  const personChunks = bypassHeavyBackend ? [] : buildPersonChunks(analysisText);
  const detectedLanguage = isHebrewDominant(analysisText) ? "he" : "en";

  try {
    const [smartPayload, extractedPersons] = bypassHeavyBackend
      ? [null, null] as const
      : await Promise.all([
          analyzeWithLocalSidecar(analysisText, { source_type: "BROWSER_UPLOAD" }),
          extractPersonsWithSidecar({
            caseId,
            documentId: provisionalDocumentId,
            rawText: analysisText,
            chunks: personChunks,
            language: detectedLanguage,
          }),
        ]);
    let basePackage = smartPayload ? buildBasePackageFromSmartPayload(smartPayload) : buildFastBasePackage(analysisText);

    const documentId = smartPayload?.source_doc_id || provisionalDocumentId;
    let personEntities: SidecarPersonEntity[] = [];
    let personFacts: SidecarPersonFact[] = [];
    const personDossiers: Record<string, PersonDossier> = {};
    let knowledgeResult: KnowledgeEnrichmentResult | null = null;
    let entityIntelligence: EntityIntelligenceCaseResult | null = null;
    let personPipeline: IntelligencePackage["person_pipeline"] = {
      mode: "fallback",
      warnings: ["Person dossier pipeline unavailable; using browser heuristics fallback."],
    };

    if (bypassHeavyBackend) {
      personPipeline = {
        mode: "fallback",
        warnings: [
          "Large document detected; bypassed heavy backend extraction to keep analysis responsive.",
          "Using deterministic fallback analysis for this upload.",
        ],
      };
      basePackage = {
        ...basePackage,
        person_pipeline: personPipeline,
      };
    } else {
      if (extractedPersons) {
        const resolvedPersons = await resolvePersonsWithSidecar(caseId, extractedPersons);
        if (resolvedPersons) {
          personEntities = resolvedPersons.entities;
          personFacts = resolvedPersons.facts;
          Object.assign(personDossiers, resolvedPersons.dossiers || {});

          basePackage = {
            ...basePackage,
            entities: mergePersonPipelineIntoEntities(basePackage.entities || [], personEntities, personFacts, personDossiers),
            person_entities: personEntities,
            person_facts: personFacts,
            person_dossiers: personDossiers,
            person_pipeline: {
              mode: "backend",
              warnings: Array.from(new Set([
                ...(extractedPersons.warnings || []),
                ...(resolvedPersons.warnings || []),
                ...(!Object.keys(personDossiers).length
                  ? ["No persisted person dossiers were returned for this run; using resolved entities and facts only."]
                  : []),
              ])),
            },
          };
          personPipeline = basePackage.person_pipeline;
        } else {
          personPipeline = {
            mode: "fallback",
            warnings: [...(extractedPersons.warnings || []), "Person resolution failed; using browser heuristics fallback."],
          };
          basePackage = {
            ...basePackage,
            person_pipeline: personPipeline,
          };
        }
      } else {
        basePackage = {
          ...basePackage,
          person_pipeline: personPipeline,
          reference_warnings: [
            ...(basePackage.reference_warnings || []),
            "Large document detected; reference knowledge enrichment was deferred to keep analysis responsive.",
          ],
        };
      }
    }

    if (!bypassHeavyBackend && (basePackage.entities || []).length > 0) {
      knowledgeResult = await enrichKnowledgeWithSidecar({
        caseId,
        documentId,
        entities: (basePackage.entities || []).map((entity) => ({
          entity_id: entity.id,
          name: entity.name,
          type: entity.type,
          description: entity.description,
          confidence: entity.confidence,
          aliases: entity.aliases || [],
          evidence: entity.evidence || [],
          document_ids: [documentId],
        })),
        relations: (basePackage.relations || []).map((relation) => ({
          source: relation.source,
          target: relation.target,
          type: relation.type,
          confidence: relation.confidence,
        })),
        eventIds: (basePackage.event_records || []).map((event) => event.event_id),
      });

      if (knowledgeResult) {
        if (personEntities.length > 0) {
          const personMerge = applyReferenceKnowledgeToPersonEntities(
            personEntities,
            personPipeline?.warnings || [],
            knowledgeResult.reference_knowledge,
          );
          personEntities = personMerge.entities;
          personPipeline = {
            ...personPipeline,
            warnings: personMerge.warnings,
          };
        }

        basePackage = {
          ...basePackage,
          entities: mergeKnowledgeIntoEntities(basePackage.entities || [], knowledgeResult),
          canonical_entities: knowledgeResult.canonical_entities,
          reference_knowledge: knowledgeResult.reference_knowledge,
          watchlist_hits: knowledgeResult.watchlist_hits,
          knowledge_sources: knowledgeResult.knowledge_sources,
          reference_warnings: knowledgeResult.reference_warnings,
        };

        if (smartPayload) {
          const resolveEntityName = (entityId: string): string =>
            smartPayload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name ||
            basePackage.entities.find((entity) => entity.id === entityId)?.name ||
            entityId;
          const retrievalArtifacts = await buildRetrievalArtifactsFromPayloadWithSemanticSearch(
            smartPayload,
            basePackage.event_records || [],
            basePackage.relations || [],
            resolveEntityName,
            knowledgeResult.reference_knowledge,
          );

          basePackage = {
            ...basePackage,
            retrieval_artifacts: retrievalArtifacts,
            summary_panels: buildSummaryPanelsFromRetrievalArtifacts(retrievalArtifacts),
          };
        }
      }
    }

    if (smartPayload) {
      const intelligence = await buildEntityIntelligenceCase({
        caseId,
        payload: smartPayload,
        knowledge: knowledgeResult,
      });
      entityIntelligence = intelligence.result;
      basePackage = {
        ...basePackage,
        entities: mergeEntityIntelligenceIntoEntities(basePackage.entities || [], entityIntelligence),
        entity_intelligence: entityIntelligence,
      };
    } else {
      basePackage = {
        ...basePackage,
        reference_warnings: [
          ...(basePackage.reference_warnings || []),
          "Entity intelligence layer was deferred because no grounded sidecar payload was available for this analysis.",
        ],
      };
    }

    const enriched = enrichIntelligencePackage(basePackage, responsiveAnalysisText);
    const personContextCards = attachPersonDossiersToContextCards(
      enriched.context_cards || {},
      enriched.entities || [],
      personDossiers,
    );
    const contextCards = attachReferenceProfilesToContextCards(
      personContextCards,
      enriched.entities || [],
      enriched.reference_knowledge,
    );
    const enrichedContextCards = attachEntityProfilesToContextCards(
      contextCards,
      enriched.entities || [],
      enriched.entity_intelligence,
    );

    return {
      ...enriched,
      context_cards: enrichedContextCards,
      person_entities: personEntities,
      person_facts: personFacts,
      person_dossiers: personDossiers,
      person_pipeline: personPipeline,
      entity_intelligence: entityIntelligence || undefined,
    };
  } catch (error) {
    console.error("analyzeDocument failed; returning deterministic emergency fallback package", error);
    const fallback = enrichIntelligencePackage(buildFastBasePackage(analysisText), responsiveAnalysisText);
    return {
      ...fallback,
      person_entities: [],
      person_facts: [],
      person_dossiers: {},
      person_pipeline: {
        mode: "fallback",
        warnings: [
          "Primary analysis pipeline failed for this upload; Tevel returned a deterministic emergency fallback package.",
        ],
      },
      entity_intelligence: undefined,
    };
  }
};
