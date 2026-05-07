#!/usr/bin/env python3
import importlib.metadata
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import spacy  # type: ignore
    from spacy.matcher import Matcher, PhraseMatcher  # type: ignore
except Exception:  # pragma: no cover - optional local dependency
    spacy = None
    Matcher = None
    PhraseMatcher = None

try:
    import trafilatura  # type: ignore
except Exception:  # pragma: no cover - optional local dependency
    trafilatura = None


ORG_SUFFIXES = [
    "group",
    "logistics",
    "finance",
    "brokers",
    "holdings",
    "bank",
    "ministry",
    "institute",
    "agency",
    "council",
    "center",
    "centre",
    "university",
    "hospital",
    "ltd",
    "llc",
    "inc",
    "corp",
]
LOCATION_SUFFIXES = [
    "wharf",
    "port",
    "warehouse",
    "pier",
    "airport",
    "camp",
    "station",
    "terminal",
    "crossing",
    "base",
    "bay",
    "street",
    "road",
    "avenue",
    "boulevard",
    "building",
    "tower",
    "campus",
    "clinic",
    "hospital",
    "university",
    "valley",
    "village",
    "county",
    "province",
    "harbor",
]
FACILITY_PREFIXES = ["warehouse", "pier", "grid", "terminal", "camp", "base", "station", "building", "clinic", "campus", "lab", "tower"]
VEHICLE_BRANDS = [
    "toyota", "ford", "chevrolet", "mercedes", "bmw", "audi", "volkswagen", "honda", "hyundai", "kia",
    "nissan", "mazda", "mitsubishi", "isuzu", "volvo", "scania", "tesla", "byd", "renault", "peugeot",
    "citroen", "fiat", "skoda", "man", "daf", "iveco", "dji", "caterpillar", "cat", "komatsu", "john", "deere",
]
VEHICLE_TYPES = ["van", "truck", "sedan", "pickup", "bus", "tractor", "trailer", "forklift", "drone", "excavator"]
REPORTING_CUES = ["wrote", "said", "reported", "noted", "flagged", "requested", "shows", "showed", "appears", "confirmed", "indicated"]
COMMUNICATION_CUES = ["emailed", "wrote", "forwarded", "copied", "sent", "contacted"]
FUNDING_CUES = ["funded", "financed", "backed", "paid"]
MOVEMENT_CUES = ["moved", "transported", "routed", "delivered", "launched", "coordinated", "redirected"]
ASSOCIATION_CUES = ["linked", "ties", "tied", "associated", "beside", "with"]
CYBER_CUES = ["ransomware", "encrypting", "brute force", "malware", "c2", "server"]
GLINER_MODEL_NAME = os.getenv("TEVEL_GLINER_MODEL", "urchade/gliner_medium-v2.1")
GLINER_THRESHOLD = float(os.getenv("TEVEL_GLINER_THRESHOLD", "0.42"))
GLINER_MAX_SEGMENT_CHARS = int(os.getenv("TEVEL_GLINER_MAX_SEGMENT_CHARS", "1200"))
GLINER_MAX_TEXT_CHARS = int(os.getenv("TEVEL_GLINER_MAX_TEXT_CHARS", "24000"))
FASTCOREF_ENABLED = os.getenv("TEVEL_ENABLE_FASTCOREF", "0").strip().lower() not in {"0", "false", "no", "off"}
FASTCOREF_MAX_TEXT_CHARS = int(os.getenv("TEVEL_FASTCOREF_MAX_TEXT_CHARS", "18000"))
RELIK_API_URL = os.getenv("TEVEL_RELIK_API_URL", "").strip().rstrip("/")
RELIK_TIMEOUT_SEC = float(os.getenv("TEVEL_RELIK_TIMEOUT_SEC", "12"))
RELIK_RELATION_THRESHOLD = float(os.getenv("TEVEL_RELIK_RELATION_THRESHOLD", "0.35"))
TEXT_FILE_SUFFIXES = {".txt", ".md", ".json", ".csv", ".xml", ".log", ".tsv", ".yaml", ".yml"}
TEXT_DECODE_ENCODINGS = (
    "utf-8-sig",
    "utf-16",
    "utf-16-le",
    "utf-16-be",
    "cp1255",
    "cp1256",
    "cp1252",
    "latin-1",
)
GLINER_LABELS = [
    ("PERSON", "Person"),
    ("ORGANIZATION", "Organization"),
    ("LOCATION", "Location"),
    ("ADDRESS", "Address"),
    ("FACILITY", "Facility"),
    ("VEHICLE", "Vehicle"),
    ("BANK_ACCOUNT", "Bank account"),
    ("COMPANY_ID", "Company identifier"),
    ("CONTRACT", "Contract"),
    ("SHIPMENT", "Shipment"),
    ("EVENT", "Event"),
    ("ASSET", "Asset"),
    ("ROUTE", "Route"),
    ("PHONE", "Phone number"),
    ("EMAIL", "Email"),
    ("DOMAIN", "Domain"),
    ("ALIAS", "Alias"),
]
REGEX_ENTITY_PATTERNS = [
    (re.compile(r"\b(?:met|contacted|emailed|called|briefed|interviewed|questioned|reviewed by|signed by|reported by|spoke with|spoke to|asked|told|directed)\s+([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|bin|ibn|al|de|del|van|von|ben|abu)){1,3})\b"), "PERSON", 0.77, "Person name inferred from action context"),
    (re.compile(r"\b(?:Ashdod|Haifa|Eilat|Jerusalem|Tel Aviv|Gaza|Rafah|Amman|Tehran|Damascus|Beirut)\b(?:\s+(?:Port|Crossing|District|Airport|Base))?"), "LOCATION", 0.82, "Known geo-location"),
    (re.compile(r"\b(?:\d{2,3}-\d{2,3}-\d{2,3}|[A-Z]{1,3}-\d{3,4}(?:-\d{1,3})?)\b"), "IDENTIFIER", 0.84, "Vehicle or registration identifier"),
    (re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b"), "IDENTIFIER", 0.9, "VIN-like identifier"),
    (re.compile(r"\b[A-Z]{4}\d{7}\b"), "IDENTIFIER", 0.9, "Container identifier"),
    (re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b"), "IDENTIFIER", 0.88, "IBAN-like identifier"),
    (re.compile(r"\b(?:Toyota|Ford|Chevrolet|Mercedes(?:-Benz)?|BMW|Audi|Volkswagen|Honda|Hyundai|Kia|Nissan|Mazda|Mitsubishi|Isuzu|Volvo|Scania|Tesla|BYD|Renault|Peugeot|Citroen|Fiat|Skoda|MAN|DAF|Iveco|DJI|Caterpillar|CAT|Komatsu|John Deere)\s+[A-Z]?[A-Za-z0-9-]{1,}(?:\s+(?:van|truck|sedan|pickup|bus|tractor|trailer|forklift|drone|excavator))?\b"), "VEHICLE", 0.83, "Vehicle or equipment model"),
    (re.compile(r"\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:Street|Road|Avenue|Boulevard|Building|Tower|Campus|Clinic|Hospital|University|Valley|Village|County|Province|Harbor)\b"), "LOCATION", 0.78, "Named civic or facility location"),
]

_GLINER_MODEL = None
_GLINER_LOAD_ATTEMPTED = False
_GLINER_DISABLED_REASON: Optional[str] = None
PRONOUN_REFERENCES = {
    "he", "she", "they", "them", "their", "theirs", "his", "her", "hers", "him", "it", "its",
    "this", "that", "these", "those", "the company", "the group", "the organization", "the network",
}


def stable_hash(value: str) -> str:
    hash_value = 2166136261
    for char in value:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return format(hash_value, "08x")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def score_decoded_text(text: str) -> float:
    if not text:
        return -1000.0
    length = max(len(text), 1)
    printable = sum(1 for char in text if char.isprintable() or char in "\n\r\t")
    alphabetical = sum(1 for char in text if char.isalpha())
    whitespace = sum(1 for char in text if char.isspace())
    replacements = text.count("\ufffd")
    nulls = text.count("\x00")
    mojibake_markers = sum(text.count(marker) for marker in ("Ã", "Â", "Ð", "Ø", "×", "�"))
    return (
        (printable / length) * 40
        + min(alphabetical / length, 0.65) * 30
        + min(whitespace / length, 0.35) * 10
        - replacements * 12
        - nulls * 12
        - mojibake_markers * 2
    )


def is_probably_binary(raw_bytes: bytes) -> bool:
    if not raw_bytes:
        return False
    if raw_bytes.startswith((b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff")):
        return False
    sample = raw_bytes[:4096]
    sample_length = max(len(sample), 1)
    null_ratio = sample.count(0) / sample_length
    control_ratio = sum(1 for byte in sample if byte < 9 or 13 < byte < 32) / sample_length
    return null_ratio > 0.18 or control_ratio > 0.28


def decode_text_bytes(raw_bytes: bytes) -> Tuple[str, Optional[str]]:
    if not raw_bytes:
        return "", None

    candidate_encodings = list(TEXT_DECODE_ENCODINGS)
    if raw_bytes.startswith((b"\xff\xfe", b"\xfe\xff")):
        candidate_encodings = ["utf-16", *candidate_encodings]

    best_text = ""
    best_encoding: Optional[str] = None
    best_score = float("-inf")

    for encoding in candidate_encodings:
        try:
            decoded = raw_bytes.decode(encoding)
        except Exception:
            continue
        score = score_decoded_text(decoded)
        if score > best_score:
            best_text = decoded
            best_encoding = encoding
            best_score = score

    if best_encoding is not None:
        return best_text, best_encoding

    return raw_bytes.decode("utf-8", errors="replace"), "utf-8-replace"


def gliner_enabled() -> bool:
    return os.getenv("TEVEL_ENABLE_GLINER", "1").strip().lower() not in {"0", "false", "no", "off"}


def load_gliner_model():
    global _GLINER_MODEL, _GLINER_LOAD_ATTEMPTED, _GLINER_DISABLED_REASON
    if not gliner_enabled():
        return None
    if _GLINER_LOAD_ATTEMPTED:
        return _GLINER_MODEL

    _GLINER_LOAD_ATTEMPTED = True
    try:
        from gliner import GLiNER  # type: ignore

        _GLINER_MODEL = GLiNER.from_pretrained(GLINER_MODEL_NAME)
        _GLINER_DISABLED_REASON = None
    except Exception as exc:  # pragma: no cover - optional adapter
        _GLINER_MODEL = None
        _GLINER_DISABLED_REASON = str(exc)
    return _GLINER_MODEL


def canonicalize_gliner_label(label: str) -> str:
    normalized = label.strip().lower().replace("_", " ")
    for canonical, display in GLINER_LABELS:
        if normalized in {canonical.lower().replace("_", " "), display.lower()}:
            return canonical
    return label.strip().upper().replace(" ", "_")


def adapter_status(state: str, detail: Optional[str] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"state": state}
    if detail:
        payload["detail"] = detail
    return payload


def span_overlaps(left_start: int, left_end: int, right_start: int, right_end: int) -> bool:
    return left_start < right_end and right_start < left_end


def normalize_surface(value: str) -> str:
    return normalize_text(value).lower()


def is_pronoun_reference(value: str) -> bool:
    return normalize_surface(value) in PRONOUN_REFERENCES


def relik_enabled() -> bool:
    return bool(RELIK_API_URL)


def relik_endpoint_candidates() -> List[str]:
    if not RELIK_API_URL:
        return []
    if RELIK_API_URL.endswith("/api/relik") or RELIK_API_URL.endswith("/relik"):
        return [RELIK_API_URL]
    return [f"{RELIK_API_URL}/api/relik", f"{RELIK_API_URL}/relik"]


def parse_html(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw_html = payload["raw_content"]
    source_uri = payload.get("source_uri")
    result = trafilatura.bare_extraction(
        raw_html,
        url=source_uri,
        favor_precision=True,
        include_comments=False,
        include_tables=True,
        with_metadata=True,
        as_dict=True,
    )
    extracted_text = ""
    metadata: Dict[str, Any] = {}
    if isinstance(result, dict):
        extracted_text = result.get("text") or result.get("raw_text") or ""
        metadata = {
            "title": result.get("title"),
            "author": result.get("author"),
            "hostname": result.get("hostname"),
            "sitename": result.get("sitename"),
            "published_at": result.get("date"),
            "language": result.get("language"),
            "description": result.get("description"),
        }
    if not extracted_text:
        extracted_text = trafilatura.extract(
            raw_html,
            url=source_uri,
            favor_precision=True,
            include_comments=False,
            include_tables=True,
            with_metadata=False,
        ) or ""
    return {
        "parser_name": "trafilatura",
        "parser_version": importlib.metadata.version("trafilatura"),
        "parser_input_kind": "html",
        "parser_view": "parsed_text",
        "text": extracted_text.strip(),
        "metadata": metadata,
    }


def parse_file(payload: Dict[str, Any]) -> Dict[str, Any]:
    file_path = Path(payload["file_path"]).expanduser().resolve()
    suffix = file_path.suffix.lower()
    raw_bytes = file_path.read_bytes()
    if suffix in {".html", ".htm"}:
        decoded_html, detected_encoding = decode_text_bytes(raw_bytes)
        result = parse_html(
            {
                "raw_content": decoded_html,
                "source_uri": payload.get("source_uri") or str(file_path),
            }
        ) | {
            "parser_input_kind": "file",
            "source_filename": file_path.name,
            "source_input_content": decoded_html,
        }
        if detected_encoding:
            result["metadata"] = {**(result.get("metadata") or {}), "source_encoding": detected_encoding}
        return result
    if suffix in TEXT_FILE_SUFFIXES:
        decoded_text, detected_encoding = decode_text_bytes(raw_bytes)
        return {
            "parser_name": "plain_file",
            "parser_version": None,
            "parser_input_kind": "file",
            "parser_view": "raw_text",
            "text": decoded_text,
            "source_input_content": decoded_text,
            "metadata": {
                "source_filename": file_path.name,
                "source_encoding": detected_encoding,
            },
        }
    if is_probably_binary(raw_bytes) and suffix not in {".pdf", ".docx", ".pptx", ".xlsx"}:
        return {
            "parser_name": "binary_file_unparsed",
            "parser_version": None,
            "parser_input_kind": "file",
            "parser_view": "raw_text",
            "text": "",
            "metadata": {
                "source_filename": file_path.name,
                "binary_source": True,
            },
        }

    def parse_with_docling() -> Tuple[str, Dict[str, Any]]:
        from docling.document_converter import DocumentConverter  # type: ignore

        converter = DocumentConverter()
        result = converter.convert(str(file_path))
        document = result.document
        extracted_text = ""
        # Prefer markdown export: it preserves table pipe syntax (| col | col |)
        # so the downstream chunker can emit atomic table_row units.
        # Fall back to plain-text export only if markdown is unavailable.
        if hasattr(document, "export_to_markdown"):
            extracted_text = document.export_to_markdown()
        elif hasattr(document, "export_to_text"):
            extracted_text = document.export_to_text()
        metadata: Dict[str, Any] = {
            "source_filename": file_path.name,
            "parser_view": "markdown",
        }
        return extracted_text.strip(), metadata

    def parse_pdf_with_pypdf() -> Tuple[str, Dict[str, Any]]:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(file_path))
        pages: List[str] = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            cleaned = normalize_text(page_text)
            if cleaned:
                pages.append(cleaned)

        extracted_text = "\n\n".join(pages).strip()
        metadata: Dict[str, Any] = {
            "source_filename": file_path.name,
            "page_count": len(reader.pages),
        }
        return extracted_text, metadata

    if suffix == ".pdf":
        # Docling first: its markdown export preserves table structure.
        # pypdf produces linearised text that destroys cell relationships.
        docling_error = ""
        try:
            extracted_text, metadata = parse_with_docling()
            if extracted_text:
                return {
                    "parser_name": "docling",
                    "parser_version": importlib.metadata.version("docling"),
                    "parser_input_kind": "file",
                    "parser_view": "parsed_text",
                    "text": extracted_text,
                    "metadata": metadata,
                }
        except Exception as exc:  # pragma: no cover - optional adapter
            docling_error = str(exc)
        else:
            docling_error = "Docling returned empty text output."

        pdf_error = ""
        try:
            extracted_text, metadata = parse_pdf_with_pypdf()
            if extracted_text:
                metadata["fallback_from"] = "docling"
                metadata["fallback_error"] = docling_error
                return {
                    "parser_name": "pypdf",
                    "parser_version": importlib.metadata.version("pypdf"),
                    "parser_input_kind": "file",
                    "parser_view": "parsed_text",
                    "text": extracted_text,
                    "metadata": metadata,
                }
        except Exception as exc:  # pragma: no cover - optional adapter
            pdf_error = str(exc)
        else:
            pdf_error = "PyPDF returned empty text output."

        return {
            "parser_name": "pdf_parse_failed",
            "parser_version": None,
            "parser_input_kind": "file",
            "parser_view": "raw_text",
            "text": "",
            "metadata": {
                "source_filename": file_path.name,
                "error": pdf_error,
                "pdf_fallback_error": docling_error,
            },
        }

    try:
        extracted_text, metadata = parse_with_docling()
        if extracted_text:
            return {
                "parser_name": "docling",
                "parser_version": importlib.metadata.version("docling"),
                "parser_input_kind": "file",
                "parser_view": "parsed_text",
                "text": extracted_text,
                "metadata": metadata,
            }
    except Exception as exc:  # pragma: no cover - optional adapter
        docling_error = str(exc)
    else:
        docling_error = "Docling returned empty text output."

    return {
        "parser_name": "docling_unavailable",
        "parser_version": None,
        "parser_input_kind": "file",
        "parser_view": "raw_text",
        "text": "",
        "metadata": {
            "source_filename": file_path.name,
            "error": docling_error,
            "binary_source": is_probably_binary(raw_bytes),
        },
    }


def normalize_location(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw_text = str(payload.get("raw_text") or "")
    normalized = normalize_text(raw_text)

    try:
        from postal.parser import parse_address  # type: ignore

        parts = parse_address(raw_text)
        components = {label: value for value, label in parts if value and label}
        ordered = [components[key] for key in ("house_number", "road", "suburb", "city", "state", "country") if key in components]
        return {
            "normalized_query": normalize_text(", ".join(ordered) if ordered else raw_text),
            "components": components,
            "source": "libpostal",
            "confidence": 0.86 if components else 0.62,
        }
    except Exception:
        segments = [segment.strip() for segment in raw_text.split(",") if segment.strip()]
        return {
            "normalized_query": normalized,
            "components": {f"segment_{index + 1}": value for index, value in enumerate(segments)},
            "source": "heuristic",
            "confidence": 0.46 if normalized else 0,
        }


def resolve_toponym_context(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_text = str(payload.get("raw_text") or "").strip()
    sentence_text = str(payload.get("sentence_text") or "")
    surrounding_entities = payload.get("surrounding_entities") or []
    context = f"{sentence_text} {' '.join(str(item) for item in surrounding_entities)}".lower()

    try:
        import mordecai3  # type: ignore  # pragma: no cover - optional adapter
    except Exception:
        hints: List[Dict[str, Any]] = []
        if any(token in context for token in ("israel", "tel aviv", "haifa", "ashdod", "jerusalem")):
            hints.append({"text": raw_text, "country": "Israel", "locality": "Tel Aviv", "confidence": 0.52, "source": "heuristic"})
        if any(token in context for token in ("jordan", "amman")):
            hints.append({"text": raw_text, "country": "Jordan", "locality": "Amman", "confidence": 0.5, "source": "heuristic"})
        if any(token in context for token in ("lebanon", "beirut")):
            hints.append({"text": raw_text, "country": "Lebanon", "locality": "Beirut", "confidence": 0.5, "source": "heuristic"})
        return hints

    return []


PERSON_TITLES = {"mr", "mrs", "ms", "dr", "prof", "capt", "commander", "colonel", "agent", "director"}
PERSON_ROLE_WORDS = {"founder", "director", "manager", "officer", "analyst", "reviewer", "broker", "owner", "journalist", "researcher"}
PERSON_ORG_CUES = {"group", "logistics", "finance", "brokers", "holdings", "bank", "ministry", "agency", "institute", "center", "university"}
PERSON_RELATION_CUES = {
    "works_for": ["works for", "worked for", "serves at", "joined", "at"],
    "director_of": ["director of", "headed", "leads"],
    "owner_of": ["owns", "owner of", "controls"],
    "related_to": ["related to", "associated with", "linked to"],
    "met_with": ["met with", "spoke with", "emailed", "contacted"],
    "reported_to": ["reported to", "briefed", "told"],
}
PERSON_EMAIL_REGEX = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PERSON_PHONE_REGEX = re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?){2,4}\d{2,4}\b")
PERSON_IDENTIFIER_REGEX = re.compile(r"\b(?:ID|Passport|Employee ID|employee id)\s*[:#]?\s*([A-Z0-9-]{4,})\b")
PERSON_DATE_REGEX = re.compile(r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})\b")
PERSON_NAME_CONTEXT_REGEX = re.compile(r"\b(?:met|contacted|emailed|called|briefed|interviewed|questioned|spoke with|reported by|reviewed by|signed by|asked|told|directed)\s+([A-Z][a-z]+(?:\s+(?:(?:bin|ibn|al|de|del|van|von|ben|abu)\s+)?(?:al-[A-Z][a-z]+|[A-Z][a-z]+(?:-[A-Z]?[a-z]+)?)){1,3})\b")
PERSON_SUBJECT_ACTION_REGEX = re.compile(r"\b([A-Z][a-z]+(?:\s+(?:(?:bin|ibn|al|de|del|van|von|ben|abu)\s+)?(?:al-[A-Z][a-z]+|[A-Z][a-z]+(?:-[A-Z]?[a-z]+)?)){1,3})\s+(?:met|contacted|emailed|called|briefed|interviewed|questioned|reviewed|signed|reported|spoke|asked|told|directed)\b")
PERSON_FULLNAME_REGEX = re.compile(r"\b[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?(?:\s+(?:(?:bin|ibn|al|de|del|van|von|ben|abu)\s+)?(?:al-[A-Z][a-z]+|[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)){1,3}\b")
PERSON_TITLE_NAME_REGEX = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|Prof|Capt|Commander|Colonel|Director|Agent)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b")
PERSON_SHORTFORM_REGEX = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|Prof|Capt|Commander|Colonel|Director|Agent)\.?\s+([A-Z][a-z]+)\b")
HEBREW_PERSON_CONTEXT_REGEX = re.compile(r"(?:^|[\s([{\"'׳״])(?:פגש(?:ה)?(?:\s+(?:עם|את))?|נפגש(?:ה)?\s+עם|שוחח(?:ה)?\s+עם|דיבר(?:ה)?\s+עם|כתב(?:ה)?(?:\s+(?:אל|בידי|מאת|על\s+ידי))?|פנה(?:ה)?\s+אל|ביקש(?:ה)?\s+מ|הורה(?:ה)?\s+ל)\s+([א-ת]{1,}(?:[-'״׳][א-ת]{1,})?(?:\s+(?:בן|בת|אבו|אל|דה|דל|ואן|פון))?(?:\s+[א-ת]{2,}(?:[-'״׳][א-ת]{1,})?){1,2})")
HEBREW_PERSON_FULLNAME_REGEX = re.compile(r"[א-ת]{1,}(?:[-'״׳][א-ת]{1,})?(?:\s+(?:(?:בן|בת|אבו|אל|דה|דל|ואן|פון)\s+)?[א-ת]{1,}(?:[-'״׳][א-ת]{1,})?){1,3}")
HEBREW_TITLE_REGEX = re.compile(r"(?:^|[\s([{\"'׳״])(?:מר|גב׳|גברת|ד\"ר|פרופ(?:׳|')?|רס\"ן|סרן|רפ\"ק|רב-כלאי|תא\"ל|סא\"ל|אל\"ם)\s+([א-ת]{1,}(?:[-'״׳][א-ת]{1,})?(?:\s+[א-ת]{1,}(?:[-'״׳][א-ת]{1,})?){0,2})")
ARABIC_PERSON_CONTEXT_REGEX = re.compile(r"(?:اجتمع|التقى|تحدث|اتصل|كتب|قال|طلب|أبلغ|وجّه)\s+(?:مع\s+)?([\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?(?:\s+(?:بن|ابن|بنت|أبو|ال|عبد))?(?:\s+[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?){1,2})")
ARABIC_PERSON_FULLNAME_REGEX = re.compile(r"[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?(?:\s+(?:(?:بن|ابن|بنت|أبو|ال|عبد)\s+)?[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?){1,3}")
ARABIC_TITLE_REGEX = re.compile(r"(?:السيد|السيدة|د\.?|دكتور|دكتورة|عميد|عقيد|لواء|رائد|نقيب|مقدم|مدير)\s+([\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){0,2})")
ARABIC_PERSON_ROLE_CONTEXT_REGEX = re.compile(
    r"(?:الهدف|الصراف|الناشط|المصدر|الوسيط|نائبه|نائبته|العقيد|الرائد|النقيب|المدير)\s+([\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?(?:\s+(?:بن|ابن|بنت|أبو|ال|عبد))?(?:\s+[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?){0,2})"
)
ARABIC_PERSON_NICKNAME_REGEX = re.compile(
    r"([\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?(?:\s+(?:بن|ابن|بنت|أبو|ال|عبد))?(?:\s+[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?){1,2})\s+\([\"'«»]?[^()]{2,24}[\"'«»]?\)"
)
HEBREW_PERSON_ROLE_CONTEXT_REGEX = re.compile(
    r"(?:^|[\s([{\"'׳״])(?:היעד|החלפן|הפעיל|המקור|השליח|ל?איש\s+הקשר(?:\s+הפיננסי)?|האסיר(?:\s+הביטחוני)?|האחיין|ל?אחיינו|ל?אחייניתו|הנחקר|ראש\s+הצוות|ראש\s+היחידה|מפקד(?:ת)?\s+הצוות|סגנו(?:\s+של)?|סגניתו(?:\s+של)?|רס\"ן|סא\"ל|אל\"ם)\s+([א-ת]{1,}(?:[-'״׳][א-ת]{1,})?(?:\s+(?:בן|בת|אבו|אל))?(?:\s+[א-ת]{2,}(?:[-'״׳][א-ת]{1,})?){1,2})"
)
HEBREW_PERSON_NICKNAME_REGEX = re.compile(
    r"([א-ת]{1,}(?:[-'״׳][א-ת]{1,})?(?:\s+(?:בן|בת|אבו|אל))?(?:\s+[א-ת]{2,}(?:[-'״׳][א-ת]{1,})?){1,2})\s+\((?:[\"'׳״][^()]{2,24}[\"'׳״])\)"
)
HEBREW_PERSON_STOPWORDS = {
    "לחלפנות", "חלפנות", "כספים", "הכספים", "לכספים", "לוגיסטיקה", "הקשר", "הקשרים", "תמונת", "מודיעין",
    "שאלות", "דחיפות", "עליונה", "ציר", "מימון", "טרור", "אמל", "אמלל", "אמצעי", "לחימה", "כוונות",
    "פיגועים", "רגישות", "מקורות", "אימות", "צולב", "ידיעות", "זהב", "הנחיות", "להפעלה", "מטרת", "הצי\"ח",
    "צי\"ח", "Essential", "Elements", "Information", "בין", "פיזי", "שעות", "האחרונות", "רשימת", "שמות", "יעד", "נצפים",
    "בזמן", "אמת", "חסימת", "תקשורת", "סלקטיבית", "כוח", "הלוחמים", "נמצא", "אינו", "כסף", "המשמעות",
    "המבצעית", "תוכן", "המסר", "החקירה", "המידע", "המפליל", "שורת", "הסיכום", "המלצה", "אופרטיבית", "הפער",
    "המודיעיני", "המבצעי", "פנימי", "תמליל", "השיחה", "דרישת", "השלמות", "לביצוע", "אישור", "תוכנית", "מנוי",
    "מוצפן", "רשת", "סלולר", "ישראלית", "בידי", "האסיר", "הביטחוני", "פיננסי", "בשם", "קישוריות", "חיצונית",
    "והפעלה", "מרחוק", "והציוד", "דווקא", "להזמנה", "ספציפית", "סיכול", "רחב", "הפללה", "מלאה", "חטיבת", "אגף",
    "המודיעין", "החקירות", "והמודיעין", "מבצעים", "מיוחדים", "יחידה", "מבצעית", "בית", "סוהר", "יחידת", "זירה",
    "מחוז", "מוסד", "איסוף", "חופי", "צפונית", "מחקר", "טכנולוגי", "הוא", "אחסון", "בשטח", "ככל", "נשמע",
    "אומר", "תחייב", "דיווח", "מיידי", "שיש", "לו", "בלבד", "מקום", "לינה", "והיה", "והיא", "והוא", "מיועד",
    "הפועל", "פועל", "שימש", "ששימש",
}
ARABIC_PERSON_STOPWORDS = {
    "الأموال", "مال", "تمويل", "لوجستي", "لوجستية", "معلومات", "استخبارات", "أسئلة", "عاجل", "فوري",
    "تحويل", "خلية", "عملية", "تنسيق", "مخزن", "مستودع", "طريق", "الأخيرة", "الوقت", "سياق", "الأسماء", "المرصودة",
}
PERSON_LIST_LABEL_PREFIX_REGEX = re.compile(r"^(?:רשימת יעד|רשימת שמות|שמות יעד|Observed names|Target list|Target names|الأسماء المرصودة|الأسماء(?:\s+المستهدفة)?)[\s:：-]*", re.I)
HEBREW_PERSON_ROLE_PREFIXES = (
    "היעד", "החלפן", "הפעיל", "המקור", "השליח", "איש", "סגנו", "סגניתו", 'רס"ן', 'סא"ל', 'אל"ם'
)


def clean_person_name(value: str) -> str:
    cleaned = normalize_text(value)
    cleaned = re.sub(r"^(?:Mr|Mrs|Ms|Dr|Prof|Capt|Commander|Colonel|Director|Agent)\.?\s+", "", cleaned)
    cleaned = re.sub(r"^(?:מר|גב׳|גברת|ד\"ר|פרופ(?:׳|')?|מנכ\"ל|שר|קצין)\s+", "", cleaned)
    cleaned = re.sub(r"\s+(?:וה(?:וא|יא|יה)|ה(?:וא|יא|יה)|מיועד(?:ת)?|הפועל(?:ת)?|פועל(?:ת)?|ששימש(?:ה)?|שימש(?:ה)?).*$", "", cleaned)
    cleaned = re.sub(r"^(?:בידי|מאת|על\s+ידי)\s+", "", cleaned)
    cleaned = re.sub(r"^(?:היעד|החלפן|הפעיל|המקור|השליח|ל?איש\s+הקשר(?:\s+הפיננסי)?|האסיר(?:\s+הביטחוני)?|האחיין|ל?אחיינו|ל?אחייניתו|הנחקר|הדובר|ראש\s+הצוות|ראש\s+היחידה|מפקד(?:ת)?\s+הצוות|סגנו(?:\s+של)?|סגניתו(?:\s+של)?|רס\"ן|סא\"ל|אל\"ם|רמ\"ד)\s+", "", cleaned)
    cleaned = re.sub(r"^(?:السيد|السيدة|د\.?|دكتور|دكتورة|عميد|عقيد|لواء|رائد|نقيب|مقدم|مدير)\s+", "", cleaned)
    cleaned = re.sub(r"^(?:الهدف|الصراف|الناشط|المصدر|الوسيط|نائبه|نائبته)\s+", "", cleaned)
    cleaned = re.sub(r"^(?:רשימת יעד|רשימת שמות|שמות יעד|Observed names|Target list|الأسماء المرصودة|الأسماء)\s*[:：]\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+ב[א-ת]{1,}(?:[-'״׳][א-ת]{1,})?$", "", cleaned)
    cleaned = re.sub(r"\s+ب[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?$", "", cleaned)
    cleaned = re.sub(r"\s+(?:مع|في|إلى|الى|عن|من|على|لدى).*$", "", cleaned)
    cleaned = re.sub(r"\s+(?:emailed|contacted|met|reviewed|called|briefed|interviewed|questioned|asked|told|directed)\b.*$", "", cleaned, flags=re.I)
    return cleaned.strip(" ,.;:!?")


def is_plausible_person_name(value: str) -> bool:
    cleaned = clean_person_name(value)
    if not cleaned:
        return False
    parts = [part for part in re.split(r"\s+", cleaned) if part]
    if len(parts) < 2 or len(parts) > 4:
        return False
    if any(re.match(r"^\d", part) for part in parts):
        return False
    if script_language(cleaned) == "he":
        lowered = [part.lower() for part in parts]
        if any(part in HEBREW_PERSON_STOPWORDS for part in lowered):
            return False
        if parts[0] in {"בן", "בת", "אבו", "אל"} or parts[-1] in {"בן", "בת", "אבו", "אל"}:
            return False
        substantive = [part for part in parts if part not in {"בן", "בת", "אבו", "אל"}]
        if not substantive or all(len(part) <= 1 for part in substantive):
            return False
        return all(re.fullmatch(r"[א-ת]{1,}(?:[-'״׳][א-ת]{1,})?", part) or part in {"בן", "בת", "אבו", "אל"} for part in parts)
    if re.search(r"[\u0600-\u06FF]", cleaned):
        lowered = [part.lower() for part in parts]
        if any(part in ARABIC_PERSON_STOPWORDS for part in lowered):
            return False
        if parts[0] in {"بن", "ابن", "بنت", "أبو", "ال", "عبد", "مع", "في", "إلى", "الى", "عن", "من", "على", "لدى"} or parts[-1] in {"بن", "ابن", "بنت", "أبو", "ال", "عبد", "مع", "في", "إلى", "الى", "عن", "من", "على", "لدى"}:
            return False
        substantive = [part for part in parts if part not in {"بن", "ابن", "بنت", "أبو", "ال", "عبد"}]
        if not substantive or all(len(part) <= 1 for part in substantive):
            return False
        return all(re.fullmatch(r"[\u0600-\u06FF]{2,}(?:[-'’][\u0600-\u06FF]{1,})?", part) or part in {"بن", "ابن", "بنت", "أبو", "ال", "عبد"} for part in parts)
    lowered = [part.lower() for part in parts]
    if re.search(r"\b(?:Maritime|Shipping|Marine|Holdings|Logistics|Finance|Systems|Solutions|Services)\b", cleaned):
        return False
    connectors = {"bin", "ibn", "al", "de", "del", "van", "von", "ben", "abu"}
    if lowered[0] in connectors or lowered[-1] in connectors:
        return False
    substantive = [part for part in parts if part.lower() not in connectors]
    if not substantive or all(len(part) <= 1 for part in substantive):
        return False
    return all(re.fullmatch(r"(?:al-[A-Z][a-z]+|[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)", part) or part.lower() in connectors for part in parts)


def script_language(value: str) -> str:
    if re.search(r"[\u0590-\u05FF]", value):
        return "he"
    if re.search(r"[\u0600-\u06FF]", value):
        return "ar"
    return "en"


def sentence_spans(text: str) -> List[Tuple[int, int, str]]:
    spans: List[Tuple[int, int, str]] = []
    cursor = 0
    for part in re.split(r"(?<=[.!?])\s+|\n+", text):
        stripped = part.strip()
        if not stripped:
            cursor += len(part) + 1
            continue
        start = text.find(stripped, cursor)
        if start == -1:
            start = cursor
        end = start + len(stripped)
        spans.append((start, end, stripped))
        cursor = end
    return spans or [(0, len(text), text.strip())]


def chunk_for_offset(chunks: List[Dict[str, Any]], start: int, end: int) -> Dict[str, Any]:
    for chunk in chunks:
        chunk_text = chunk.get("text", "")
        chunk_start = int(chunk.get("startChar", 0))
        chunk_end = chunk_start + len(chunk_text)
        if start >= chunk_start and end <= chunk_end:
            return chunk
    return chunks[0] if chunks else {"chunkId": "chunk_0"}


def detect_person_mentions_gliner(text: str, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    model = load_gliner_model()
    if model is None:
        return []

    mentions: List[Dict[str, Any]] = []
    max_chars = min(len(text), GLINER_MAX_TEXT_CHARS)
    for offset in range(0, max_chars, GLINER_MAX_SEGMENT_CHARS):
        segment = text[offset : offset + GLINER_MAX_SEGMENT_CHARS]
        if not segment.strip():
            continue
        try:
            predictions = model.predict_entities(segment, ["Person"], threshold=GLINER_THRESHOLD)
        except Exception:
            continue
        for prediction in predictions:
            label = canonicalize_gliner_label(str(prediction.get("label") or ""))
            if label != "PERSON":
                continue
            start = offset + int(prediction.get("start", 0))
            end = offset + int(prediction.get("end", 0))
            text_value = segment[int(prediction.get("start", 0)) : int(prediction.get("end", 0))].strip()
            if not text_value:
                continue
            if not is_plausible_person_name(text_value):
                continue
            sentence = next((item for item in sentence_spans(text) if start >= item[0] and end <= item[1]), (0, len(text), text))
            chunk = chunk_for_offset(chunks, start, end)
            mentions.append(
                {
                    "mentionId": f"pm_{stable_hash(f'{start}:{end}:{text_value}')}",
                    "documentId": chunk.get("documentId") or "doc",
                    "chunkId": chunk.get("chunkId") or "chunk_0",
                    "page": chunk.get("page"),
                    "text": text_value,
                    "normalizedText": clean_person_name(text_value),
                    "sentenceText": sentence[2],
                    "startChar": start,
                    "endChar": end,
                    "language": script_language(text_value),
                    "confidence": float(prediction.get("score", 0.75)),
                    "extractor": "gliner2",
                }
            )
    return mentions


def detect_person_mentions_rules(text: str, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    mentions: List[Dict[str, Any]] = []
    patterns = [
        (PERSON_TITLE_NAME_REGEX, 0.82),
        (PERSON_NAME_CONTEXT_REGEX, 0.79),
        (PERSON_SUBJECT_ACTION_REGEX, 0.78),
        (HEBREW_PERSON_CONTEXT_REGEX, 0.77),
        (HEBREW_TITLE_REGEX, 0.81),
        (ARABIC_PERSON_CONTEXT_REGEX, 0.78),
        (ARABIC_TITLE_REGEX, 0.8),
        (HEBREW_PERSON_ROLE_CONTEXT_REGEX, 0.85),
        (HEBREW_PERSON_NICKNAME_REGEX, 0.8),
        (ARABIC_PERSON_ROLE_CONTEXT_REGEX, 0.84),
        (ARABIC_PERSON_NICKNAME_REGEX, 0.8),
    ]
    for regex, confidence in patterns:
        for match in regex.finditer(text):
            text_value = clean_person_name(match.group(1) if match.lastindex else match.group(0))
            start = match.start(1) if match.lastindex else match.start(0)
            end = start + len(text_value)
            if not is_plausible_person_name(text_value):
                continue
            sentence = next((item for item in sentence_spans(text) if start >= item[0] and end <= item[1]), (0, len(text), text))
            chunk = chunk_for_offset(chunks, start, end)
            mentions.append(
                {
                    "mentionId": f"pm_{stable_hash(f'{start}:{end}:{text_value}:rule')}",
                    "documentId": chunk.get("documentId") or "doc",
                    "chunkId": chunk.get("chunkId") or "chunk_0",
                    "page": chunk.get("page"),
                    "text": text_value,
                    "normalizedText": clean_person_name(text_value),
                    "sentenceText": sentence[2],
                    "startChar": start,
                    "endChar": end,
                    "language": script_language(text_value),
                    "confidence": confidence,
                    "extractor": "rule",
                }
            )
    return mentions


def detect_person_mentions_list_fragments(text: str, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    mentions: List[Dict[str, Any]] = []
    pos = 0
    for raw_line in text.splitlines(keepends=True):
        line_start = pos
        pos += len(raw_line)
        stripped = raw_line.strip()
        if not stripped or not PERSON_LIST_LABEL_PREFIX_REGEX.match(stripped):
            continue
        candidate_line = PERSON_LIST_LABEL_PREFIX_REGEX.sub("", stripped).strip()
        if not candidate_line:
            continue
        for fragment in [clean_person_name(part) for part in re.split(r"\s*[;,،|]\s*", candidate_line) if part.strip()]:
            if not is_plausible_person_name(fragment):
                continue
            start = text.find(fragment, line_start)
            if start == -1 or start >= pos:
                continue
            end = start + len(fragment)
            sentence = next((item for item in sentence_spans(text) if start >= item[0] and end <= item[1]), (0, len(text), text))
            chunk = chunk_for_offset(chunks, start, end)
            mentions.append(
                {
                    "mentionId": f"pm_{stable_hash(f'{start}:{end}:{fragment}:list')}",
                    "documentId": chunk.get("documentId") or "doc",
                    "chunkId": chunk.get("chunkId") or "chunk_0",
                    "page": chunk.get("page"),
                    "text": fragment,
                    "normalizedText": clean_person_name(fragment),
                    "sentenceText": sentence[2],
                    "startChar": start,
                    "endChar": end,
                    "language": script_language(fragment),
                    "confidence": 0.69,
                    "extractor": "list-fragment",
                }
            )
    return mentions


def merge_person_mentions(mentions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_key: Dict[str, Dict[str, Any]] = {}
    for mention in mentions:
        key = normalize_text(str(mention.get("normalizedText") or mention.get("text") or "")).lower()
        if not key:
            continue
        existing = by_key.get(key)
        if existing is None or mention["confidence"] > existing["confidence"]:
            by_key[key] = mention
        elif existing:
            existing["confidence"] = max(existing["confidence"], mention["confidence"])
    return list(by_key.values())


def try_fastcoref_links(text: str, mentions: List[Dict[str, Any]]) -> Tuple[List[Tuple[str, str]], List[str]]:
    if not mentions or script_language(text) != "en":
        return [], []
    if len(text) > FASTCOREF_MAX_TEXT_CHARS:
        return [], [f"fastcoref skipped for long document ({len(text)} chars > {FASTCOREF_MAX_TEXT_CHARS})."]
    try:
        from fastcoref import FCoref  # type: ignore  # pragma: no cover - optional adapter
    except Exception:
        links: List[Tuple[str, str]] = []
        surname_map = {surname.lower(): mention["mentionId"] for mention in mentions for surname in [mention["normalizedText"].split()[-1]] if surname}
        for short in PERSON_SHORTFORM_REGEX.finditer(text):
            last = short.group(1).strip()
            if last.lower() in surname_map:
                links.append((f"short_{stable_hash(last)}", surname_map[last.lower()]))
        return links, []

    try:
        model = FCoref(device="cpu", model_name_or_path="biu-nlp/f-coref")
        prediction = model.predict(texts=[text])[0]
        clusters = prediction.get_clusters(as_strings=False)
        links: List[Tuple[str, str]] = []
        for cluster in clusters:
            mention_ids = []
            for start, end in cluster:
                for mention in mentions:
                    if mention["startChar"] == start and mention["endChar"] == end:
                        mention_ids.append(mention["mentionId"])
                        break
            if len(mention_ids) > 1:
                anchor = mention_ids[0]
                for mention_id in mention_ids[1:]:
                    links.append((mention_id, anchor))
        return links, []
    except Exception:
        return [], []


def build_person_facts(mentions: List[Dict[str, Any]], text: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    facts: List[Dict[str, Any]] = []
    provisional_entities: List[Dict[str, Any]] = []
    for mention in mentions:
        entity_id = f"person_{stable_hash(mention['normalizedText'].lower())}"
        mention["entityId"] = entity_id
        aliases = [mention["text"], mention["normalizedText"]]
        provisional_entities.append(
            {
                "entityId": entity_id,
                "canonicalName": mention["text"],
                "aliases": [alias for alias in aliases if alias],
                "mentions": [mention["mentionId"]],
                "facts": [],
                "confidence": mention["confidence"],
            }
        )
        sentence = mention["sentenceText"]
        lower_sentence = sentence.lower()

        title_match = next((token for token in sentence.split()[:2] if token.strip(".").lower() in PERSON_TITLES), None)
        if title_match:
            facts.append({"factId": f"pf_{stable_hash(entity_id + 'title')}", "entityId": entity_id, "kind": "title", "value": title_match.strip("."),
                          "normalizedValue": title_match.strip(".").lower(), "confidence": mention["confidence"], "evidenceMentionIds": [mention["mentionId"]]})
        for email in PERSON_EMAIL_REGEX.findall(sentence):
            facts.append({"factId": f"pf_{stable_hash(entity_id + email)}", "entityId": entity_id, "kind": "email", "value": email,
                          "normalizedValue": email.lower(), "confidence": 0.88, "evidenceMentionIds": [mention["mentionId"]]})
        for phone in PERSON_PHONE_REGEX.findall(sentence):
            if len(re.sub(r"\D", "", phone)) < 7:
                continue
            if PERSON_DATE_REGEX.fullmatch(phone.strip()):
                continue
            facts.append({"factId": f"pf_{stable_hash(entity_id + phone)}", "entityId": entity_id, "kind": "phone", "value": phone.strip(),
                          "normalizedValue": re.sub(r"\D", "", phone), "confidence": 0.8, "evidenceMentionIds": [mention["mentionId"]]})
        for date in PERSON_DATE_REGEX.findall(sentence):
            facts.append({"factId": f"pf_{stable_hash(entity_id + date)}", "entityId": entity_id, "kind": "date", "value": date,
                          "normalizedValue": date, "confidence": 0.76, "evidenceMentionIds": [mention["mentionId"]]})
        id_match = PERSON_IDENTIFIER_REGEX.search(sentence)
        if id_match:
            facts.append({"factId": f"pf_{stable_hash(entity_id + id_match.group(1))}", "entityId": entity_id, "kind": "identifier", "value": id_match.group(1),
                          "normalizedValue": id_match.group(1), "confidence": 0.83, "evidenceMentionIds": [mention["mentionId"]]})
        for suffix in ORG_SUFFIXES:
            org_match = re.search(rf"\b([A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){{0,3}}\s+{suffix})\b", sentence, re.I)
            if org_match:
                facts.append({"factId": f"pf_{stable_hash(entity_id + org_match.group(1))}", "entityId": entity_id, "kind": "organization", "value": org_match.group(1).strip(),
                              "normalizedValue": normalize_text(org_match.group(1)).lower(), "confidence": 0.74, "evidenceMentionIds": [mention["mentionId"]]})
        for location in re.findall(r"\b(?:in|at|near)\s+([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,2})", sentence):
            facts.append({"factId": f"pf_{stable_hash(entity_id + location)}", "entityId": entity_id, "kind": "location", "value": location,
                          "normalizedValue": normalize_text(location).lower(), "confidence": 0.71, "evidenceMentionIds": [mention["mentionId"]]})
        for role in PERSON_ROLE_WORDS:
            if role in lower_sentence:
                facts.append({"factId": f"pf_{stable_hash(entity_id + role)}", "entityId": entity_id, "kind": "role", "value": role,
                              "normalizedValue": role, "confidence": 0.66, "evidenceMentionIds": [mention["mentionId"]]})
    return facts, provisional_entities


def build_person_relationship_facts(mentions: List[Dict[str, Any]], facts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    mention_by_name = {normalize_text(mention["normalizedText"]).lower(): mention for mention in mentions}
    relationship_facts: List[Dict[str, Any]] = []
    for mention in mentions:
        sentence = mention["sentenceText"]
        lower = sentence.lower()
        for relation_type, cues in PERSON_RELATION_CUES.items():
            if not any(cue in lower for cue in cues):
                continue
            for other in mentions:
                if other["mentionId"] == mention["mentionId"]:
                    continue
                if other["sentenceText"] != sentence:
                    continue
                relationship_facts.append(
                    {
                        "factId": f"pf_{stable_hash(mention['entityId'] + relation_type + other['normalizedText'])}",
                        "entityId": mention["entityId"],
                        "kind": "relationship",
                        "value": other["text"],
                        "normalizedValue": relation_type,
                        "confidence": min(mention["confidence"], other["confidence"]),
                        "evidenceMentionIds": [mention["mentionId"], other["mentionId"]],
                    }
                )
    return relationship_facts


def person_extract(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = str(payload.get("rawText") or "")
    chunks = payload.get("chunks") or []
    mentions = merge_person_mentions(
        detect_person_mentions_gliner(text, chunks)
        + detect_person_mentions_rules(text, chunks)
        + detect_person_mentions_list_fragments(text, chunks)
    )
    warnings: List[str] = []
    extraction_mode = "backend"
    if not mentions:
        extraction_mode = "fallback"
        warnings.append("Person extraction fell back to rule-only mode.")

    coref_links, coref_warnings = try_fastcoref_links(text, mentions)
    facts, provisional_entities = build_person_facts(mentions, text)
    warnings.extend(coref_warnings)
    mention_to_entity = {mention["mentionId"]: mention.get("entityId", "") for mention in mentions}
    if coref_links:
        for source_id, target_id in coref_links:
            target_entity_id = mention_to_entity.get(target_id, "")
            if not target_entity_id:
                continue
            facts.append(
                {
                    "factId": f"pf_{stable_hash(source_id + target_id)}",
                    "entityId": target_entity_id,
                    "kind": "alias",
                    "value": source_id,
                    "normalizedValue": target_id,
                    "confidence": 0.58,
                    "evidenceMentionIds": [source_id, target_id],
                }
            )

    # TODO: wire ReLiK relation extraction when the local model weights/runtime are provisioned.
    facts.extend(build_person_relationship_facts(mentions, facts))
    return {
        "mentions": mentions,
        "facts": facts,
        "provisionalEntities": provisional_entities,
        "warnings": warnings,
        "extractionMode": extraction_mode,
    }


def person_build_dossier(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    entity = payload.get("entity") or {}
    facts = payload.get("facts") or []
    if not entity or len(facts) < 2:
        return None

    try:
        import outlines  # type: ignore  # pragma: no cover - optional adapter
    except Exception:
        outlines = None
    # TODO: replace this deterministic schema fill with constrained Outlines generation once local model infra is installed.

    def values(kind: str) -> List[str]:
        return list(dict.fromkeys([fact["value"] for fact in facts if fact.get("kind") == kind and fact.get("value")]))

    relationships = [
        {
            "type": fact.get("normalizedValue") or "related_to",
            "target": fact.get("value"),
            "confidence": fact.get("confidence", 0.6),
            "evidenceMentionIds": fact.get("evidenceMentionIds", []),
        }
        for fact in facts
        if fact.get("kind") == "relationship"
    ]
    claims = [
        {
            "text": fact.get("value"),
            "confidence": fact.get("confidence", 0.6),
            "evidenceMentionIds": fact.get("evidenceMentionIds", []),
        }
        for fact in facts
        if fact.get("kind") == "claim"
    ]

    dossier = {
        "entityId": entity.get("entityId"),
        "canonicalName": entity.get("canonicalName"),
        "aliases": [alias for alias in entity.get("aliases", []) if normalize_text(alias).lower() != normalize_text(entity.get("canonicalName", "")).lower()],
        "titles": values("title"),
        "roles": values("role"),
        "organizations": values("organization"),
        "contact": {"emails": values("email"), "phones": values("phone")},
        "locations": values("location"),
        "dates": values("date"),
        "relationships": relationships,
        "claims": claims,
        "sourceMentions": entity.get("mentions", []),
        "overallConfidence": max([entity.get("confidence", 0.0)] + [fact.get("confidence", 0.0) for fact in facts]),
    }

    return dossier


def expand_entities_with_coref(text: str, entities: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, Any], List[str]]:
    if not entities:
        return [], adapter_status("skipped", "No seed entities were available for coreference expansion."), []
    if script_language(text) != "en":
        return [], adapter_status("skipped", "Coreference expansion is currently limited to English text."), []
    if not FASTCOREF_ENABLED:
        return [], adapter_status("disabled", "Set TEVEL_ENABLE_FASTCOREF=1 to enable coreference expansion."), []
    if len(text) > FASTCOREF_MAX_TEXT_CHARS:
        detail = f"Skipped coreference expansion for long document ({len(text)} chars > {FASTCOREF_MAX_TEXT_CHARS})."
        return [], adapter_status("skipped", detail), [f"fastcoref skipped for long document ({len(text)} chars > {FASTCOREF_MAX_TEXT_CHARS})."]

    try:
        from fastcoref import FCoref  # type: ignore  # pragma: no cover - optional adapter
    except Exception as exc:  # pragma: no cover - optional adapter
        return [], adapter_status("unavailable", str(exc)), []

    existing_spans = {(entity["start"], entity["end"], entity["label"]) for entity in entities}
    proposals: List[Dict[str, Any]] = []
    warnings: List[str] = []

    try:
        model = FCoref(device="cpu", model_name_or_path="biu-nlp/f-coref")
        prediction = model.predict(texts=[text])[0]
        clusters = prediction.get_clusters(as_strings=False)
    except Exception as exc:  # pragma: no cover - optional adapter
        return [], adapter_status("unavailable", str(exc)), [f"fastcoref inference failed: {exc}"]

    def anchor_for_cluster(cluster: List[Tuple[int, int]]) -> Optional[Dict[str, Any]]:
        candidates: List[Dict[str, Any]] = []
        for entity in entities:
            for start, end in cluster:
                if span_overlaps(entity["start"], entity["end"], start, end):
                    candidates.append(entity)
                    break
        if not candidates:
            return None
        return sorted(
            candidates,
            key=lambda entity: (
                is_pronoun_reference(entity.get("text", "")),
                -(entity["end"] - entity["start"]),
                -float(entity.get("confidence", 0.0)),
            ),
        )[0]

    for cluster_index, cluster in enumerate(clusters):
        if len(cluster) < 2:
            continue
        anchor = anchor_for_cluster(cluster)
        if not anchor:
            continue
        for start, end in cluster:
            if end <= start:
                continue
            surface = text[start:end].strip()
            if not surface:
                continue
            if (start, end, anchor["label"]) in existing_spans:
                continue
            if any(span_overlaps(start, end, entity["start"], entity["end"]) for entity in entities):
                continue
            if len(surface) > 80:
                continue
            if not (is_pronoun_reference(surface) or surface[:1].isupper()):
                continue
            proposals.append(
                {
                    "start": start,
                    "end": end,
                    "text": surface,
                    "label": anchor["label"],
                    "confidence": min(0.74, max(0.46, float(anchor.get("confidence", 0.62)) * 0.78)),
                    "extraction_source": "model",
                    "role": f"Coreference-linked mention for {anchor['text']}",
                    "metadata": {
                        "extractor_name": "fastcoref_cluster_bridge",
                        "coref_cluster_id": f"cluster_{cluster_index}",
                        "anchor_text": anchor["text"],
                    },
                }
            )
            existing_spans.add((start, end, anchor["label"]))

    if proposals:
        warnings.append(f"fastcoref expanded {len(proposals)} linked mentions from {len(clusters)} clusters.")
        return proposals, adapter_status("active", f"Expanded {len(proposals)} linked mentions."), warnings
    return [], adapter_status("active", "No new entity mentions were added after coreference review."), []


def extract_relik_span(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    start = item.get("start", item.get("char_start", item.get("start_char")))
    end = item.get("end", item.get("char_end", item.get("end_char")))
    text_value = item.get("text", item.get("mention", item.get("surface")))
    if start is None or end is None or not isinstance(text_value, str):
        return None
    try:
        start_value = int(start)
        end_value = int(end)
    except Exception:
        return None
    if end_value <= start_value:
        return None
    return {
        "start": start_value,
        "end": end_value,
        "text": text_value,
        "label": canonicalize_gliner_label(str(item.get("label", item.get("entity_type", item.get("type", "ENTITY"))))),
    }


def collect_relik_proposals(text: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any], List[str]]:
    if not relik_enabled():
        return [], [], adapter_status("disabled", "Set TEVEL_RELIK_API_URL to enable ReLiK relation extraction."), []
    if script_language(text) != "en":
        return [], [], adapter_status("skipped", "ReLiK API integration is currently limited to English text."), []

    params = urllib.parse.urlencode(
        {
            "text": text,
            "is_split_into_words": "false",
            "return_windows": "false",
            "use_doc_topic": "false",
            "annotation_type": "char",
            "relation_threshold": str(RELIK_RELATION_THRESHOLD),
        }
    )
    response_payload: Optional[Dict[str, Any]] = None
    last_error: Optional[str] = None

    for endpoint in relik_endpoint_candidates():
        try:
            with urllib.request.urlopen(f"{endpoint}?{params}", timeout=RELIK_TIMEOUT_SEC) as response:  # nosec B310
                response_payload = json.loads(response.read().decode("utf-8"))
                break
        except urllib.error.URLError as exc:  # pragma: no cover - optional adapter
            last_error = str(exc)
        except Exception as exc:  # pragma: no cover - optional adapter
            last_error = str(exc)

    if response_payload is None:
        detail = last_error or "ReLiK endpoint did not return a usable payload."
        return [], [], adapter_status("unavailable", detail), [f"ReLiK relation extraction unavailable: {detail}"]

    span_items = response_payload.get("spans") or []
    triple_items = response_payload.get("triplets", response_payload.get("triples", [])) or []
    mentions: List[Dict[str, Any]] = []
    relations: List[Dict[str, Any]] = []

    for span in span_items:
        normalized = extract_relik_span(span)
        if not normalized:
            continue
        mentions.append(
            {
                "start": normalized["start"],
                "end": normalized["end"],
                "text": normalized["text"],
                "label": normalized["label"],
                "confidence": 0.76,
                "extraction_source": "linker",
                "role": "ReLiK entity-linking proposal",
                "metadata": {
                    "extractor_name": "relik_api",
                    "relik_label": normalized["label"],
                },
            }
        )

    for triple in triple_items:
        if not isinstance(triple, dict):
            continue
        source_span = extract_relik_span(triple.get("subject", triple.get("source", triple.get("head", {}))))
        target_span = extract_relik_span(triple.get("object", triple.get("target", triple.get("tail", {}))))
        relation_type = str(triple.get("label", triple.get("relation", triple.get("predicate", "")))).strip()
        if not source_span or not target_span or not relation_type:
            continue
        relations.append(
            {
                "start": min(source_span["start"], target_span["start"]),
                "end": max(source_span["end"], target_span["end"]),
                "relation_type": relation_type.upper().replace(" ", "_"),
                "trigger_text": relation_type,
                "trigger_start": min(source_span["end"], target_span["end"]),
                "trigger_end": min(source_span["end"], target_span["end"]) + len(relation_type),
                "source_span": {
                    "start": source_span["start"],
                    "end": source_span["end"],
                    "text": source_span["text"],
                },
                "target_span": {
                    "start": target_span["start"],
                    "end": target_span["end"],
                    "text": target_span["text"],
                },
                "confidence": 0.79,
                "metadata": {
                    "extractor_name": "relik_api",
                    "relation_label": relation_type,
                },
            }
        )

    detail = f"Collected {len(mentions)} spans and {len(relations)} relation candidates."
    return mentions, relations, adapter_status("active", detail), []


def build_nlp(metadata: Optional[Dict[str, Any]] = None):
    nlp = spacy.blank("en")
    if "sentencizer" not in nlp.pipe_names:
        nlp.add_pipe("sentencizer")

    ruler = nlp.add_pipe("entity_ruler")
    ruler.add_patterns(
        [
            {"label": "ORGANIZATION", "pattern": [{"IS_TITLE": True, "OP": "+"}, {"LOWER": {"IN": ORG_SUFFIXES}}]},
            {"label": "LOCATION", "pattern": [{"IS_TITLE": True, "OP": "+"}, {"LOWER": {"IN": LOCATION_SUFFIXES}}]},
            {"label": "LOCATION", "pattern": [{"LOWER": {"IN": FACILITY_PREFIXES}}, {"TEXT": {"REGEX": "^[A-Z0-9-]+$"}}]},
            {"label": "PERSON", "pattern": [{"LOWER": {"IN": ["mr", "mrs", "ms", "dr"]}}, {"IS_TITLE": True}, {"IS_TITLE": True}]},
            {"label": "VEHICLE", "pattern": [{"LOWER": {"IN": VEHICLE_BRANDS}}, {"TEXT": {"REGEX": "^[A-Za-z0-9-]+$"}}, {"LOWER": {"IN": VEHICLE_TYPES}, "OP": "?"}]},
        ]
    )

    phrase_matcher = PhraseMatcher(nlp.vocab, attr="LOWER")
    metadata_phrases: List[Tuple[str, str]] = []
    if metadata:
      for key, label in (("title", "MISC"), ("author", "PERSON"), ("sitename", "ORGANIZATION"), ("hostname", "ASSET")):
          value = metadata.get(key)
          if isinstance(value, str) and len(value.strip()) >= 4 and " " in value.strip():
              metadata_phrases.append((label, value.strip()))
    for label, phrase in metadata_phrases:
        phrase_matcher.add(label, [nlp.make_doc(phrase)])

    matcher = Matcher(nlp.vocab)
    matcher.add(
        "PERSON_CONTEXT",
        [
            [
                {"LOWER": {"IN": ["officer", "reviewer", "analyst", "operator"]}},
                {"IS_TITLE": True},
                {"IS_TITLE": True},
            ]
        ],
    )
    matcher.add(
        "FACILITY_CODE",
        [[{"LOWER": {"IN": FACILITY_PREFIXES}}, {"TEXT": {"REGEX": "^[A-Z0-9-]+$"}}]],
    )
    matcher.add(
        "VEHICLE_CONTEXT",
        [[{"LOWER": {"IN": ["vehicle", "truck", "sedan", "pickup", "bus", "tractor", "trailer", "forklift", "drone"]}}, {"IS_TITLE": True, "OP": "+"}]],
    )
    return nlp, phrase_matcher, matcher


def dedupe_items(items: List[Dict[str, Any]], keys: Tuple[str, ...]) -> List[Dict[str, Any]]:
    seen = set()
    result = []
    for item in items:
        key = tuple(item.get(part) for part in keys)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def consolidate_entity_proposals(proposals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    preferred: Dict[Tuple[int, int, str], Dict[str, Any]] = {}
    for proposal in proposals:
        key = (proposal["start"], proposal["end"], normalize_text(proposal["text"]).lower())
        current = preferred.get(key)
        if current is None:
            preferred[key] = proposal
            continue
        if proposal["extraction_source"] == "model" and current["extraction_source"] != "model":
            preferred[key] = proposal
            continue
        if proposal["confidence"] > current["confidence"]:
            preferred[key] = proposal
    return sorted(preferred.values(), key=lambda item: (item["start"], item["end"], item["label"], item["text"]))


def collect_regex_proposals(text: str) -> List[Dict[str, Any]]:
    proposals: List[Dict[str, Any]] = []
    for pattern, label, confidence, role in REGEX_ENTITY_PATTERNS:
        for match in pattern.finditer(text):
            captured_text = match.group(1) if match.lastindex else match.group(0)
            start = match.start(1) if match.lastindex else match.start()
            end = match.end(1) if match.lastindex else match.end()
            proposals.append(
                {
                    "start": start,
                    "end": end,
                    "text": captured_text,
                    "label": label,
                    "confidence": confidence,
                    "extraction_source": "rule",
                    "role": role,
                    "metadata": {"extractor_name": "regex_domain_patterns"},
                }
            )
    return proposals


def build_gliner_segments(doc) -> List[Tuple[int, str]]:
    segments: List[Tuple[int, str]] = []
    current_start: Optional[int] = None
    current_parts: List[str] = []
    current_length = 0

    for sentence in doc.sents:
        sentence_text = sentence.text.strip()
        if not sentence_text:
            continue
        addition = len(sentence_text) + (1 if current_parts else 0)
        if current_parts and current_length + addition > GLINER_MAX_SEGMENT_CHARS:
            segment_text = " ".join(current_parts).strip()
            if segment_text and current_start is not None:
                segments.append((current_start, segment_text))
            current_parts = [sentence_text]
            current_start = sentence.start_char
            current_length = len(sentence_text)
            continue
        if current_start is None:
            current_start = sentence.start_char
        current_parts.append(sentence_text)
        current_length += addition

    if current_parts and current_start is not None:
        segment_text = " ".join(current_parts).strip()
        if segment_text:
            segments.append((current_start, segment_text))

    if not segments:
        trimmed = doc.text[:GLINER_MAX_SEGMENT_CHARS].strip()
        if trimmed:
            segments.append((0, trimmed))

    return segments


def collect_gliner_proposals(text: str, doc) -> List[Dict[str, Any]]:
    model = load_gliner_model()
    if model is None:
        return []

    truncated_text = text[:GLINER_MAX_TEXT_CHARS]
    proposals: List[Dict[str, Any]] = []
    label_names = [display for _, display in GLINER_LABELS]

    for segment_start, segment_text in build_gliner_segments(doc):
        if segment_start >= len(truncated_text):
            break
        segment_text = truncated_text[segment_start:min(len(truncated_text), segment_start + len(segment_text))]
        if not segment_text:
            continue
        try:
            entities = model.predict_entities(segment_text, label_names, threshold=GLINER_THRESHOLD)
        except Exception:
            continue

        for entity in entities:
            local_start = int(entity.get("start", 0))
            local_end = int(entity.get("end", 0))
            if local_end <= local_start:
                continue
            start = segment_start + local_start
            end = segment_start + local_end
            if end > len(text):
                continue
            surface = text[start:end].strip()
            if not surface:
                continue
            raw_label = str(entity.get("label", "")).strip()
            score = float(entity.get("score", entity.get("confidence", 0.0)) or 0.0)
            proposals.append(
                {
                    "start": start,
                    "end": end,
                    "text": surface,
                    "label": canonicalize_gliner_label(raw_label),
                    "confidence": min(0.97, max(0.35, score)),
                    "extraction_source": "model",
                    "role": "GLiNER zero-shot entity proposal",
                    "metadata": {
                        "extractor_name": "gliner_zero_shot",
                        "model_name": GLINER_MODEL_NAME,
                        "gliner_label": raw_label,
                    },
                }
            )

    return proposals


def collect_entity_proposals(doc, phrase_matcher, matcher, metadata: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    proposals: List[Dict[str, Any]] = []

    for ent in doc.ents:
        start = ent.start_char
        end = ent.end_char
        text = doc.text[start:end]
        label = ent.label_
        if label == "PERSON" and text.lower().startswith(("mr ", "mrs ", "ms ", "dr ")):
            name_parts = text.split(" ", 1)
            if len(name_parts) == 2:
                start += len(name_parts[0]) + 1
                text = name_parts[1]
        proposals.append(
            {
                "start": start,
                "end": end,
                "text": text,
                "label": label,
                "confidence": 0.79 if label in {"ORGANIZATION", "LOCATION"} else 0.74,
                "extraction_source": "rule",
                "role": "spaCy EntityRuler span",
                "metadata": {"extractor_name": "spacy_entity_ruler"},
            }
        )

    for label, token_start, token_end in phrase_matcher(doc):
        span = doc[token_start:token_end]
        proposals.append(
            {
                "start": span.start_char,
                "end": span.end_char,
                "text": span.text,
                "label": doc.vocab.strings[label],
                "confidence": 0.76,
                "extraction_source": "gazetteer",
                "role": "spaCy PhraseMatcher metadata phrase",
                "metadata": {"extractor_name": "spacy_phrase_matcher"},
            }
        )

    for match_id, token_start, token_end in matcher(doc):
        match_name = doc.vocab.strings[match_id]
        span = doc[token_start:token_end]
        if match_name == "PERSON_CONTEXT":
            span = doc[token_start + 1:token_end]
            label = "PERSON"
            confidence = 0.73
            role = "spaCy contextual person pattern"
        elif match_name == "VEHICLE_CONTEXT":
            span = doc[token_start + 1:token_end]
            label = "VEHICLE"
            confidence = 0.8
            role = "spaCy contextual vehicle pattern"
        else:
            label = "LOCATION"
            confidence = 0.77
            role = "spaCy facility code pattern"
        proposals.append(
            {
                "start": span.start_char,
                "end": span.end_char,
                "text": span.text,
                "label": label,
                "confidence": confidence,
                "extraction_source": "rule",
                "role": role,
                "metadata": {"extractor_name": "spacy_matcher"},
            }
        )

    proposals.extend(collect_regex_proposals(doc.text))
    proposals.extend(collect_gliner_proposals(doc.text, doc))
    return consolidate_entity_proposals(dedupe_items(proposals, ("start", "end", "label", "text")))


def entities_in_sentence(sentence, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        entity
        for entity in entities
        if entity["start"] >= sentence.start_char and entity["end"] <= sentence.end_char
    ]


def nearest_entities_around(trigger_start: int, sentence_entities: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    left_candidates = [entity for entity in sentence_entities if entity["end"] <= trigger_start]
    right_candidates = [entity for entity in sentence_entities if entity["start"] >= trigger_start]
    left = max(left_candidates, key=lambda entity: entity["end"], default=None)
    right = min(right_candidates, key=lambda entity: entity["start"], default=None)
    return left, right


def find_trigger(sentence_text: str, cues: List[str]) -> Optional[Tuple[str, int, int]]:
    lowered = sentence_text.lower()
    best = None
    for cue in cues:
        index = lowered.find(cue)
        if index >= 0 and (best is None or index < best[1]):
            best = (cue, index, index + len(cue))
    return best


def build_relation(sentence, relation_type: str, cue: str, cue_start: int, cue_end: int, left_entity, right_entity, confidence: float):
    return {
        "start": sentence.start_char,
        "end": sentence.end_char,
        "relation_type": relation_type,
        "trigger_text": sentence.text[cue_start:cue_end],
        "trigger_start": sentence.start_char + cue_start,
        "trigger_end": sentence.start_char + cue_end,
        "source_span": {"start": left_entity["start"], "end": left_entity["end"], "text": left_entity["text"]},
        "target_span": {"start": right_entity["start"], "end": right_entity["end"], "text": right_entity["text"]},
        "confidence": confidence,
        "metadata": {"extractor_name": "spacy_sentence_patterns", "cue": cue},
    }


def build_event(sentence, event_type: str, cue: str, cue_start: int, cue_end: int, participants, locations, confidence: float):
    return {
        "start": sentence.start_char,
        "end": sentence.end_char,
        "event_type": event_type,
        "trigger_text": sentence.text[cue_start:cue_end],
        "trigger_start": sentence.start_char + cue_start,
        "trigger_end": sentence.start_char + cue_end,
        "actor_spans": participants[:1],
        "target_spans": participants[1:3],
        "location_spans": locations[:3],
        "confidence": confidence,
        "metadata": {"extractor_name": "spacy_sentence_patterns", "cue": cue},
    }


def build_claim(sentence, claim_type: str, cue: str, cue_start: int, cue_end: int, speaker, sentence_entities, confidence: float):
    return {
        "start": sentence.start_char,
        "end": sentence.end_char,
        "claim_type": claim_type,
        "claim_text": sentence.text.strip(),
        "cue_text": sentence.text[cue_start:cue_end],
        "cue_start": sentence.start_char + cue_start,
        "cue_end": sentence.start_char + cue_end,
        "speaker_span": None if speaker is None else {"start": speaker["start"], "end": speaker["end"], "text": speaker["text"]},
        "subject_spans": sentence_entities[:2],
        "object_spans": sentence_entities[2:4],
        "confidence": confidence,
        "metadata": {"extractor_name": "spacy_sentence_patterns", "cue": cue},
    }


def extract_structured(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = payload["text"]
    metadata = payload.get("metadata") or {}
    nlp, phrase_matcher, matcher = build_nlp(metadata)
    doc = nlp(text)
    warnings: List[str] = []
    entities = collect_entity_proposals(doc, phrase_matcher, matcher, metadata)
    coref_entities, fastcoref_status, fastcoref_warnings = expand_entities_with_coref(text, entities)
    warnings.extend(fastcoref_warnings)
    if coref_entities:
        entities = consolidate_entity_proposals(entities + coref_entities)

    relik_entities, relik_relations, relik_status, relik_warnings = collect_relik_proposals(text)
    warnings.extend(relik_warnings)
    if relik_entities:
        entities = consolidate_entity_proposals(entities + relik_entities)

    relations: List[Dict[str, Any]] = []
    events: List[Dict[str, Any]] = []
    claims: List[Dict[str, Any]] = []

    for sentence in doc.sents:
        sentence_text = sentence.text
        if not sentence_text.strip():
            continue
        sentence_entities = entities_in_sentence(sentence, entities)
        if not sentence_entities:
            continue

        participants = [{"start": entity["start"], "end": entity["end"], "text": entity["text"]} for entity in sentence_entities]
        locations = [participant for participant in participants if any(token in participant["text"].lower() for token in LOCATION_SUFFIXES + FACILITY_PREFIXES)]

        for cues, relation_type, confidence in (
            (FUNDING_CUES, "FUNDED", 0.84),
            (COMMUNICATION_CUES, "COMMUNICATED_WITH", 0.81),
            (MOVEMENT_CUES, "MOVED_WITH", 0.76),
            (ASSOCIATION_CUES, "ASSOCIATED_WITH", 0.69),
        ):
            trigger = find_trigger(sentence_text, cues)
            if not trigger:
                continue
            cue, cue_start, cue_end = trigger
            left, right = nearest_entities_around(sentence.start_char + cue_start, sentence_entities)
            if left and right and left["text"] != right["text"]:
                relations.append(build_relation(sentence, relation_type, cue, cue_start, cue_end, left, right, confidence))

        if trigger := find_trigger(sentence_text, COMMUNICATION_CUES):
            cue, cue_start, cue_end = trigger
            events.append(build_event(sentence, "COMMUNICATION_EVENT", cue, cue_start, cue_end, participants, locations, 0.8))
        if trigger := find_trigger(sentence_text, FUNDING_CUES):
            cue, cue_start, cue_end = trigger
            events.append(build_event(sentence, "FUNDING_EVENT", cue, cue_start, cue_end, participants, locations, 0.83))
        if trigger := find_trigger(sentence_text, MOVEMENT_CUES):
            cue, cue_start, cue_end = trigger
            events.append(build_event(sentence, "MOVEMENT_EVENT", cue, cue_start, cue_end, participants, locations, 0.77))
        if trigger := find_trigger(sentence_text, CYBER_CUES):
            cue, cue_start, cue_end = trigger
            events.append(build_event(sentence, "CYBER_EVENT", cue, cue_start, cue_end, participants, locations, 0.74))

        if trigger := find_trigger(sentence_text, REPORTING_CUES):
            cue, cue_start, cue_end = trigger
            left, _ = nearest_entities_around(sentence.start_char + cue_start, sentence_entities)
            claim_type = "REQUEST" if cue in {"requested"} else "REPORTED_STATEMENT"
            claims.append(build_claim(sentence, claim_type, cue, cue_start, cue_end, left, participants, 0.72))

    if relik_relations:
        relations.extend(relik_relations)

    gliner_active = any(
        item.get("metadata", {}).get("extractor_name") == "gliner_zero_shot"
        for item in entities
        if isinstance(item.get("metadata"), dict)
    )
    if gliner_active:
        gliner_status = adapter_status("active", "GLiNER zero-shot spans contributed to the entity set.")
    elif not gliner_enabled():
        gliner_status = adapter_status("disabled", "Set TEVEL_ENABLE_GLINER=1 to enable GLiNER zero-shot extraction.")
    elif _GLINER_DISABLED_REASON:
        gliner_status = adapter_status("unavailable", _GLINER_DISABLED_REASON)
        warnings.append(f"GLiNER unavailable: {_GLINER_DISABLED_REASON}")
    else:
        gliner_status = adapter_status("configured", "GLiNER is enabled but did not add accepted spans for this text.")

    return {
        "extractor_name": "spacy_gliner_hybrid_v2" if any(item["extraction_source"] == "model" for item in entities) else "spacy_rule_hybrid_v1",
        "mentions": entities,
        "relations": dedupe_items(relations, ("start", "end", "relation_type", "trigger_start")),
        "events": dedupe_items(events, ("start", "end", "event_type", "trigger_start")),
        "claims": dedupe_items(claims, ("start", "end", "claim_type", "cue_start")),
        "warnings": list(dict.fromkeys(warnings)),
        "adapter_status": {
            "spacy": adapter_status("active", "spaCy sentencizer and rule matchers are active."),
            "gliner": gliner_status,
            "fastcoref": fastcoref_status,
            "relik": relik_status,
        },
    }


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("usage: sidecar_m2_helper.py <parse_html|parse_file|smart_extract|normalize_location|resolve_toponym_context|person_extract|person_build_dossier>")

    command = sys.argv[1]
    payload = json.load(sys.stdin)

    if command == "parse_html":
        result = parse_html(payload)
    elif command == "parse_file":
        result = parse_file(payload)
    elif command == "smart_extract":
        result = extract_structured(payload)
    elif command == "normalize_location":
        result = normalize_location(payload)
    elif command == "resolve_toponym_context":
        result = resolve_toponym_context(payload)
    elif command == "person_extract":
        result = person_extract(payload)
    elif command == "person_build_dossier":
        result = person_build_dossier(payload)
    else:
        raise SystemExit(f"unknown command: {command}")

    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
