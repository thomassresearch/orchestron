"""Preview/apply a backed-up SQLite migration to the internal Master.

Run with the backend stopped: python -m backend.tools.migrate_internal_master
--database PATH [--apply]. Startup uses the same idempotent migration.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

from backend.app.models.audio import AudioGraph, MixerState
from backend.app.models.patch import PatchGraph
from backend.app.services.master_migration import (
    is_neutral_master, normalize_master_app_state, normalize_master_config,
)
from backend.app.services.persisted_json_limits import (
    assert_persisted_json_limits, DEFAULT_PERFORMANCE_CONFIG_MAX_BYTES,
    DEFAULT_APP_STATE_MAX_BYTES, DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES,
)


def _references(value, identity):
    if isinstance(value, dict):
        return any(k == identity or _references(v, identity) for k, v in value.items())
    if isinstance(value, list):
        return any(_references(v, identity) for v in value)
    return value == identity


def migrate_database(database: Path, *, apply=False, max_config_bytes=DEFAULT_PERFORMANCE_CONFIG_MAX_BYTES,
                     max_state_bytes=DEFAULT_APP_STATE_MAX_BYTES,
                     max_string_bytes=DEFAULT_PERSISTED_JSON_STRING_MAX_BYTES) -> dict:
    database = database.resolve()
    connection = sqlite3.connect(f"file:{database}?mode={'rw' if apply else 'ro'}", uri=True)
    connection.row_factory = sqlite3.Row
    backup = None
    try:
        if apply:
            connection.execute("BEGIN IMMEDIATE")
        patches = {
            row["id"]: {**dict(row), "graph": json.loads(row["graph_json"])}
            for row in connection.execute("SELECT * FROM patches")
        }
        updates = []
        documents = []
        for table, column, normalize in (
            ("performances", "config_json", normalize_master_config),
            ("app_state", "state_json", normalize_master_app_state),
        ):
            for row in connection.execute(f"SELECT id, {column} FROM {table}"):
                original = json.loads(row[column])
                updated = normalize(original, patches.get)
                # Close pristine obsolete Master tabs, preserving all edited
                # drafts, metadata changes, and references elsewhere.
                if table == "app_state":
                    tabs = updated.get("instrumentTabs", [])
                    retained = []
                    for tab in tabs:
                        draft = tab.get("patch", {})
                        saved = patches.get(draft.get("id"))
                        pristine = saved and saved["name"].casefold() == "master" and is_neutral_master(saved) and is_neutral_master(draft)
                        pristine = pristine and all(draft.get(k) == saved.get(k) for k in (
                            "name", "description", "instrument_type", "schema_version", "always_on", "is_template",
                        ))
                        pristine = pristine and PatchGraph.model_validate(draft["graph"]) == PatchGraph.model_validate(saved["graph"])
                        if not pristine:
                            retained.append(tab)
                    if retained != tabs:
                        updated = {**updated, "instrumentTabs": retained}
                        if not any(tab.get("id") == updated.get("activeInstrumentTabId") for tab in retained):
                            updated["activeInstrumentTabId"] = retained[0]["id"] if retained else ""
                documents.append(updated)
                if updated != original:
                    graph = updated.get("audioGraph")
                    if graph:
                        AudioGraph.model_validate(graph)
                        MixerState.model_validate(updated.get("mixer", {}))
                    assert_persisted_json_limits(
                        value=updated, field_name=column,
                        max_document_bytes=max_config_bytes if table == "performances" else max_state_bytes,
                        max_string_bytes=max_string_bytes,
                    )
                    updates.append((table, column, row["id"], json.dumps(updated, ensure_ascii=False, separators=(",", ":"))))
        candidates = [identity for identity, patch in patches.items()
                      if patch["name"].casefold() == "master" and is_neutral_master(patch)
                      and not any(_references(document, identity) for document in documents)]
        if apply and (updates or candidates):
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
            backup = database.with_name(database.name + ".before-internal-master-" + stamp + ".bak")
            # A separate read connection captures the committed pre-migration
            # database, including WAL contents, while our write lock is held.
            with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as source, sqlite3.connect(backup) as target:
                source.backup(target)
            for table, column, identity, payload in updates:
                connection.execute(f"UPDATE {table} SET {column}=? WHERE id=?", (payload, identity))
            connection.executemany("DELETE FROM patches WHERE id=?", [(identity,) for identity in candidates])
        if apply:
            connection.commit()
        return {"applied": apply, "updated_documents": len(updates), "removed_patch_ids": candidates,
                "backup": str(backup) if backup else None}
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--apply", action="store_true", help="Back up and apply; default only previews changes.")
    args = parser.parse_args()
    print(json.dumps(migrate_database(args.database, apply=args.apply), indent=2))


if __name__ == "__main__":
    main()
