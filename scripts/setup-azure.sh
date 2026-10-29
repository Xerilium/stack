#!/usr/bin/env bash
# @req FR:live-deploy/setup.script @req FR:live-deploy/setup.secrets
# One-time (re-runnable) hosting setup for Stack on Azure Static Web Apps (Free). Run it yourself; agents never do.
# Needs: az (signed in: `az login`), gh (signed in: `gh auth login`), and a fine-grained GitHub token for the task repo
# (Contents: read and write, on that one repo). See docs/setup-live.md.
#
# Usage: scripts/setup-azure.sh [--repo flanakin/todo] [--group stack-rg] [--name stack-app] [--location westus2] [--app Xerilium/stack]
# The task repo token is read from a hidden prompt, or from STACK_REPO_TOKEN in the environment. Leave the prompt empty on a re-run to keep the current one.
set -euo pipefail

REPO=flanakin/todo GROUP=stack-rg NAME=stack-app LOCATION=westus2 APP=Xerilium/stack
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO=$2; shift 2 ;;
    --group) GROUP=$2; shift 2 ;;
    --name) NAME=$2; shift 2 ;;
    --location) LOCATION=$2; shift 2 ;;
    --app) APP=$2; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
cd "$(dirname "$0")/.."

say() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "Missing $1. Install it, sign in, and re-run." >&2; exit 1; }; }
need az; need gh
az account show >/dev/null 2>&1 || { echo "Run 'az login' first." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

# Secrets live only in this mode-600 temp folder (outside any git work tree) and are deleted on exit.
umask 077
TMP=$(mktemp -d "${TMPDIR:-/tmp}/stack-setup.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

say "Owner: your GitHub account"
OWNER_ID=$(gh api user -q .id)
OWNER_LOGIN=$(gh api user -q .login)
echo "Signed in to GitHub as $OWNER_LOGIN (id $OWNER_ID). Only this account can open Stack."

say "Resource group $GROUP ($LOCATION)"
az group create -n "$GROUP" -l "$LOCATION" -o none

EXISTING_TOKEN="" EXISTING_PEPPER=""
if az staticwebapp show -n "$NAME" -g "$GROUP" -o none 2>/dev/null; then
  EXISTING_TOKEN=$(az staticwebapp appsettings list -n "$NAME" -g "$GROUP" --query properties.STACK_REPO_TOKEN -o tsv 2>/dev/null || true)
  EXISTING_PEPPER=$(az staticwebapp appsettings list -n "$NAME" -g "$GROUP" --query properties.STACK_TOKEN_PEPPER -o tsv 2>/dev/null || true)
fi

TOKEN=${STACK_REPO_TOKEN:-}
if [ -z "$TOKEN" ]; then
  if [ -n "$EXISTING_TOKEN" ]; then prompt="Task repo token for $REPO (Enter keeps the current one): "; else prompt="Task repo token for $REPO (fine-grained, Contents read and write): "; fi
  read -r -s -p "$prompt" TOKEN; echo
  [ -z "$TOKEN" ] && TOKEN=$EXISTING_TOKEN
fi
[ -n "$TOKEN" ] || { echo "No token given. See docs/setup-live.md step 1." >&2; exit 1; }
[[ "$TOKEN" =~ ^[A-Za-z0-9_]+$ ]] || { echo "That does not look like a GitHub token (letters, digits, _)." >&2; exit 1; }

say "Checking the token can read $REPO"
# Passed to this one gh call through its environment; never printed or saved.
GH_TOKEN="$TOKEN" gh api "repos/$REPO" -q .full_name >/dev/null || { echo "That token cannot read $REPO. Check its repository access and Contents permission." >&2; exit 1; }

# Keep the pepper across re-runs: a new one would invalidate every API token.
PEPPER=${EXISTING_PEPPER:-$(openssl rand -hex 32)}

cat > "$TMP/params.json" <<EOF
{
  "\$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "name": { "value": "$NAME" },
    "location": { "value": "$LOCATION" },
    "owners": { "value": "github:$OWNER_ID" },
    "tokenPepper": { "value": "$PEPPER" },
    "repoUrl": { "value": "https://github.com/$REPO" },
    "repoToken": { "value": "$TOKEN" }
  }
}
EOF

say "Static Web App $NAME (Free)"
HOST=$(az deployment group create -g "$GROUP" -n stack-setup -f infra/main.bicep -p "@$TMP/params.json" --query properties.outputs.hostname.value -o tsv)

say "Deploy secret on $APP"
az staticwebapp secrets list -n "$NAME" -g "$GROUP" --query properties.apiKey -o tsv | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN -R "$APP"

say "Deploying (GitHub Actions: Deploy)"
gh workflow run deploy.yml -R "$APP" --ref main
echo "Watch it: gh run watch -R $APP \$(gh run list -R $APP -w Deploy -L 1 --json databaseId -q '.[0].databaseId')"

say "Done"
echo "Open https://$HOST in Edge, sign in with GitHub, then: ... menu > Apps > Install Stack."
