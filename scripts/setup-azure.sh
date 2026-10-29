#!/usr/bin/env bash
# @req FR:live-deploy/setup.script @req FR:live-deploy/setup.secrets @req FR:live-deploy/setup.owner
# Hosting setup for Stack on Azure Static Web Apps (Free). Run it yourself; agents never do. Safe to re-run.
# Needs: az (signed in: `az login`), gh (signed in: `gh auth login`), node, and a fine-grained GitHub token for the task repo
# (Contents: read and write, on that one repo). See docs/setup-live.md.
#
# Usage: scripts/setup-azure.sh [--repo flanakin/todo] [--group stack-rg] [--name stack-app] [--location westus2] [--app Xerilium/stack]
#        scripts/setup-azure.sh --owner github:<id shown on the "Not on the allow-list" page>
# The task repo token is read from a hidden prompt, or from STACK_REPO_TOKEN in the environment. On a re-run, Enter keeps the current one.
set -euo pipefail

REPO=flanakin/todo GROUP=stack-rg NAME=stack-app LOCATION=westus2 APP=Xerilium/stack OWNER="" REPO_SET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO=$2; REPO_SET=1; shift 2 ;;
    --group) GROUP=$2; shift 2 ;;
    --name) NAME=$2; shift 2 ;;
    --location) LOCATION=$2; shift 2 ;;
    --app) APP=$2; shift 2 ;;
    --owner) OWNER=$2; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
bad() { echo "Invalid $1: $2" >&2; exit 2; }
[[ "$REPO" =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$ ]] || bad --repo "$REPO (want owner/name)"
[[ "$APP" =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$ ]] || bad --app "$APP (want owner/name)"
[[ "$GROUP" =~ ^[A-Za-z0-9._()-]{1,90}$ ]] || bad --group "$GROUP"
[[ "$NAME" =~ ^[A-Za-z0-9-]{1,40}$ ]] || bad --name "$NAME"
[[ "$LOCATION" =~ ^[a-z0-9]+$ ]] || bad --location "$LOCATION"
[ -z "$OWNER" ] || [[ "$OWNER" =~ ^github:[A-Za-z0-9-]{1,128}$ ]] || bad --owner "$OWNER (copy it from the sign-in page)"
cd "$(dirname "$0")/.."

say() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "Missing $1. Install it, sign in, and re-run." >&2; exit 1; }; }
need az; need gh; need node; need openssl
az account show >/dev/null 2>&1 || { echo "Run 'az login' first." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

# Secrets live only in this mode-600 temp folder (outside any git work tree) and are deleted on exit.
umask 077
TMP=$(mktemp -d "${TMPDIR:-/tmp}/stack-setup.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

say "Subscription: $(az account show --query name -o tsv)"
# Only "not there" means a new site. Any other failure stops the script (set -e) instead of creating a second site or re-applying the template.
# Plain assignments, not `if` conditions: set -e is off inside a condition.
EXISTS=0
GROUP_EXISTS=$(az group exists -n "$GROUP")
FOUND=""
if [ "$GROUP_EXISTS" = true ]; then FOUND=$(az staticwebapp list -g "$GROUP" --query "[?name=='$NAME'].name" -o tsv); fi
[ -n "$FOUND" ] && EXISTS=1

# --owner on an existing site: only update the allow-list (takes effect at once, no redeploy).
if [ -n "$OWNER" ] && [ "$EXISTS" = 1 ]; then
  ONLY_OWNER=1
else
  ONLY_OWNER=0
fi

TOKEN=""
if [ "$ONLY_OWNER" = 0 ]; then
  TOKEN=${STACK_REPO_TOKEN:-}
  if [ -z "$TOKEN" ]; then
    if [ "$EXISTS" = 1 ]; then prompt="Task repo token for $REPO (Enter keeps the current one): "; else prompt="Task repo token for $REPO (fine-grained, Contents read and write): "; fi
    read -r -s -p "$prompt" TOKEN; echo
  fi
  if [ -n "$TOKEN" ]; then
    [[ "$TOKEN" =~ ^[A-Za-z0-9_]+$ ]] || { echo "That does not look like a GitHub token (letters, digits, _)." >&2; exit 1; }
    say "Checking the token can read $REPO contents"
    # Passed to these gh calls through their environment; never printed or saved.
    # The host reads STACK_REPO_BRANCH, which defaults to main and is not set here.
    BRANCH=main
    GH_TOKEN="$TOKEN" gh api "repos/$REPO" -q .full_name >/dev/null 2>&1 || { echo "That token cannot see $REPO. Check its repository access." >&2; exit 1; }
    GH_TOKEN="$TOKEN" gh api "repos/$REPO/git/ref/heads/$BRANCH" -q .object.sha >/dev/null 2>&1 || { echo "That token cannot read $REPO contents on $BRANCH. Give it Contents: Read and write (and check the branch exists)." >&2; exit 1; }
  elif [ "$EXISTS" = 0 ]; then
    echo "No token given. See docs/setup-live.md step 1." >&2; exit 1
  fi
fi

if [ "$EXISTS" = 0 ]; then
  say "Resource group $GROUP ($LOCATION)"
  az group create -n "$GROUP" -l "$LOCATION" -o none
  # First run only: the template writes the whole settings list, so it never runs against a live site.
  # Values are JSON-encoded by node (env in, file out), never interpolated by the shell.
  # shellcheck disable=SC2016 # $schema is a JSON key for node, not a shell variable
  STACK_P_NAME=$NAME STACK_P_LOCATION=$LOCATION STACK_P_OWNERS=$OWNER STACK_P_PEPPER=$(openssl rand -hex 32) STACK_P_URL="https://github.com/$REPO" STACK_P_TOKEN=$TOKEN \
    node -e 'const e = process.env, v = (x) => ({ value: x }); require("fs").writeFileSync(process.argv[1], JSON.stringify({ $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#", contentVersion: "1.0.0.0", parameters: { name: v(e.STACK_P_NAME), location: v(e.STACK_P_LOCATION), owners: v(e.STACK_P_OWNERS), tokenPepper: v(e.STACK_P_PEPPER), repoUrl: v(e.STACK_P_URL), repoToken: v(e.STACK_P_TOKEN) } }));' "$TMP/params.json"
  say "Static Web App $NAME (Free)"
  az deployment group create -g "$GROUP" -n stack-setup -f infra/main.bicep -p "@$TMP/params.json" -o none
else
  say "Updating settings on $NAME (other settings are kept)"
  az staticwebapp appsettings list -n "$NAME" -g "$GROUP" --query properties -o json > "$TMP/current.json"
  # Merge only what changed into the current list, then write it back whole (az rest reads the body from the file).
  # The repo URL changes only when --repo is given, so a re-run never silently repoints a site.
  STACK_P_OWNERS=$OWNER STACK_P_URL=$([ "$REPO_SET" = 1 ] && echo "https://github.com/$REPO" || echo "") STACK_P_TOKEN=$TOKEN \
    node -e 'const fs = require("fs"), e = process.env; const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8") || "{}") || {}; if (e.STACK_P_OWNERS) p.STACK_OWNERS = e.STACK_P_OWNERS; if (e.STACK_P_URL) p.STACK_REPO_URL = e.STACK_P_URL; if (e.STACK_P_TOKEN) p.STACK_REPO_TOKEN = e.STACK_P_TOKEN; fs.writeFileSync(process.argv[2], JSON.stringify({ properties: p }));' "$TMP/current.json" "$TMP/body.json"
  ID=$(az staticwebapp show -n "$NAME" -g "$GROUP" --query id -o tsv)
  az rest --method put --url "https://management.azure.com${ID}/config/appsettings?api-version=2023-12-01" --body "@$TMP/body.json" -o none
fi

HOST=$(az staticwebapp show -n "$NAME" -g "$GROUP" --query defaultHostname -o tsv)
if [ "$ONLY_OWNER" = 1 ]; then
  say "Done"
  echo "Owner set. Reload https://$HOST"
  exit 0
fi

say "Deploy secret on $APP"
az staticwebapp secrets list -n "$NAME" -g "$GROUP" --query properties.apiKey -o tsv | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN -R "$APP"

say "Deploying (GitHub Actions: Deploy)"
gh workflow run deploy.yml -R "$APP" --ref main
echo "Watch it: gh run watch -R $APP \$(gh run list -R $APP -w Deploy -L 1 --json databaseId -q '.[0].databaseId')"

say "Done"
echo "When the run is green, open https://$HOST in Edge and sign in with GitHub."
if [ -z "$OWNER" ]; then
  echo "First sign-in shows 'Not on the allow-list' with a command to copy. Run it once; that makes you the owner."
fi
