#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.services.opcode_service import OpcodeService  # noqa: E402


LANGUAGE_CODES: dict[str, str] = {
    "english": "en",
    "german": "de",
    "french": "fr",
    "spanish": "es",
}

MANUAL_SECTION_NAMES = {
    "description": "description",
    "initialization": "initialization",
    "performance": "performance",
}

REQUEST_TIMEOUT_SECONDS = 20
REQUEST_RETRIES = 3
TRANSLATE_DELAY_SECONDS = 0.06
TRANSLATE_TIMEOUT_SECONDS = 10
TRANSLATE_RETRIES = 2
GOOGLE_TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"


@dataclass(slots=True)
class ManualDetails:
    summary: str
    description: str
    initialization_lines: list[tuple[list[str], str]]
    performance_lines: list[tuple[list[str], str]]
    syntax_outputs: list[list[str]]


def normalize_spaces(text: str) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([.,;:!?])", r"\1", compact)


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def canonical_param_tokens(raw: str) -> list[str]:
    cleaned = re.sub(r"\([^)]*\)", "", raw)
    tokens = re.split(r"[,/]|(?:\band\b)", cleaned)
    out: list[str] = []
    for token in tokens:
        compact = normalize_spaces(token)
        if not compact:
            continue
        compact = re.sub(r"[^A-Za-z0-9_]+", "", compact)
        if not compact:
            continue
        compact = compact.lower()
        out.append(compact)
        if len(compact) > 1 and compact[0] in {"a", "k", "i", "x", "s"}:
            out.append(compact[1:])
    unique: list[str] = []
    seen: set[str] = set()
    for token in out:
        if token not in seen:
            seen.add(token)
            unique.append(token)
    return unique


def split_param_definition(text: str) -> tuple[list[str], str] | None:
    match = re.match(r"^(.+?)\s+--\s+(.+)$", text)
    if not match:
        return None
    lhs = normalize_spaces(match.group(1))
    rhs = normalize_spaces(match.group(2))
    if not lhs or not rhs:
        return None
    return canonical_param_tokens(lhs), rhs


def fetch_html(url: str) -> str:
    last_error: Exception | None = None
    for _ in range(REQUEST_RETRIES):
        try:
            response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
            response.raise_for_status()
            return response.text
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(0.4)
    if last_error:
        raise last_error
    raise RuntimeError(f"Unable to fetch URL: {url}")


def section_texts(soup: BeautifulSoup) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {name: [] for name in MANUAL_SECTION_NAMES.values()}
    for section in soup.select("div.refsect1"):
        heading = section.find("h2")
        if not heading:
            continue
        key = normalize_spaces(heading.get_text(" ", strip=True)).lower()
        normalized = MANUAL_SECTION_NAMES.get(key)
        if not normalized:
            continue
        paragraphs = []
        for paragraph in section.find_all("p"):
            text = normalize_spaces(paragraph.get_text(" ", strip=True))
            if text:
                paragraphs.append(text)
        out[normalized] = paragraphs
    return out


def syntax_outputs(soup: BeautifulSoup, opcode_name: str) -> list[list[str]]:
    results: list[list[str]] = []
    for pre in soup.select("pre.synopsis"):
        text = normalize_spaces(pre.get_text(" ", strip=True))
        if not text:
            continue
        opcode_match = re.search(rf"\b{re.escape(opcode_name)}\b", text)
        if not opcode_match:
            continue
        left = normalize_spaces(text[: opcode_match.start()])
        if not left:
            continue
        variables = [normalize_spaces(item) for item in left.split(",") if normalize_spaces(item)]
        if variables:
            results.append(variables)
    return results


