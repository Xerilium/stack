---
id: tailnet-access
title: Tailnet access
author: flanakin
description: "The owner's iPhone reaches the Stack host on his Mac over his Tailscale tailnet, at once and in private, with a paired device token on every remote request."
dependencies: [cli, auth-security, iphone-access, pwa]
---

<!-- markdownlint-disable single-title -->

# Feature: Tailnet access

## Purpose

Owner opens Stack on his iPhone and sees the live Mac host at once, with no timer and no public endpoint. The phone reaches the Mac over his Tailscale tailnet only. Every request that does not come from the Mac itself carries a token for a paired device. Human steps: [docs/phone-access.md](../../../docs/phone-access.md).

## Scope

- In: a `bind` option for `stack web`, Tailscale address detection, a gate for remote requests, trust of `tailscale serve` proxy headers from loopback only, device pairing (CLI, page, cookie), the phone setup doc and threat notes.
- Non-goals: Tailscale Funnel or any public endpoint, passkey login (iphone-access `FR:passkey`), push sending from the Mac host, the desktop app host (random port), identity from `Tailscale-User-*` headers, calls to the Tailscale API or CLI.

## Scenarios

### FR:bind: Bind to the tailnet

Owner needs the Mac host to listen on his tailnet so that his phone reaches it, and nowhere else.

- **FR:bind.@cli** (P1): Interface: `stack web --bind loopback|tailnet`, and user config `bind` in `~/.config/stack/config.json`. The flag wins over the config. Default `loopback`. Any other value is a usage error (exit 2)
- **FR:bind.loopback** (P1): With `loopback`, the server MUST listen on `127.0.0.1` only (`FR:cli/web.serve`), as before
- **FR:bind.tailnet** (P1): With `tailnet`, the server MUST listen on `127.0.0.1` and on each Tailscale address of the machine, all on one port. It MUST NOT listen on `0.0.0.0`, `::` or any other address
- **FR:bind.detect** (P1): A Tailscale address is a non-internal interface address in `100.64.0.0/10` (IPv4) or `fd7a:115c:a1e0::/48` (IPv6), read from the OS interface list. Detection MUST NOT call the network, the Tailscale API or the `tailscale` CLI. The interface list is injected in tests
- **FR:bind.refuse** (P1): With `tailnet` and no Tailscale address, the server MUST refuse to start before it listens, with `No Tailscale address found. Start Tailscale and sign in, then retry.`
- **FR:bind.startup** (P2): The startup output MUST list the loopback URL and one URL per Tailscale address

### FR:gate: Remote request gate

Owner needs each remote request checked so that only his paired phone gets data.

