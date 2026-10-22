---
id: deploy-docs
title: Deploy and Docs Plan
---

# Plan: Deploy and Docs

## Approach

Files only. Bicep in `infra/`, two new workflows (separate files so they do not collide with `ci.yml`), docs under `docs/`. Tests in `tests/deploy/` read the files and cross-check them against code (CLI table, `TOOLS`, `openapi.yaml`, `STACK_*` env names).

## Decisions

- Free SWA plus managed Functions; secrets are app settings; no Key Vault
- Workflow guards on the deploy secret so merging never fails before the owner sets it up
- e2e job guards on `web/package.json` so it is green until web-app lands
- Functions host entry (wiring storage, tokens, handlers) is not part of this feature; the runbook lists it as an owner prerequisite
- Tests: Jest, `yaml` parser, optional `bicep build`
