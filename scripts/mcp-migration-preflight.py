"""Read-only production gates before Alchemy applies the MCP migrations."""

import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import urllib.request


def main():
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    origin = f"https://api.cloudflare.com/client/v4/accounts/{account}"

    def api(path, body=None):
        request = urllib.request.Request(
            origin + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            envelope = json.load(response)
        if not envelope.get("success"):
            raise RuntimeError("Cloudflare preflight query failed; no migration attempted")
        return envelope["result"]

    databases = api("/d1/database?per_page=100")
    matches = [d for d in databases if d["name"] == "gbfm-Database-prod-dukgsgc57rbsagpi"]
    if len(matches) != 1:
        raise RuntimeError("Expected exactly one known production database; refusing deployment")
    database_id = matches[0]["uuid"]

    def query(sql):
        # This preflight never submits DDL, DML, ledger adoption or repair.
        if not sql.lstrip().upper().startswith("SELECT ") or ";" in sql:
            raise ValueError("Only a single read-only SELECT is allowed")
        results = api(f"/d1/database/{database_id}/query", {"sql": sql})
        if len(results) != 1 or not results[0].get("success"):
            raise RuntimeError("Invalid preflight result; no migration attempted")
        return results[0]["results"]

    files = sorted(Path("apps/server/drizzle-d1").glob("*.sql"))
    sources = {p.name: p.read_bytes().decode("utf-8") for p in files}
    if not {"0017_mcp_domain_revisions.sql", "0020_playlist_command_revisions.sql"} <= sources.keys():
        raise RuntimeError("Expected consolidated MCP migration directory; refusing deployment")
    hashes = {name: hashlib.sha256(sql.encode()).hexdigest() for name, sql in sources.items()}
    tables = {r["name"] for r in query("SELECT name FROM sqlite_master WHERE type='table'")}
    if "__alchemy_migrations" not in tables:
        diagnostic = {"migration_tables": sorted(t for t in tables if "migration" in t.lower())}
        for table in ["d1_migrations", "__drizzle_migrations"]:
            if table not in tables:
                continue
            columns = {r["name"] for r in query(f"SELECT name FROM pragma_table_info('{table}')")}
            diagnostic[table + "_columns"] = sorted(columns)
            if "name" in columns:
                projection = "name, hash" if "hash" in columns else "name"
                diagnostic[table] = query(f"SELECT {projection} FROM {table} ORDER BY id LIMIT 1000")
        if "music_reminder" in tables:
            diagnostic["reminder_counts"] = query(
                "SELECT count(*) AS total, "
                "sum(CASE WHEN COALESCE((is_sent=1 AND status='sent') OR "
                "(is_sent=0 AND status IN ('pending','processing','failed')),0)=0 THEN 1 ELSE 0 END) "
                "AS invalid_reminders, "
                "sum(CASE WHEN is_sent=0 AND status IN ('pending','processing','failed') THEN 1 ELSE 0 END) "
                "AS historical_unsent_to_fence FROM music_reminder"
            )
        if "music_playlists" in tables:
            diagnostic["playlist_counts"] = query(
                "SELECT count(*) AS invalid_playlist_revisions FROM music_playlists "
                "WHERE typeof(revision)<>'integer' OR revision NOT BETWEEN 0 AND 9007199254740991"
            )
        print(json.dumps(diagnostic, indent=2))
        raise RuntimeError("Production Alchemy ledger missing; inspect legacy history before rollout")
    ledger = query("SELECT name, hash FROM __alchemy_migrations ORDER BY id")
    applied = set()
    for row in ledger:
        name = row["name"]
        if name in applied or name not in hashes or row["hash"] != hashes[name]:
            raise RuntimeError(f"Migration history mismatch for {name}; forward repair required")
        applied.add(name)
    ordered = list(sources)
    if [row["name"] for row in ledger] != ordered[: len(ledger)]:
        raise RuntimeError("Migration history is not an ordered prefix of the candidate directory")

    pending = [name for name in ordered if name not in applied]
    # Reconstruct only the applied schema on disposable local SQLite. A pending
    # migration may deliberately DROP/re-CREATE an old index, so its expected
    # production state is the applied definition, not blanket name absence.
    with sqlite3.connect(":memory:") as baseline:
        for name in ordered[: len(ledger)]:
            baseline.executescript(sources[name])
        expected_indexes = dict(baseline.execute("SELECT name, sql FROM sqlite_master WHERE type='index'"))
    actual_indexes = {r["name"]: r["sql"] for r in query(
        "SELECT name, sql FROM sqlite_master WHERE type='index'"
    )}
    for name in pending:
        sql = re.sub(r"--[^\n]*", "", sources[name])
        for index in re.findall(r"(?:CREATE\s+(?:UNIQUE\s+)?|DROP\s+)INDEX\s+[`\"]?(\w+)", sql, re.I):
            expected = expected_indexes.get(index)
            actual = actual_indexes.get(index)
            if expected != actual:
                raise RuntimeError(f"Partial or drifted index DDL before {name}: {index}")
        for table, column in re.findall(
            r"ALTER\s+TABLE\s+[`\"]?(\w+)[`\"]?\s+ADD\s+COLUMN\s+[`\"]?(\w+)", sql, re.I
        ):
            columns = query(f"SELECT name FROM pragma_table_info('{table}')")
            if any(row["name"] == column for row in columns):
                raise RuntimeError(f"Partial DDL before {name}: {table}.{column} already exists")
        for table in re.findall(r"CREATE\s+TABLE\s+[`\"]?(\w+)", sql, re.I):
            if table in tables:
                raise RuntimeError(f"Partial DDL before {name}: {table} already exists")

    summary = {"applied_migrations": len(applied), "pending_migrations": pending}
    if "0017_mcp_domain_revisions.sql" in pending:
        counts = query(
            "SELECT count(*) AS total, "
            "sum(CASE WHEN COALESCE((is_sent=1 AND status='sent') OR "
            "(is_sent=0 AND status IN ('pending','processing','failed')),0)=0 THEN 1 ELSE 0 END) "
            "AS invalid_reminders, "
            "sum(CASE WHEN is_sent=0 AND status IN ('pending','processing','failed') THEN 1 ELSE 0 END) "
            "AS historical_unsent_to_fence FROM music_reminder"
        )[0]
        summary.update({k: v or 0 for k, v in counts.items()})
        if summary["invalid_reminders"]:
            raise RuntimeError("Inconsistent historical reminders; no migration or silent repair allowed")
    if "0020_playlist_command_revisions.sql" in pending:
        invalid = query(
            "SELECT count(*) AS invalid_playlist_revisions FROM music_playlists "
            "WHERE typeof(revision)<>'integer' OR revision NOT BETWEEN 0 AND 9007199254740991"
        )[0]["invalid_playlist_revisions"]
        summary["invalid_playlist_revisions"] = invalid
        if invalid:
            raise RuntimeError("Invalid populated playlist revisions; no migration or coercion allowed")
    print(json.dumps(summary, indent=2))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write("## Read-only MCP migration preflight\n\n```json\n")
            output.write(json.dumps(summary, indent=2) + "\n```\n")


if __name__ == "__main__":
    main()