def parse_manual(url: str, opcode_name: str) -> ManualDetails:
    html = fetch_html(url)
    soup = BeautifulSoup(html, "xml")

    summary = ""
    namediv = soup.select_one("div.refnamediv > p")
    if namediv:
        summary = normalize_spaces(namediv.get_text(" ", strip=True))
        summary = re.sub(rf"^{re.escape(opcode_name)}\s+[-—]\s+", "", summary, flags=re.IGNORECASE)

    sections = section_texts(soup)
    description = " ".join(sections.get("description", [])[:2]).strip()
    initialization = [item for item in (split_param_definition(text) for text in sections.get("initialization", [])) if item]
    performance = [item for item in (split_param_definition(text) for text in sections.get("performance", [])) if item]

    return ManualDetails(
        summary=summary,
        description=description,
        initialization_lines=[item for item in initialization if item],
        performance_lines=[item for item in performance if item],
        syntax_outputs=syntax_outputs(soup, opcode_name),
    )


def best_param_match(port_id: str, port_name: str, candidates: list[tuple[list[str], str]]) -> str | None:
    key_candidates = {
        normalize_key(port_id),
        normalize_key(port_name),
    }
    pid = port_id.lower()
    if len(pid) > 1 and pid[0] in {"a", "k", "i", "x", "s"}:
        key_candidates.add(normalize_key(pid[1:]))

    best_score = 0
    best_text: str | None = None
    for tokens, text in candidates:
        token_set = {normalize_key(token) for token in tokens if normalize_key(token)}
        score = len(key_candidates & token_set)
        if score > best_score:
            best_score = score
            best_text = text
    return best_text


def generic_port_detail(port_name: str, signal_type: str, is_output: bool) -> str:
    label = normalize_spaces(port_name)
    kind = {
        "a": "audio-rate",
        "k": "control-rate",
        "i": "init-rate",
        "S": "string-rate",
        "f": "function-table",
    }.get(signal_type, "signal")
    if is_output:
        return f"{label} {kind} output."
    return f"{label} parameter at {kind}."


def merged_description(summary: str, description: str, fallback: str) -> str:
    normalized_summary = summary.strip()
    normalized_description = description.strip()
    if normalized_summary and normalized_description:
        lower_summary = normalized_summary.lower()
        lower_description = normalized_description.lower()
        if lower_summary == lower_description or lower_description.startswith(lower_summary):
            parts = [normalized_description]
        elif lower_summary.startswith(lower_description):
            parts = [normalized_summary]
        else:
            parts = [normalized_summary, normalized_description]
    else:
        parts = [item.strip() for item in [normalized_summary, normalized_description] if item and item.strip()]
    merged = " ".join(parts).strip()
    if merged:
        return merged
    return fallback.strip() if fallback.strip() else "-"


def translate_text(text: str, target: str) -> str:
    if target == "en":
        return text
    params = {
        "client": "gtx",
        "sl": "en",
        "tl": target,
        "dt": "t",
        "q": text,
    }
    last_error: Exception | None = None
    for _ in range(TRANSLATE_RETRIES):
        try:
            response = requests.get(GOOGLE_TRANSLATE_URL, params=params, timeout=TRANSLATE_TIMEOUT_SECONDS)
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, list) and payload and isinstance(payload[0], list):
                translated = "".join(
                    item[0] for item in payload[0] if isinstance(item, list) and item and isinstance(item[0], str)
                )
                if translated.strip():
                    return normalize_spaces(translated)
            return text
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(0.2)
    if last_error:
        return text
    return text


def translate_strings(strings: set[str], skip_translate: bool = False) -> dict[str, dict[str, str]]:
    translations: dict[str, dict[str, str]] = {
        language: {} for language in LANGUAGE_CODES
    }
    sorted_strings = sorted(strings)
    total = len(sorted_strings) * (len(LANGUAGE_CODES) - 1)
    done = 0
    for index, text in enumerate(sorted_strings, start=1):
        translations["english"][text] = text
        for language, code in LANGUAGE_CODES.items():
            if language == "english":
                continue
            if skip_translate:
                translations[language][text] = text
                continue
            translated = translate_text(text, code)
            translations[language][text] = translated
            done += 1
            if done % 40 == 0:
                print(f"Translated {done}/{total} strings...", flush=True)
            time.sleep(TRANSLATE_DELAY_SECONDS)
        if index % 80 == 0:
            print(f"Processed {index}/{len(sorted_strings)} source strings...", flush=True)
    return translations


