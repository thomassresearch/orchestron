"""Discoverable authoring schema; semantic checks live in the shared operations."""


def object_schema(properties, required=()):
    return {"type": "object", "additionalProperties": False, "properties": properties, "required": list(required)}


ID = {"type": "string", "minLength": 1, "maxLength": 128}
TIME = {
    "oneOf": [
        {"type": "integer", "minimum": 0, "maximum": 20160000000},
        {"type": "string", "pattern": r"^[0-9]+(?:/[1-9][0-9]*)?(?:bar|b|l|t)$"},
    ]
}
PAIR = object_schema(
    {k: {"type": "integer", "minimum": -127, "maximum": 127} for k in ("diatonicSteps", "chromaticSemitones")},
    ("diatonicSteps", "chromaticSemitones"),
)
PLAN = object_schema(
    {
        "base": PAIR,
        "repetitions": {
            "type": "array",
            "maxItems": 4096,
            "items": object_schema(
                {"index": {"type": "integer", "minimum": 0, "maximum": 40320000000}, "offset": PAIR},
                ("index", "offset"),
            ),
        },
    },
    ("base", "repetitions"),
)
CHILD = {
    "oneOf": [
        ID,
        object_schema(
            {
                "id": ID,
                "definitionId": ID,
                "rest": TIME,
                "restTicks": {"type": "integer", "minimum": 1},
                "repeatIndex": {"type": "integer", "minimum": 0, "maximum": 40320000000},
                "transpose": PLAN,
            }
        ),
    ]
}
CHILDREN = {"type": "array", "minItems": 1, "maxItems": 256, "items": CHILD}
MUSIC = object_schema(
    {
        "lengthBeats": {"type": "integer", "minimum": 1, "maximum": 8192},
        "scaleRoot": {"type": "string"},
        "scaleType": {"enum": ["major", "minor", "neutral"]},
        "mode": {"type": "string"},
        "steps": {"type": "string"},
        "grid": {"type": "string"},
        "velocity": {"type": "integer", "minimum": 1, "maximum": 127},
        "groove": {"type": "string"},
        "hits": {"type": ["string", "array"]},
        "curve": {"type": ["string", "array"]},
        "notes": {"type": "array"},
    }
)
DEFINITION = object_schema(
    {
        "id": ID,
        "name": ID,
        "kind": {"enum": ["pattern", "group", "supergroup"]},
        "music": MUSIC,
        "payload": {
            "type": "object",
            "description": "Source-specific musical payload patch; inspect payload to discover retained fields.",
        },
        "children": CHILDREN,
        "color": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"},
        "presetId": {"type": ["string", "null"]},
        "transpose": PLAN,
    },
    ("id",),
)
CLIP = object_schema(
    {
        "id": ID,
        "name": ID,
        "start": TIME,
        "length": TIME,
        "offset": TIME,
        "mode": {"enum": ["once", "loop"]},
        "children": CHILDREN,
        "repeat": {"type": "integer", "minimum": 1},
        "repeatIndexBase": {"type": "integer", "minimum": 0},
        "transposePlacements": {
            "type": "array",
            "items": object_schema(
                {"path": {"type": "array", "items": ID, "minItems": 1, "maxItems": 3}, "plan": PLAN}, ("path", "plan")
            ),
        },
    },
    ("id",),
)
LANE = object_schema(
    {
        "id": ID,
        "source": {"enum": ["sequencer", "drummer", "score", "controller", "arpeggiator"]},
        "name": ID,
        "channel": {"type": "integer", "minimum": 1, "maximum": 16},
        "timing": {"type": "object"},
        "settings": {"type": "object"},
        "automationTarget": object_schema(
            {"instrumentId": ID, "controllerNodeIds": {"type": "array", "items": {"type": "string"}, "minItems": 1}},
            ("instrumentId", "controllerNodeIds"),
        ),
        "definitions": {"type": "array", "items": DEFINITION, "maxItems": 512},
        "clips": {"type": "array", "items": CLIP, "maxItems": 2048},
    },
    ("id", "source"),
)
SONG_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    **object_schema(
        {
            "schema": {"const": "orchestron-song"},
            "version": {"const": 1},
            "id": ID,
            "songMeter": {"type": "array", "items": {"type": "integer", "minimum": 1}, "minItems": 2, "maxItems": 2},
            "tempo": {"type": "integer", "minimum": 30, "maximum": 300},
            "end": TIME,
            "loop": {"type": "boolean"},
            "instruments": {
                "type": "array",
                "items": object_schema(
                    {
                        "id": ID,
                        "patchId": ID,
                        "channel": {"type": "integer", "minimum": 0, "maximum": 16},
                        "values": {"type": "object"},
                        "mappings": {
                            "type": "object",
                            "additionalProperties": {"type": "integer", "minimum": 1, "maximum": 50},
                        },
                    },
                    ("id", "patchId", "channel"),
                ),
            },
            "lanes": {"type": "array", "items": LANE, "maxItems": 72},
            "automation": {
                "type": "array",
                "items": object_schema(
                    {"instrumentId": ID, "laneId": ID, "clipId": ID, "start": TIME, "length": TIME, "id": ID},
                    ("instrumentId",),
                ),
            },
        },
        ("schema", "version", "id"),
    ),
}
