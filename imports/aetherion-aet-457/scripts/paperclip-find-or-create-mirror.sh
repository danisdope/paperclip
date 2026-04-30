#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  paperclip-find-or-create-mirror.sh <linear-id> <title> [options]

Options:
  --company-id <id>           Paperclip company id. Defaults to PAPERCLIP_COMPANY_ID.
  --project-id <id>           Project id to set on creation.
  --goal-id <id>              Goal id to set on creation.
  --assignee-agent-id <id>    Assignee agent id for newly created mirrors.
  --description <text>        Description for newly created mirrors.
  --description-file <path>   Read description body from file.
  --priority <value>          Priority for new issue. Default: high.
  --status <value>            Status for new issue. Default: todo.
  --execution-mode <mode>     executionWorkspaceSettings.mode for new issue.
  --help                      Show this help.

Environment:
  PAPERCLIP_API_URL           Defaults to http://127.0.0.1:3100/api when unset.
  PAPERCLIP_API_KEY           Optional bearer token for authenticated calls.
  PAPERCLIP_RUN_ID            Optional run id header for traceability.
EOF
}

fail() {
  echo "paperclip-find-or-create-mirror: $*" >&2
  exit 1
}

LINEAR_ID=""
SHORT_TITLE=""
API_URL="${PAPERCLIP_API_URL:-http://127.0.0.1:3100/api}"
# Normalize: ensure API_URL always ends with /api
API_URL="${API_URL%/}"
[[ "$API_URL" != */api ]] && API_URL="${API_URL}/api"
COMPANY_ID="${PAPERCLIP_COMPANY_ID:-}"
PROJECT_ID=""
GOAL_ID=""
ASSIGNEE_AGENT_ID=""
DESCRIPTION=""
DESCRIPTION_FILE=""
PRIORITY="high"
STATUS="todo"
EXECUTION_MODE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --company-id)
      COMPANY_ID="${2:-}"
      shift 2
      ;;
    --project-id)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    --goal-id)
      GOAL_ID="${2:-}"
      shift 2
      ;;
    --assignee-agent-id)
      ASSIGNEE_AGENT_ID="${2:-}"
      shift 2
      ;;
    --description)
      DESCRIPTION="${2:-}"
      shift 2
      ;;
    --description-file)
      DESCRIPTION_FILE="${2:-}"
      shift 2
      ;;
    --priority)
      PRIORITY="${2:-}"
      shift 2
      ;;
    --status)
      STATUS="${2:-}"
      shift 2
      ;;
    --execution-mode)
      EXECUTION_MODE="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      fail "unknown option: $1"
      ;;
    *)
      if [ -z "$LINEAR_ID" ]; then
        LINEAR_ID="$1"
      elif [ -z "$SHORT_TITLE" ]; then
        SHORT_TITLE="$1"
      else
        fail "unexpected positional argument: $1"
      fi
      shift
      ;;
  esac
done

[ -n "$LINEAR_ID" ] || fail "linear id is required"
[ -n "$SHORT_TITLE" ] || fail "title is required"
[ -n "$COMPANY_ID" ] || fail "company id is required (pass --company-id or set PAPERCLIP_COMPANY_ID)"

if [ -n "$DESCRIPTION" ] && [ -n "$DESCRIPTION_FILE" ]; then
  fail "use either --description or --description-file, not both"
fi

if [ -n "$DESCRIPTION_FILE" ]; then
  [ -f "$DESCRIPTION_FILE" ] || fail "description file not found: $DESCRIPTION_FILE"
  DESCRIPTION="$(cat "$DESCRIPTION_FILE")"
fi

if [ -z "$DESCRIPTION" ]; then
  DESCRIPTION="Mirrored execution record for Linear ${LINEAR_ID}."
fi

case "$SHORT_TITLE" in
  "${LINEAR_ID} | "*) FULL_TITLE="$SHORT_TITLE" ;;
  *) FULL_TITLE="${LINEAR_ID} | ${SHORT_TITLE}" ;;