def build_dataset(limit: int | None = None, skip_translate: bool = False) -> dict[str, Any]:
    service = OpcodeService(icon_prefix="/static/icons")
    opcodes = service.list_opcodes()
    if limit is not None:
        opcodes = opcodes[:limit]
    unique_urls = sorted({opcode.documentation_url for opcode in opcodes if opcode.documentation_url})

    manuals: dict[str, ManualDetails] = {}
    for index, url in enumerate(unique_urls, start=1):
        print(f"[{index}/{len(unique_urls)}] Fetching {url}", flush=True)
        # Use URL slug as best-effort opcode name for syntax parsing.
        slug = Path(url).stem
        manuals[url] = parse_manual(url, slug)

    english_payload: dict[str, dict[str, Any]] = {}
    all_strings: set[str] = set()
    for opcode in opcodes:
        manual = manuals.get(opcode.documentation_url)
        description = merged_description(
            manual.summary if manual else "",
            manual.description if manual else "",
            opcode.description,
        )

        input_candidates: list[tuple[list[str], str]] = []
        output_candidates: list[tuple[list[str], str]] = []
        if manual:
            input_candidates = [*manual.initialization_lines, *manual.performance_lines]

        inputs: dict[str, str] = {}
        for port in opcode.inputs:
            detail = best_param_match(port.id, port.name, input_candidates)
            if not detail:
                detail = generic_port_detail(port.name, port.signal_type.value, is_output=False)
            inputs[port.id] = detail
            all_strings.add(detail)

        outputs: dict[str, str] = {}
        for index, port in enumerate(opcode.outputs):
            detail = best_param_match(port.id, port.name, output_candidates)
            if not detail and manual and manual.syntax_outputs:
                syntax_vars = manual.syntax_outputs[0]
                if index < len(syntax_vars):
                    variable = syntax_vars[index]
                    detail = f"Output variable `{variable}` from {opcode.name}."
            if not detail:
                detail = generic_port_detail(port.name, port.signal_type.value, is_output=True)
            outputs[port.id] = detail
            all_strings.add(detail)

        all_strings.add(description)
        english_payload[opcode.name] = {
            "description": description,
            "inputs": inputs,
            "outputs": outputs,
        }

    print(f"Translating {len(all_strings)} unique strings...", flush=True)
    translations = translate_strings(all_strings, skip_translate=skip_translate)

    localized_dataset: dict[str, Any] = {}
    for opcode_name, payload in english_payload.items():
        localized_dataset[opcode_name] = {
            "description": {
                language: translations[language][payload["description"]]
                for language in LANGUAGE_CODES
            },
            "inputs": {
                port_id: {language: translations[language][text] for language in LANGUAGE_CODES}
                for port_id, text in payload["inputs"].items()
            },
            "outputs": {
                port_id: {language: translations[language][text] for language in LANGUAGE_CODES}
                for port_id, text in payload["outputs"].items()
            },
        }

    return localized_dataset


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate localized opcode documentation detail data.")
    parser.add_argument(
        "--output",
        default=str(REPO_ROOT / "frontend/src/lib/opcodeDocDetails.json"),
        help="Output JSON file path.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Process only the first N opcodes.")
    parser.add_argument(
        "--skip-translate",
        action="store_true",
        help="Skip de/fr/es translation (copy English text).",
    )
    args = parser.parse_args()

    dataset = build_dataset(limit=args.limit, skip_translate=args.skip_translate)
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(dataset, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(dataset)} opcode entries to {output_path}")


if __name__ == "__main__":
    main()
