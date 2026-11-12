---
id: deploy-stack-xerilium-com
title: Deploy Stack at stack.xerilium.com
author: flanakin
description: "Prep to host Stack on Azure SWA at stack.xerilium.com: Az PowerShell setup, custom domain, live data on stack/live, auth gaps closed, hybrid state design."
dependencies: [live-deploy, auth-security, iphone-access, deploy-docs]
---

<!-- markdownlint-disable single-title -->

# Feature: Deploy Stack at stack.xerilium.com

## Purpose

The owner opens `https://stack.xerilium.com` on Mac or phone and sees his live Stack. App writes never land on `main` of the task repo. Setup uses Az PowerShell only. Agents prep files; only the owner runs setup and touches Azure or DNS.

## Scope

- In: Az PowerShell setup script, custom domain in Bicep and the script, live branch default, security headers for a public domain, auth answer doc, hybrid state design (design only).
- Non-goals: creating any Azure resource, DNS changes, building the Mac snapshot push, host rate limits, passkeys, `stack/live` to `main` merge automation.

## Scenarios

### FR:setup: Az PowerShell setup

Owner needs one PowerShell script so that setup follows his Az PowerShell rule and never uses the wrong Azure context.

- **FR:setup.ps** (P1): `scripts/setup-azure.ps1` MUST do what the former `setup-azure.sh` did (FR:live-deploy/setup.*) with Az PowerShell cmdlets and `gh`, and MUST NOT call the `az` CLI
  - **FR:setup.ps.sh** (P1): `scripts/setup-azure.sh` MUST be removed, so only one setup path exists
- **FR:setup.sub** (P1): The script MUST take `-Subscription` (name or id) and select it with `Set-AzContext`. When it is empty, the script MUST list the signed-in subscriptions and prompt for one. It MUST NOT rely on the current default context
- **FR:setup.args** (P1): Every parameter MUST be validated at bind time, before any Azure or GitHub call
- **FR:setup.secrets** (P1): The repo token MUST come from a hidden prompt or `STACK_REPO_TOKEN`. Secrets MUST pass only in process memory or a child-process environment, never on a command line, in a file in a git work tree, or in output
- **FR:setup.merge** (P1): A re-run MUST merge only changed settings into the current app settings and keep all others (bot secrets, pepper, VAPID keys)

### FR:branch: Live data branch

Owner needs app writes off `main` so that Stack never commits to `main` of the task repo.

- **FR:branch.default** (P1): Setup MUST default `STACK_REPO_BRANCH` to `stack/live`, in the script and in `infra/main.bicep`
- **FR:branch.create** (P1): When the branch does not exist, setup MUST create it from the head of the repo's default branch with the repo token
- **FR:branch.rerun** (P1): A re-run MUST change `STACK_REPO_BRANCH` only when `-Branch` is given
- **FR:branch.doc** (P1): Docs MUST say live data is the `stack/live` branch

### FR:domain: Custom domain

Owner needs `stack.xerilium.com` with a free managed certificate so that he uses one stable URL.

- **FR:domain.bicep** (P1): `infra/main.bicep` MUST take `customDomain` (default empty) and add a `staticSites/customDomains` child with `cname-delegation` validation only when it is set
- **FR:domain.script** (P1): The script MUST take `-Domain` (default `stack.xerilium.com`; empty skips), print the exact CNAME record, and add the domain with `New-AzStaticWebAppCustomDomain` when it is not on the site yet. A failed add MUST tell the owner to add the CNAME and re-run, not stop the rest
- **FR:domain.doc** (P1): `docs/setup-live.md` MUST list the DNS step as a short human step with the exact record

### FR:auth: Auth for a public domain

Owner needs to know what protects the public URL so that he can trust it.

- **FR:auth.doc** (P1): `docs/deploy-auth.md` (30 lines at most) MUST list what exists, what is not covered, and the gaps for a public domain with their status
- **FR:auth.headers** (P1): `web/public/staticwebapp.config.json` MUST send `Strict-Transport-Security` (1 year at least), `Permissions-Policy` (camera, microphone, geolocation off), and `Cross-Origin-Opener-Policy: same-origin`, in addition to the current CSP and hardening headers
- **FR:auth.owner** (P1): The "Not on the allow-list" page MUST show `scripts/setup-azure.ps1 -Owner <id>`

### FR:hybrid: Mac state on the deployed app

Owner needs the phone to show the same Needs-you as the Mac so that the deployed app is not missing agent state.

- **FR:hybrid.design** (P2): `docs/hybrid-state.md` (25 lines at most) MUST state the design: the Mac host pushes a compact state snapshot to the deployed API with an owner-minted token (scope `state:write`), with no LLM call, and list the follow-up chunk with acceptance criteria. Build is out of scope

## Non-functional Requirements

- **NFR:cost** (P1): $0. SWA Free and its free managed certificate only
- **NFR:safety** (P1): Agents MUST NOT run the setup script or create Azure resources; the PR only preps files
