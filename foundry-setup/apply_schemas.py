#!/usr/bin/env python3
"""
Apply typed Foundry schemas to the four uploaded CSV datasets via the
v1 schema API (PUT /api/v1/datasets/{rid}/schema?preview=true).

Reads the token from ~/.foundry-token and dataset RIDs from ./rids/*.rid.
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

# Point at your own stack, e.g.
#   export FOUNDRY_HOST=https://<your-subdomain>.<region>.palantirfoundry.com
HOST = os.environ.get("FOUNDRY_HOST", "").rstrip("/")
if not HOST:
    sys.exit("Set FOUNDRY_HOST, e.g. export FOUNDRY_HOST=https://acme.usw-1.palantirfoundry.com")

TOKEN_FILE = Path(os.environ.get("FOUNDRY_TOKEN_FILE", "~/.foundry-token")).expanduser()
if not TOKEN_FILE.exists():
    sys.exit(f"No token at {TOKEN_FILE}. Create one in Foundry (Settings > Tokens) and save it there (chmod 600).")
TOKEN = TOKEN_FILE.read_text().strip()

RID_DIR = Path(__file__).parent / "rids"

SCHEMAS = {
    "incidents": [
        ("incident_id", "STRING"), ("reported_at", "TIMESTAMP"), ("source", "STRING"),
        ("description", "STRING"), ("incident_type", "STRING"), ("severity", "STRING"),
        ("status", "STRING"), ("latitude", "DOUBLE"), ("longitude", "DOUBLE"),
        ("address", "STRING"), ("borough", "STRING"), ("required_capability", "STRING"),
        ("estimated_duration_minutes", "INTEGER"), ("road_obstruction", "BOOLEAN"),
        ("safety_risk", "BOOLEAN"), ("priority_score", "INTEGER"),
        ("duplicate_of", "STRING"), ("assigned_crew_id", "STRING"),
        ("resolved_at", "TIMESTAMP"),
    ],
    "crews": [
        ("crew_id", "STRING"), ("crew_name", "STRING"), ("capability", "STRING"),
        ("latitude", "DOUBLE"), ("longitude", "DOUBLE"), ("borough", "STRING"),
        ("status", "STRING"), ("current_workload", "INTEGER"),
        ("max_workload", "INTEGER"), ("shift_start", "STRING"),
        ("shift_end", "STRING"), ("vehicle", "STRING"),
    ],
    "assignments": [
        ("assignment_id", "STRING"), ("incident_id", "STRING"), ("crew_id", "STRING"),
        ("assigned_at", "TIMESTAMP"), ("estimated_arrival", "TIMESTAMP"),
        ("status", "STRING"), ("completed_at", "TIMESTAMP"),
    ],
    "capabilities": [
        ("capability_id", "STRING"), ("name", "STRING"), ("description", "STRING"),
        ("typical_crew_size", "INTEGER"),
    ],
}


ISO_OFFSET = "yyyy-MM-dd'T'HH:mm:ssXXX"  # e.g. 2026-08-20T14:41:00-04:00


def schema_payload(fields):
    date_formats = {n: ISO_OFFSET for n, t in fields if t == "TIMESTAMP"}
    return {
        "fieldSchemaList": [
            {"type": t, "name": n, "nullable": True} for n, t in fields
        ],
        "dataFrameReaderClass": "com.palantir.foundry.spark.input.TextDataFrameReader",
        "customMetadata": {
            "textParserParams": {
                "parser": "CSV_PARSER",
                "charsetName": "UTF-8",
                "fieldDelimiter": ",",
                "recordDelimiter": "\n",
                "quoteCharacter": "\"",
                "dateFormat": date_formats,
                "skipLines": 1,
                "jaggedRowBehavior": "THROW_EXCEPTION",
                "parseErrorBehavior": "THROW_EXCEPTION",
                "addFilePath": False,
                "addImportedAt": False,
            }
        },
    }


def put_schema(name, rid):
    url = f"{HOST}/api/v1/datasets/{rid}/schema?preview=true"
    body = json.dumps(schema_payload(SCHEMAS[name])).encode()
    req = urllib.request.Request(
        url, data=body, method="PUT",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"{name}: HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        print(f"{name}: HTTP {e.code} — {e.read().decode()[:300]}")


if __name__ == "__main__":
    for name in SCHEMAS:
        rid = (RID_DIR / f"{name}.rid").read_text().strip()
        put_schema(name, rid)