esac

export API_URL COMPANY_ID LINEAR_ID FULL_TITLE PROJECT_ID GOAL_ID ASSIGNEE_AGENT_ID DESCRIPTION PRIORITY STATUS EXECUTION_MODE PAPERCLIP_API_KEY="${PAPERCLIP_API_KEY:-}" PAPERCLIP_RUN_ID="${PAPERCLIP_RUN_ID:-}"

python3 <<'PY'
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def make_headers(*, json_body=False, include_run=False):
    headers = {}
    api_key = os.environ.get("PAPERCLIP_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if json_body:
        headers["Content-Type"] = "application/json"
    if include_run and os.environ.get("PAPERCLIP_RUN_ID"):
        headers["X-Paperclip-Run-Id"] = os.environ["PAPERCLIP_RUN_ID"]
    return headers


def request_json(method, url, payload=None, include_run=False):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers=make_headers(json_body=payload is not None, include_run=include_run),
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise SystemExit(f"paperclip-find-or-create-mirror: HTTP {exc.code} for {url}\n{detail}") from exc


api_url = os.environ["API_URL"].rstrip("/")
company_id = os.environ["COMPANY_ID"]
linear_id = os.environ["LINEAR_ID"]
full_title = os.environ["FULL_TITLE"]

statuses = "backlog,todo,in_progress,in_review,done,blocked,cancelled"
list_url = (
    f"{api_url}/companies/{company_id}/issues"
    f"?status={urllib.parse.quote(statuses, safe=',')}&limit=500"
)
issues = request_json("GET", list_url)


def has_mirror_title(title):
    canonical_prefix = f"{linear_id} |"
    legacy_dash_prefixes = (
        f"{linear_id} -",
        f"{linear_id} –",
        f"{linear_id} —",
    )
    return title.startswith(canonical_prefix) or title.startswith(legacy_dash_prefixes)


live_matches = [
    issue
    for issue in issues
    if issue.get("parentId") is None
    and issue.get("hiddenAt") is None
    and has_mirror_title(issue.get("title", ""))
    and issue.get("status") != "cancelled"
]

if len(live_matches) > 1:
    summary = ", ".join(
        f"{issue.get('identifier', issue['id'])}:{issue.get('status')}" for issue in live_matches
    )
    raise SystemExit(
        "paperclip-find-or-create-mirror: refusing to create a second open parent; "
        f"multiple live mirrors already exist for {linear_id}: {summary}"
    )

if live_matches:
    issue = live_matches[0]
    print(
        json.dumps(
            {
                "created": False,
                "issueId": issue["id"],
                "identifier": issue.get("identifier"),
                "status": issue.get("status"),
                "title": issue.get("title"),
                "url": f"/AET/issues/{issue.get('identifier')}" if issue.get("identifier") else None,
            },
            indent=2,
        )
    )
    raise SystemExit(0)

payload = {
    "title": full_title,
    "description": os.environ["DESCRIPTION"],
    "priority": os.environ["PRIORITY"],
    "status": os.environ["STATUS"],
}

optional_fields = {
    "projectId": os.environ.get("PROJECT_ID"),
    "goalId": os.environ.get("GOAL_ID"),
    "assigneeAgentId": os.environ.get("ASSIGNEE_AGENT_ID"),
}
for key, value in optional_fields.items():
    if value:
        payload[key] = value

execution_mode = os.environ.get("EXECUTION_MODE")
if execution_mode:
    payload["executionWorkspaceSettings"] = {"mode": execution_mode}

create_url = f"{api_url}/companies/{company_id}/issues"
created = request_json("POST", create_url, payload=payload, include_run=True)
print(
    json.dumps(
        {
            "created": True,
            "issueId": created["id"],
            "identifier": created.get("identifier"),
            "status": created.get("status"),
            "title": created.get("title"),
            "url": f"/AET/issues/{created.get('identifier')}" if created.get("identifier") else None,
        },
        indent=2,
    )
)
PY
