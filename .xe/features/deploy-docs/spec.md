---
id: deploy-docs
title: Deploy and Docs
author: flanakin
description: "Build-only Azure Static Web Apps infrastructure (Bicep), deploy and e2e workflows, and the docs that explain how to run, call, and contribute to Stack."
dependencies: [api, mcp-server, auth-security, chat-bots, cli]
---

<!-- markdownlint-disable single-title -->

# Feature: Deploy and Docs

## Purpose

Make Stack deployable by its owner and understandable by everyone else. Agents only build the files; they never deploy and never call Azure.

## Scope

- In: Bicep for Static Web Apps (Free) with managed Functions; parameter files; deploy workflow (push to main); e2e workflow; README, runbook, CLI/API/MCP/bots docs, CONTRIBUTING.
- Out: running a deployment, creating Azure resources or secrets, the Functions host entry, Key Vault.

## Scenarios

### FR:infra: Infrastructure

- **FR:infra.swa** (P1): `infra/main.bicep` declares one `Microsoft.Web/staticSites` resource on the `Free` SKU and no other billable resource; no Key Vault
- **FR:infra.settings** (P1): Secrets (`STACK_OWNERS`, `STACK_TOKEN_PEPPER`, repo token) are `@secure()` parameters written to app settings only; parameter files hold no secret values
- **FR:infra.params** (P2): `infra/main.bicepparam`-equivalent JSON parameter files parse and name only declared parameters
- **FR:infra.lint** (P2): When `bicep` is installed, `bicep build` succeeds offline; otherwise the check is skipped

### FR:ci: Workflows

- **FR:ci.deploy** (P1): `.github/workflows/deploy.yml` runs on push to `main`, builds, and deploys with `Azure/static-web-apps-deploy` using the repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`; it does nothing when the secret is absent
- **FR:ci.e2e** (P1): `.github/workflows/e2e.yml` runs the web Playwright suite on pull requests and passes cleanly while `web/` is absent
- **FR:ci.valid** (P1): Workflow files are valid YAML with `name`, `on`, and `jobs`

### FR:docs: Documentation

- **FR:docs.links** (P1): Every relative link in README, CONTRIBUTING, and `docs/**/*.md` resolves to a file
- **FR:docs.cli** (P1): Every CLI command is documented in `docs/cli.md`
- **FR:docs.mcp** (P1): Every MCP tool and its scope is documented in `docs/mcp.md`
- **FR:docs.api** (P1): Every OpenAPI path is listed in `docs/api/README.md`, which links `openapi.yaml`
- **FR:docs.env** (P2): Every `STACK_*` environment variable read by the code is documented in the runbook
- **FR:docs.runbook** (P1): `docs/runbook.md` covers deploy, token setup, owner allow-list, token rotation, backup and restore from git, and cost
- **FR:docs.process** (P3): CONTRIBUTING points to the Catalyst process; README links bots docs