- **FR:gate.classify** (P1): A request is local when its socket peer is a loopback address and it carries none of `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `Forwarded`, `Tailscale-User-Login`. Every other request is remote
- **FR:gate.local** (P1): Local requests MUST behave as before: the local owner stub, the loopback Host rule and the same-origin write rule (`FR:cli/web.serve.local`, `FR:cli/web.serve.loopback`)
- **FR:gate.loopback** (P1): With `bind: loopback`, the server MUST refuse every remote request with `403`
- **FR:gate.host** (P1): A remote request MUST name a Tailscale host: a bound Tailscale address (IPv6 in brackets, port optional) or a `*.ts.net` name. Any other Host is `403` (DNS rebinding guard). The Host comes from `FR:proxy.host`
- **FR:gate.token** (P1): A remote request MUST carry a device token, from the `stack_device` cookie or from `Authorization: Bearer` / `X-Stack-Token`, that verifies (`FR:auth-security/token.verify`) and is bound to an active device (`FR:iphone-access/device.login`)
  - **FR:gate.token.deny** (P1): No token or a bad, expired or revoked token is `401`. A valid token that is not bound to an active device is `403`
  - **FR:gate.token.page** (P1): A remote `GET` for a page (not `/api/*`, `/events`, `/sessions/*` or `/.auth/*`) without a valid token MUST redirect (`302`) to `/pair`
- **FR:gate.public** (P1): Only `GET /pair`, `GET /pair.js` and `POST /.auth/pair` MUST be served to a remote caller without a token. They hold no task data
- **FR:gate.scope** (P1): A paired device is the owner's phone, so a remote `/api` request MUST run as the owner, with the caller's own principal, token and cookie headers dropped. It MUST NOT reach the token or device admin endpoints (`403`): a phone never mints or revokes tokens or devices. Device self endpoints (`FR:iphone-access/sub.@http`) run as its device token through the `auth-security` authorize hook
- **FR:gate.csrf** (P1): A remote write MUST be refused (`403`) when its `Origin` names a host other than the request host, or its `Sec-Fetch-Site` is not `same-origin` or `none`

### FR:proxy: Tailscale Serve

Owner needs HTTPS on his tailnet name so that the installed app is a secure context (Web Push needs it).

- **FR:proxy.trust** (P1): The host MUST read `X-Forwarded-Host` and `X-Forwarded-Proto` only from a loopback peer (`tailscale serve` runs on the Mac). From any other peer it MUST ignore them
- **FR:proxy.host** (P1): The request host is the first `X-Forwarded-Host` value when trusted and present, else `Host`
- **FR:proxy.secure** (P1): The device cookie MUST carry `Secure` when the trusted `X-Forwarded-Proto` is `https`

### FR:pair: Pair a device

Owner needs to pair his phone once so that it signs in with no typing after that.

- **FR:pair.@cli** (P1): Interface: `stack devices add <name>`, `stack devices list`, `stack devices revoke <id>`. Stores: `<STACK_HOME>/tokens.json` and `<STACK_HOME>/devices.json` (default `~/.stack`), owner-only file mode (`FR:auth-security/token.file`). `stack web` reads the same stores
  - **FR:pair.@cli.add** (P1): `add` creates a device (`FR:iphone-access/device.create`) and prints its pairing code (the device token) once, with the page path `/pair#<code>`
  - **FR:pair.@cli.list** (P1): `list` prints `id`, `name`, `status`, `createdAt`; never a token
  - **FR:pair.@cli.revoke** (P1): `revoke` revokes the device and its token (`FR:iphone-access/device.revoke`). The next remote request with that token is `401`
- **FR:pair.page** (P1): `GET /pair` serves a page with no inline script or style (CSP stays `default-src 'self'`). Its script `/pair.js` takes the code from the URL fragment or a paste field, saves it in browser storage as `stack.device` (the install screen, `FR:iphone-access/install.pair`), posts it to `/.auth/pair` and on success opens `/#/install`
- **FR:pair.cookie** (P1): `POST /.auth/pair` with JSON `{ token }` (strict fields, at most 4 KiB) and a valid active device token MUST answer `204` with `Set-Cookie: stack_device=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000`, plus `Secure` per `FR:proxy.secure`. `Lax`, not `Strict`, so a link opened from another app still signs in; `FR:gate.csrf` guards writes. Any other token is `401` with no cookie. The `FR:gate.csrf` rule applies
- **FR:pair.me** (P1): A remote `/.auth/me` with a valid token answers the local stub shape with `userDetails` `device:<name>`
- **FR:pair.logout** (P2): A remote `/.auth/logout` MUST clear the cookie (`Max-Age=0`) and redirect to `/pair`

### FR:docs: Phone setup and threat notes

- **FR:docs.phone** (P1): `docs/phone-access.md` MUST give the human steps as one short numbered list: install Tailscale on the Mac and the iPhone, sign in, turn on MagicDNS and HTTPS, run `tailscale serve`, open the URL, pair the device, Add to Home Screen
- **FR:docs.threat** (P1): The doc MUST hold threat notes of 10 lines or fewer, and `docs/security/threat-model.md` MUST list the tailnet boundary

### Non-functional Requirements

- **NFR:security** (P1): No new runtime dependency. No listener on an unspecified address. Tokens, cookies and pairing codes MUST NOT appear in logs or errors
- **NFR:test** (P1): Tests MUST NOT call the network or Tailscale. The interface list, the Tailscale address list and the socket peer are injected

## Architecture Constraints

- Code in `src/cli/tailnet.ts` (detection, classification, host rule, cookie, pair page) and `src/cli/devices.ts` (CLI and file stores); `src/cli/web.ts` wires them.
- Remote owner requests reuse the local api. Device self endpoints use `createAuth({ owners: [], tokens, devices }).wrap(createApiHandler({ authorize }))` over the same storage. Owners stay empty, so no session ever matches there.

## External Dependencies

Tailscale (MagicDNS, HTTPS certificates, `tailscale serve`) on the Mac and the iPhone. Human steps: [docs/phone-access.md](../../../docs/phone-access.md).
