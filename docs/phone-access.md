<!-- @req FR:tailnet-access/docs.phone @req FR:tailnet-access/docs.threat -->
# Phone access over Tailscale

Open the live Stack host on your Mac from your iPhone, in private, with no delay. Spec: [tailnet-access](../.xe/features/tailnet-access/spec.md).

## Steps

1. Mac: install Tailscale ([download](https://tailscale.com/download)) and sign in.
2. iPhone: install Tailscale from the App Store, sign in with the same account, and turn it on.
3. Admin console, [DNS](https://login.tailscale.com/admin/dns): turn on MagicDNS, then HTTPS Certificates.
4. Mac: run `stack web --live --bind tailnet` (or set `"bind": "tailnet"` in `~/.config/stack/config.json`).
5. Mac: run `tailscale serve --bg 4173`. Copy the `https://<mac>.<tailnet>.ts.net` URL it prints.
6. Mac: run `stack devices add iPhone`. Copy the pairing code (it shows once; Universal Clipboard sends it to the iPhone).
7. iPhone, Safari: open `https://<mac>.<tailnet>.ts.net/pair`, paste the code, tap **Pair**.
8. Safari: tap **Share**, then **Add to Home Screen**, then **Add**.
9. Open Stack from the Home Screen. If it shows **Pair this phone**, paste the code again.

Lost the code or the phone: `stack devices revoke <id>` (ids: `stack devices list`), then `stack devices add iPhone` again.

## Why HTTPS

Web Push and the service worker need a secure context. Plain `http://100.x.y.z:4173` works on the tailnet, but iOS gives it no push. `tailscale serve` adds HTTPS on the tailnet name and proxies to `127.0.0.1:4173`. The host trusts its `X-Forwarded-Host` and `X-Forwarded-Proto` headers only from loopback.

## Threat notes

- The host listens on `127.0.0.1` and the Mac's Tailscale addresses only, never `0.0.0.0`. No Funnel: nothing is public.
- Without Tailscale running, `--bind tailnet` refuses to start.
- Every request that is not from the Mac itself needs a paired device token (cookie or bearer). Other tailnet members get the pairing page only.
- A remote Host must be a Tailscale address or a `*.ts.net` name, so a DNS-rebinding page gets `403`.
- Proxy headers count only from loopback. A tailnet peer cannot fake `tailscale serve`.
- The device acts as the owner, but cannot mint or revoke tokens or devices. Revoke cuts it off on the next request.
- The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS. Cross-site writes get `403`.
- Tokens live in `~/.stack` (mode 0600) as hashes. Logs never hold a token or a pairing code.
