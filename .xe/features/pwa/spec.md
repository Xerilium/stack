---
id: pwa
title: Mobile PWA and notifications
author: flanakin
description: "Installable Stack on phone and desktop, a day plan you can read offline, and opt-in notifications for asks."
dependencies: [web-app, ask-queue]
---

<!-- markdownlint-disable single-title -->

# Feature: Mobile PWA and notifications

## Purpose

Stack lives on the home screen like an app, opens instantly, still shows today's plan and asks with no signal, and taps you only when an agent needs you.

## Scope

- In: web app manifest, icons, service worker (app shell + read-only data cache), offline banner, notification opt-in, local notifications for new asks, the delivery design for background push.
- Non-goals: offline writes or a sync queue, native apps, paid push providers, background push sending in this release (spec only, `FR:push.*` is P3).

## Scenarios

### FR:install: Installable app

- **FR:install.manifest** (P1): `web/public/manifest.webmanifest` ships in `dist` with `name` "Stack", `short_name` "Stack", `start_url` `/` (the home view), `scope` `/`, `display` `standalone`, `background_color` and `theme_color` matching the light theme, and icons: one SVG (`any`), PNG 192 and 512 (`any`), and PNG 512 `maskable`
- **FR:install.head** (P1): `index.html` links the manifest, an `apple-touch-icon` (PNG 180), a favicon (the SVG icon), `theme-color` for light and dark, and `apple-mobile-web-app-capable` / `apple-mobile-web-app-status-bar-style` so iOS opens it full screen. No inline script or style, so the CSP stays `default-src 'self'`
- **FR:install.standalone** (P1): In standalone display the layout respects safe areas (`env(safe-area-inset-*)`) on all four sides, the bottom tab bar sits above the home indicator, and nothing scrolls sideways at 320 px or wider

### FR:offline: Offline reading

- **FR:offline.sw** (P1): `web/public/sw.js` (plain script, same origin, scope `/`) is registered by the page only in a secure context (https, or localhost). It caches the app shell (navigation and `/assets/*`, `/manifest.webmanifest`, icons) stale-while-revalidate, and read-only api responses (`GET` `/api/next`, `/api/tasks`, `/api/projects`, `/api/asks`, `/api/inbox`, `/api/agents`, `/.auth/me`) network-first with the cached copy as fallback. It never caches non-`GET` requests, `/events`, error responses (status other than 200), or any other path
- **FR:offline.banner** (P1): When the browser is offline or a read came from the cache, the page shows a one-line banner `Offline · showing <time> copy` and disables every write control (actions, capture, replies, answers) with a tooltip `Offline`. Going back online removes the banner and refreshes once
- **FR:offline.private** (P1): Cached data is the signed-in user's own data on their own device. Sign out deletes every Stack cache before leaving for `/.auth/logout`. A new service worker version deletes caches from older versions on activate
- **FR:offline.update** (P2): A new version activates on the next launch (no forced reload mid-task); the page never prompts about updates

### FR:notify: Notifications for asks

- **FR:notify.optin** (P1): Notifications are off until the user turns them on with `Notify me` (in the Asks view header and the command palette), which asks the browser for permission from that click. When permission is denied the control says `Blocked in browser settings`. The choice is kept in browser storage under `stack.notify` (`on` or absent); this and `stack.available` are the only keys the app stores
- **FR:notify.new** (P1): While opted in and permission is granted, asks that newly appear (the same set that fades in on the list, never the user's own changes) raise a notification only when the page is hidden: one ask shows its text as the title and `<project> · <deadline>` as the body; several show `<n> new asks` with the top one as the body. Each uses `tag` `stack-asks` so a newer one replaces the older one, and the icon is the app icon
- **FR:notify.click** (P1): Clicking a notification focuses an open Stack window (or opens one) at `/#/asks` and closes the notification
- **FR:notify.quiet** (P2): No notification between 21:00 and 07:59 local time, except for an ask with priority `crit` or a deadline within 2 hours
- **FR:notify.none** (P1): Browsers without the Notifications API or service workers show no control and raise nothing

### FR:push: Background push (design, P3)

- **FR:push.design** (P3): Background delivery (app closed, phone locked) uses standard Web Push with VAPID: the browser's own push service (Apple, Google, Mozilla) carries the message, so there is no paid service. The host that sees new asks (the Azure host on ask create; `stack web` only while it runs) signs a payload with its VAPID private key (host secret, never in the repo) and posts it to each saved subscription. Subscriptions are per device, stored by the host outside the task repo, and removed on a `404`/`410` from the push service. Payloads carry only the ask key and title, never task text beyond the one-line ask. Cost: Azure Functions consumption free grant covers expected volume (well under 1M executions a month); push services are free. Until built, `FR:notify.*` covers notifications while the app or a tab is open
