#!/usr/bin/env python3
"""
Build Inkstone Static hanzi data from Make Me A Hanzi line-delimited JSON files.

Usage:
	python tools/build_hanzi_data.py dictionary.txt graphics.txt data/hanzi.json

The output is a single JSON object keyed by character. It keeps the fields the
static browser app needs: definition, pinyin, decomposition, etymology, radical,
strokes, medians, matches, dependencies, and components.

This intentionally avoids Meteor, Mongo, Cordova, and any network access.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List

IDS_ARITY = {
		"⿰": 2, "⿱": 2, "⿴": 2, "⿵": 2, "⿶": 2, "⿷": 2,
		"⿸": 2, "⿹": 2, "⿺": 2, "⿻": 2, "⿳": 3, "⿲": 3,
}
IDS_OPERATORS = set(IDS_ARITY)
UNKNOWN_COMPONENT = "？"


def read_jsonl(path: Path) -> Dict[str, Dict[str, Any]]:
		rows: Dict[str, Dict[str, Any]] = {}
		with path.open("r", encoding="utf-8") as handle:
				for line_number, line in enumerate(handle, 1):
						line = line.strip()
						if not line:
								continue
						try:
								row = json.loads(line)
						except json.JSONDecodeError as exc:
								raise SystemExit(f"{path}:{line_number}: invalid JSON: {exc}") from exc
						char = row.get("character")
						if not isinstance(char, str) or len(char) == 0:
								raise SystemExit(f"{path}:{line_number}: missing character field")
						rows[char] = row
		return rows


def dependency_chars(decomposition: str) -> Iterable[str]:
		for char in decomposition or "":
				if char in IDS_OPERATORS or char in {"？", "?"}:
						continue
				yield char


def build_dependencies(row: Dict[str, Any], all_rows: Dict[str, Dict[str, Any]]) -> Dict[str, str]:
		deps: Dict[str, str] = {}
		for char in dependency_chars(row.get("decomposition", "")):
				if char == row.get("character") or char not in all_rows:
						continue
				dep = all_rows[char]
				definition = dep.get("definition") or "(unknown)"
				pinyin = dep.get("pinyin") or []
				deps[char] = f"{', '.join(pinyin)} - {definition}" if pinyin else definition
		return deps


class DecompositionError(Exception):
		pass


def parse_decomposition_subtree(decomposition: str, index: List[int]) -> Dict[str, Any]:
		if index[0] >= len(decomposition):
				raise DecompositionError(f"Not enough characters in {decomposition!r}")
		current = decomposition[index[0]]
		index[0] += 1
		if current in IDS_ARITY:
				return {
						"type": "compound",
						"value": current,
						"children": [parse_decomposition_subtree(decomposition, index) for _ in range(IDS_ARITY[current])],
				}
		if current == UNKNOWN_COMPONENT or current == "?":
				return {"type": "character", "value": "?"}
		# Make Me A Hanzi decompositions may include variant annotations, e.g. 心[1].
		if index[0] < len(decomposition) and decomposition[index[0]] == "[":
				close = decomposition.find("]", index[0])
				if close != -1:
						index[0] = close + 1
		return {"type": "character", "value": current}


def parse_decomposition_tree(decomposition: str) -> Dict[str, Any]:
		decomposition = decomposition or UNKNOWN_COMPONENT
		index = [0]
		tree = parse_decomposition_subtree(decomposition, index)
		if index[0] != len(decomposition):
				raise DecompositionError(f"Too many characters in decomposition {decomposition!r}")
		return tree


def component_at_path(tree: Dict[str, Any], path: List[int]) -> Dict[str, Any] | None:
		node = tree
		for child_index in path:
				children = node.get("children")
				if not children or child_index < 0 or child_index >= len(children):
						return None
				node = children[child_index]
		return node


def compute_components(character: str, stroke_index: int, rows: Dict[str, Dict[str, Any]], result: Dict[str, int] | None = None) -> Dict[str, int]:
		"""Map a stroke to the component ancestry used by the original Inkstone matcher.

		The matcher uses this to allow specific multi-stroke shortcuts, such as writing
		some radicals as one gesture. If anything is inconsistent in the source data,
		we fall back to the whole-character mapping for that stroke instead of failing
		the entire build.
		"""
		result = dict(result or {})
		result[character] = stroke_index
		data = rows.get(character)
		if not data:
				return result
		matches = data.get("matches") or []
		if stroke_index >= len(matches) or matches[stroke_index] is None:
				return result
		match = matches[stroke_index]
		try:
				node = component_at_path(parse_decomposition_tree(data.get("decomposition", "")), match)
		except DecompositionError:
				return result
		if not node or node.get("type") != "character":
				return result
		child_character = node.get("value")
		if not child_character or child_character == "?" or child_character not in rows:
				return result

		child_index = 0
		for i in range(stroke_index):
				if (matches[i] if i < len(matches) else None) == match:
						child_index += 1
		return compute_components(child_character, child_index, rows, result)


def build_components(row: Dict[str, Any], all_rows: Dict[str, Dict[str, Any]]) -> List[Dict[str, int]]:
		char = row["character"]
		components: List[Dict[str, int]] = []
		for i, _ in enumerate(row.get("strokes", [])):
				try:
						components.append(compute_components(char, i, all_rows))
				except Exception:
						components.append({char: i})
		return components


def merge_rows(dictionary: Dict[str, Dict[str, Any]], graphics: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
		output: Dict[str, Dict[str, Any]] = {}

		# First create every merged row, then compute component ancestry in a second
		# pass. Component mapping may recurse into other characters, so it needs the
		# complete merged table rather than rows that happen to have been processed
		# earlier in dictionary order.
		for char, row in dictionary.items():
				if char not in graphics:
						continue
				merged = dict(row)
				merged.update(graphics[char])
				merged.pop("normalized_medians", None)
				merged.setdefault("definition", "")
				merged.setdefault("pinyin", [])
				merged.setdefault("decomposition", char)
				merged.setdefault("radical", "")
				merged.setdefault("matches", [[i] for i, _ in enumerate(merged.get("strokes", []))])
				output[char] = merged

		for merged in output.values():
				merged["dependencies"] = build_dependencies(merged, dictionary)
				merged["components"] = build_components(merged, output)

		return output


def main() -> None:
		parser = argparse.ArgumentParser()
		parser.add_argument("dictionary", type=Path)
		parser.add_argument("graphics", type=Path)
		parser.add_argument("output", type=Path)
		parser.add_argument("--pretty", action="store_true", help="pretty-print JSON instead of minifying")
		args = parser.parse_args()

		dictionary = read_jsonl(args.dictionary)
		graphics = read_jsonl(args.graphics)
		data = merge_rows(dictionary, graphics)
		args.output.parent.mkdir(parents=True, exist_ok=True)
		with args.output.open("w", encoding="utf-8") as handle:
				if args.pretty:
						json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
				else:
						json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
		chars_path = args.output.with_name("characters.txt")
		chars_path.write_text("\n".join(data.keys()) + "\n", encoding="utf-8")
		print(f"Wrote {len(data)} characters to {args.output}")
		print(f"Wrote character index to {chars_path}")


if __name__ == "__main__":
		main()
