# Research: iPhone access to a desktop-hosted Stack

Question: how does the owner use Stack from an iPhone (iPhone only), signed in, when the host is a Mac app?
Date: 2026-11-05. Context: [stack-app research](https://github.com/Xerilium/stack/pull/90) (`research-architecture.md`), `pwa`, `auth-security`, `azure-host`, `live-deploy`.
"Verified" = read in the cited source this session. "Est." = not verified; test on the device before relying. Search snippets only; no page was read in full, so treat "Verified" as "stated by the source".

## TL;DR

- Use the installed PWA on the always-on Azure host (exists). Add device login (per-device revocable token) and Web Push (VAPID) on top. Cost: $0.
- Live view of the Mac host: Tailscale Serve (tailnet only). Not required for the first slice.
- Offline answers: queue on the phone, replay through the API, land as git commits. Spec only.
- Native SwiftUI: not now. Revisit only if PWA push proves unreliable on the device or widgets are wanted.

## 1. Installed PWA on iOS

| Topic | Finding | Status | Src |
| --- | --- | --- | --- |
| Web Push | Supported for Home Screen web apps from iOS/iPadOS 16.4. Not in a Safari tab | Verified | [1] |
| Permission | Asked only from a direct user action (tap). User manages it per app in Settings | Verified | [1] |
| Badge | Badging API works for Home Screen web apps from 16.4; `navigator.setAppBadge`. Can update during push handling | Verified | [1][2] |
| Declarative Web Push | Payload with top-level `web_push` key; the browser shows it without service worker JS. `app_badge` field sets the badge. Testable on iOS 18.4 | Verified (WebKit); standards status per a vendor blog only | [3] |
| Silent push | Not found in any source. Treat every push as visible: iOS may revoke a subscription that does not show a notification | Est. (PR 90 source 16, vendor summary) | [1] |
| Background sync | None | Est. | PR 90 [16] |
| Push service | Apple's own service carries the message. No paid provider | Verified | [1] |
| Storage | Home Screen app storage is separate from Safari tabs. Sign-in done in Safari does not carry over; sign in inside the installed app | Est. | test on device |

Implications:

- The user must add Stack to the Home Screen, then tap `Notify me`. Both are human steps.
- Send only pushes that matter. Each one is visible; noise burns the permission.
- Keep payload tiny (ask key + title). Apple sees the payload only encrypted (Web Push encrypts to the subscription keys, RFC 8291). Est.; not re-verified here.

## 2. Login: passkeys vs device token

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| SWA GitHub sign-in (exists) | Zero code. Owner allow-list | OAuth redirect inside a Home Screen app is clumsy; cookie lifetime not owner-controlled; no per-device revoke | Keep as owner login on desktop |
| Passkey (WebAuthn) | Phishing-resistant; Face ID; no secret to leak | Needs a server verifier (new dependency, e.g. `@simplewebauthn/server`), challenge store, RP ID bound to one domain. Passkey ceremonies in an installed iOS web app: not confirmed by any source found | Next slice. Test on device first |
| Device token (bearer, per device) | Reuses hashed, scoped, revocable tokens already tested. One revoke kills one phone. No new dependency | A stolen phone with an unlocked app holds the token. Token sits in app storage | **First slice**, with short life (90 days) and narrow scopes |

Passkey facts: Safari 16+/iOS 16+ support WebAuthn platform passkeys (secondary sources only); RP ID must match the site domain, so a domain change breaks passkeys ([4] snippets, Est.). A passkey does not remove the need for a session after login, so it feeds the same device-token model (login with passkey → mint device token). Design it that way so the next slice is additive.

Pairing: owner creates a device on a trusted session; the one-time token reaches the phone by QR or link. Token goes in a URL fragment (never sent to a server or logged), the page stores it and clears the fragment. Web UI is not in the first slice.

## 3. Reaching the Mac host

| Path | Mac asleep | Exposure | Cost | Notes | Verdict |
| --- | --- | --- | --- | --- | --- |
| Azure host + git (exists) | Works; Mac pulls later | Existing SWA + token | $0 | Source of truth is GitHub | **Default** |
| Tailscale Serve | Fails | Tailnet only. Funnel makes it public: never | Free personal plan (Est.) | iPhone needs the Tailscale app and sign-in; host sees `Tailscale-User-Login` [5][6] | **Live view**, later |
| Cloudflare Tunnel + Access | Fails | Public hostname; auth only from Access or the app | Free tier (Est.) | Browsers get an Access login; service tokens (`CF-Access-Client-Id/Secret` headers) suit non-browser clients; a Home Screen PWA cannot add headers, so it needs the interactive login. Official docs not read | Reject for now: more accounts and a public hostname |
| Own relay | Fails | Public endpoint | Build cost | Happy-style [7] | Reject |
| Always-on cloud agent host | Works | Secrets in cloud | Compute cost | Breaks "token stays on Mac" | Later, if Mac uptime hurts |

Secondary comparisons agree: Tailscale suits "only inside my private network"; Cloudflare Tunnel + Access suits internet exposure with identity gating ([8][9], blog level, Est.).

Decision: the phone's normal path is the Azure host. The Mac is reached by git (async) and, later, by Tailscale Serve (live).

## 4. Offline queue via git

- Today: phone writes need a connection ([hosting](../../../docs/hosting.md) non-goal). Reads are cached by the service worker (`pwa` FR:offline).
- Design: the page keeps answers made offline in IndexedDB as `{ask key, answer, text, ask.updated at read time}`. On `online` it replays each through `POST /api/asks/{key}/answer`. The Azure host commits to `main`; the Mac pulls and resumes the agent.
- Conflict: if the ask changed (answered, closed), the API refuses; the page drops the item and shows one toast. No silent overwrite.
- Risk: iOS can evict IndexedDB for unused web apps (Est.). Show the queue count; flush on every foreground.
- Not in this slice. Spec as `FR:queue.*` P3 in `spec.md`.

## 5. Notification design

- Rule: push only an open ask whose deadline (`by`) is in the next 60 minutes. Nothing else.
- Why: iOS push is always visible [1]; the owner wants only time-critical items; it bounds volume.
- Quiet hours: do not apply to due-within-1h asks (the existing `FR:notify.quiet` already exempts deadlines within 2 hours).
- One ask: title = ask text, tag = ask key. Several: one push `<n> asks due within 1h`.
- Dedupe: one push per ask key and `by` value. A sender must not repeat.
- Badge: count of open asks due within 1h; cleared on answer. Set it from the push (declarative `app_badge`, or `setAppBadge` in the service worker).
- Payload: key + title only, title cut to 120 characters, control characters removed.
- Everything else waits in the app (the existing in-app notification covers the foreground).

## 6. Native SwiftUI shell?

Not justified now. Reasons for later, in order:

1. Push does not arrive or iOS revokes it for the PWA (test over two weeks first).
2. Widgets / Live Activities / Siri Shortcuts wanted ([stack-app research](https://github.com/Xerilium/stack/pull/90) §3).
3. Passkey or Keychain behavior is poor in the installed web app.

Costs: second UI, Swift toolchain, Apple Developer account ($99/yr, per PR 90), TestFlight/signing (human steps). A thin SwiftUI shell (WKWebView + APNs) is a smaller step than a full rewrite; decide then.

## Human-only steps (all later than this slice)

1. Apple: none for the PWA. Developer account only for native.
2. Generate VAPID keys; set host secrets (see PR body).
3. On the iPhone: update iOS (16.4+), open the site in Safari, Share → Add to Home Screen, open the app, tap `Notify me`.
4. Tailscale: account + app on Mac and iPhone (live view only).
5. Cloudflare: account (only if Tunnel is chosen; not recommended).

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| iOS push is flaky or revoked | Missed due alerts | Device test for two weeks; fall back to Claude Remote Control push or native shell |
| Stolen unlocked phone | Token use until revoked | Per-device revoke, 90-day life, narrow scopes; passkey + biometric next |
| Push endpoint abuse (SSRF) | Host posts to attacker URL | Accept only known push-service hosts |
| Token in app storage | XSS reads it | CSP `default-src 'self'` already; no inline script |
| Passkey in installed PWA unverified | Rework | Test before building |

## Sources

1. WebKit, Web Push for Web Apps on iOS and iPadOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
2. WebKit, Badging for Home Screen Web Apps: https://webkit.org/blog/14112/badging-for-home-screen-web-apps/
3. WebKit, Meet Declarative Web Push: https://webkit.org/blog/16535/meet-declarative-web-push/
4. Hanko, passkeys and iCloud Keychain (2021; dated): https://www.hanko.io/blog/how-to-support-apple-icloud-passkeys-with-webauthn
5. Tailscale Serve: https://tailscale.com/kb/1312/serve
6. Tailscale Funnel: https://tailscale.com/kb/1223/funnel
7. Happy: https://github.com/slopus/happy
8. Cloudflare Tunnel vs Tailscale Funnel vs ngrok (blog): https://guides.happier.dev/cloudflare-tunnel-vs-tailscale-funnel-vs-ngrok-for-claude-code-codex-opencode
9. Tailscale vs Cloudflare Tunnel for home remote access (blog): https://hometechops.com/guides/home-remote-access-tailscale-vs-cloudflare-tunnel
10. PR 90 research (iOS push limits, ACP, shells): https://github.com/Xerilium/stack/pull/90
