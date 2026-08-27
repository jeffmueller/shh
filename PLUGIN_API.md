# shh HTTP API (`/api/v1`)

A stable, versioned API for programmatic clients — an Omarchy plugin, a CLI, a
script. Everything under `/api/v1` is a contract; the unversioned routes under
`/api/secrets` are internal to the web UI and may change without notice.

Anyone can self-host shh, so **a client must never hardcode a server address.**
Make it a user-visible setting and discover the rest with `GET /api/v1/info`.

## Quick start

```sh
SHH=https://shh.example.org

# 1. Is this a shh instance, and what does it allow?
curl -sS "$SHH/api/v1/info"

# 2. Create a secret. The response carries a ready-to-share URL.
curl -sS -X POST "$SHH/api/v1/secrets" \
     -H 'Content-Type: application/json' \
     -d '{"plaintext":"hunter2","expiry":"1h"}'
```

```json
{
  "id": "cb684cb7-a634-407d-b025-f7b78b9712cb",
  "key": "yJrhkgc1HPMSnSZwOZcKjSX3HU1iXhw1FU6gmBqyhq0",
  "url": "https://shh.example.org/s/cb684cb7-.../#yJrhkgc1...",
  "expiry": "1h",
  "expiresAt": 1787845665,
  "expiresAtIso": "2026-08-27T15:47:45.000Z",
  "burnAfterRead": false,
  "hasPassword": false
}
```

`url` is the whole point of this API: a desktop client has no
`window.location` to build the link from, and an instance behind a reverse
proxy can't reliably infer its own public origin. Copy `url` to the clipboard
and you're done.

---

## Configuring the server address

Treat the server address as **required user configuration with no default**.
A client should:

1. Take a base URL from the user (e.g. `https://shh.example.org`). Strip any
   trailing slash.
2. `GET {base}/api/v1/info` to validate it. A JSON body with `"service": "shh"`
   means the address is good. Anything else — non-200, HTML, a different
   `service` — is a misconfigured address; say so rather than failing later on
   a create.
3. Cache `expiryOptions`, `limits`, and `auth.required` from that response and
   build the UI from them, rather than hardcoding the option list. A future
   instance may offer different expiry choices or a smaller size cap.
4. Re-run discovery when the user changes the address, and on a `401` (the
   operator may have just turned auth on).

Do not assume the instance is reachable, HTTPS, or public. Self-hosters run
these on a LAN, behind Tailscale, on odd ports.

---

## Discovery — `GET /api/v1/info`

Unauthenticated even when the instance requires a token: a client needs to
learn *that* a token is required before it has one. Nothing here is secret.

```jsonc
{
  "service": "shh",              // always "shh" — use this to validate an address
  "apiVersion": 1,
  "appVersion": "0.1.0",
  "instance": {
    "name": "shh.example.org",   // operator-set label, or the host
    "baseUrl": "https://shh.example.org"
  },
  "auth": { "required": false, "scheme": "bearer" },
  "limits": {
    "maxPlaintextBytes": 102400,
    "maxPasswordLength": 256,
    "createPerHour": 60,         // 0 = the app-level create limit is disabled
    "revealAttemptsPer5Min": 10
  },
  "defaults": { "expiry": "first_view" },
  "expiryOptions": [
    { "value": "first_view", "label": "First view", "seconds": null },
    { "value": "1h",  "label": "1 hour",  "seconds": 3600 },
    { "value": "6h",  "label": "6 hours", "seconds": 21600 },
    { "value": "12h", "label": "12 hours","seconds": 43200 },
    { "value": "1d",  "label": "1 day",   "seconds": 86400 },
    { "value": "1w",  "label": "1 week",  "seconds": 604800 }
  ],
  "features": { "password": true, "reveal": true, "metadata": true },
  "endpoints": { "...": "..." }
}
```

---

## `POST /api/v1/secrets` — create

Send `Content-Type: application/json`. It is required, not merely
conventional — a body without it is rejected with `415` before it is read. An
HTML form cannot set that header, so requiring it keeps cross-origin forms from
reaching this endpoint at all.

**Request**

| Field | Type | Required | Notes |
|---|---|---|---|
| `plaintext` | string | yes | Non-empty, ≤ `limits.maxPlaintextBytes` (100 KB) as UTF-8. |
| `expiry` | string | no | One of `expiryOptions[].value`. Omit for `first_view`. |
| `password` | string | no | ≤ 256 chars. Omit, `null`, or `""` all mean "no password". |

**Response `201`**

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID v4. |
| `key` | string | base64url AES-256-GCM key. **Returned once and never stored.** |
| `url` | string | `{baseUrl}/s/{id}#{key}` — the link to share. |
| `expiry` | string | The resolved expiry. |
| `expiresAt` | number\|null | Unix seconds, or `null` for `first_view`. |
| `expiresAtIso` | string\|null | Same instant as ISO 8601, so you needn't do date math. |
| `burnAfterRead` | boolean | `true` when the first reveal destroys it. |
| `hasPassword` | boolean | |

The key lives in the URL **fragment**, which browsers never send to the server.
Keep it there — a client that rewrites `#` to `?` hands the key to the server's
access log and breaks the entire threat model.

## `GET /api/v1/secrets/{id}` — metadata

Non-destructive: a burn-on-read secret survives this call. That is what lets a
client prompt for a password before spending its single view.

Always `200`. Unknown, expired, and already-burned ids all return
`{"exists": false}` — deliberately indistinguishable.

```json
{ "exists": true, "hasPassword": true, "burnAfterRead": true,
  "expiresAt": null, "expiresAtIso": null }
```

## `POST /api/v1/secrets/{id}/reveal` — decrypt

**Destructive** for `burnAfterRead` secrets. There is no second chance, so
gather the password first.

```jsonc
// request
{ "key": "yJrhkgc1...", "password": "optional" }

// 200
{ "plaintext": "hunter2", "burned": true }
```

Recommended flow: `GET` the metadata → if `hasPassword`, prompt → `POST` the
reveal once. Never speculatively reveal to "check if it exists".

---

## Errors

Every failure is JSON with a stable machine-readable `code` and a human
`message`. **Branch on `code`, never on `message`** — wording may change.

```json
{ "error": "invalid expiry", "code": "invalid_expiry" }
```

| Code | Status | Meaning |
|---|---|---|
| `unsupported_media_type` | 415 | Missing or wrong `Content-Type`; send `application/json`. |
| `invalid_json` | 400 | Body wasn't valid JSON. |
| `plaintext_required` | 400 | Missing or empty `plaintext`. |
| `invalid_expiry` | 400 | Not one of `expiryOptions[].value`. |
| `invalid_password` | 400 | Not a string, or over 256 chars. |
| `plaintext_too_large` | 413 | Over 100 KB. Check `limits.maxPlaintextBytes` first. |
| `unauthorized` | 401 | Missing or wrong bearer token. |
| `password_required` | 401 | Secret is password-protected; prompt and retry. |
| `not_found` | 404 | Unknown, expired, burned, wrong key, **or wrong password**. |
| `rate_limited` | 429 | Honour the `Retry-After` header. |

`not_found` covers wrong-password on purpose, so an attacker can't use the
response to confirm an id exists. A `401 password_required` says only that a
password is *needed*, never whether a given one is right.

---

## Authentication

Optional, and off by default — a fresh instance is as open as its web form
already is, which suits a LAN deployment. If the operator sets `SHH_API_TOKENS`,
every `/api/v1` route except `/api/v1/info` requires:

```
Authorization: Bearer <token>
```

The scheme keyword is case-insensitive. On failure you get `401` with
`WWW-Authenticate: Bearer realm="shh"` and `"code": "unauthorized"`.

Check `auth.required` from `/api/v1/info` during setup and prompt for a token
only when it's `true`. Treat a `401` on a previously working instance as "the
operator enabled auth" — re-run discovery and ask for a token.

The browser routes under `/api/secrets` are never token-gated; the web UI has
nowhere to hide a token. Auth here protects the *programmatic* surface. An
operator who wants the whole instance private should front it with nginx basic
auth, Tailscale, or a VPN.

---

## Rate limits

| Action | Default | Key | Tunable |
|---|---|---|---|
| Create | 60/hour | client IP | `SHH_CREATE_RATE_LIMIT` (`0` disables) |
| Reveal | 10 per 5 min | client IP + secret id | no |

Both are shared with the web UI — the same bucket counts a create from the
browser form and one from the API, and reveal attempts can't be doubled by
alternating between the two surfaces. Successful creates carry
`X-RateLimit-Limit` and `X-RateLimit-Remaining`; `429`s carry `Retry-After` in
seconds. Back off rather than retrying in a tight loop.

Both limits key on the client IP taken from the trustworthy end of
`X-Forwarded-For` — see `SHH_TRUSTED_PROXY_HOPS`. An operator who sets that
wrong (or runs unproxied) gets limits that are global or bypassable, so a
client shouldn't treat a missing `429` as proof it may hammer an instance.

The reference nginx config adds its own coarse `5r/s` per-IP limit on `/api`.

---

## Client requirements

**Send a real `User-Agent`.** The bundled nginx config returns `444` (connection
closed, no response) for an empty User-Agent, and blocks anything matching
`httpx`, `scrapy`, `curl`-adjacent scanner names, and similar. Some HTTP
libraries send no UA by default. Set something like `shh-omarchy/1.0` and this
never bites you; leave it empty and you get an unexplained connection reset.

**Keep secrets out of `argv`.** Anything on a command line is world-readable via
`ps aux` for the life of the process. Don't do this:

```sh
curl -d "{\"plaintext\":\"$SECRET\"}" -H "Authorization: Bearer $TOKEN" ...   # leaks both
```

Pass the body and headers over stdin instead:

```sh
BODY=$(jq -nc --arg p "$SECRET" --arg e 1h '{plaintext:$p, expiry:$e}')
{
  printf 'url = "%s/api/v1/secrets"\n' "$SHH"
  printf 'header = "Content-Type: application/json"\n'
  printf 'header = "User-Agent: shh-omarchy/1.0"\n'
  [ -n "$TOKEN" ] && printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"
  printf 'data = %s\n' "$(printf '%s' "$BODY" | jq -Rs .)"
} | curl -sS --max-time 10 --config -
```

`curl --config -` reads every option from stdin, so the process line is just
`curl -sS --config -`.

**Other rules of thumb**

- Always send `Content-Type: application/json` on POSTs; without it you get a `415`.
- Store the token with the config, not in a world-readable file. Never log it.
- Don't write plaintext to disk, shell history, or a notification body.
- Set a timeout (`--max-time 10`). A self-hosted Pi over a VPN can be slow.
- Treat `url` as opaque and pass it around whole, fragment included.

---

## Consuming this from an Omarchy plugin

Omarchy shell plugins are Quickshell/QML and do HTTP by shelling out to `curl`
through `Quickshell.Io.Process` (see `omarchy.weather` for the first-party
precedent). Bar widgets receive a `settings` object injected from
`~/.config/omarchy/shell.json`, which is the natural home for the server
address:

```jsonc
// ~/.config/omarchy/shell.json
{
  "bar": {
    "right": [
      { "id": "yourname.shh", "settings": { "baseUrl": "https://shh.example.org" } }
    ]
  }
}
```

Sketch of the create call — stdin-fed so neither the token nor the secret
reaches `argv`:

```qml
import Quickshell.Io

Process {
  id: createProc
  command: ["curl", "-sS", "--max-time", "10", "--config", "-"]
  stdinEnabled: true

  stdout: StdioCollector {
    onStreamFinished: {
      const res = JSON.parse(this.text)   // guard this in real code
      if (res.url) clipboard.set(res.url)
    }
  }
}

function createSecret(plaintext, expiry) {
  const base = (settings.baseUrl || "").replace(/\/+$/, "")
  const body = JSON.stringify({ plaintext: plaintext, expiry: expiry })

  createProc.running = true
  createProc.write(
    'url = ' + JSON.stringify(base + "/api/v1/secrets") + '\n' +
    'header = "Content-Type: application/json"\n' +
    'header = "User-Agent: shh-omarchy/1.0"\n' +
    (settings.token ? 'header = ' + JSON.stringify("Authorization: Bearer " + settings.token) + '\n' : '') +
    'data = ' + JSON.stringify(body) + '\n'
  )
  createProc.stdinEnabled = false   // EOF, so curl stops reading the config
}
```

Note `curl`'s config format takes a *double-quoted, backslash-escaped* value,
which `JSON.stringify` happens to produce correctly for the strings involved.

Suggested plugin behaviour:

- Widget click → prompt for the secret (or read the clipboard) → create →
  put `url` back on the clipboard → notify "copied, burns on first view".
- Expose `baseUrl` and an optional `token` in `settings`; validate with
  `/api/v1/info` when either changes and surface a clear error on failure.
- Build the expiry menu from `expiryOptions`, defaulting to `defaults.expiry`.
- Never put the plaintext or the resulting `url` in a desktop notification —
  notification history is persistent and readable.

---

## Server configuration

Runtime environment variables, all read per-request — change them in the
systemd `EnvironmentFile` (`~/shh/.env` in the reference deployment) and
restart. No rebuild needed.

| Variable | Default | Purpose |
|---|---|---|
| `SHH_BASE_URL` | derived from forwarded headers | Public origin used to build `url`. |
| `NEXT_PUBLIC_BASE_URL` | — | Legacy alias, used only if `SHH_BASE_URL` is unset. |
| `SHH_INSTANCE_NAME` | the host | Label reported by `/api/v1/info`. |
| `SHH_API_TOKENS` | *(unset — auth off)* | Comma/whitespace-separated bearer tokens. |
| `SHH_CREATE_RATE_LIMIT` | `60` | Creates per IP per hour. `0` disables. |
| `SHH_TRUSTED_PROXY_HOPS` | `1` | Reverse proxies in front; picks the trustworthy end of `X-Forwarded-For`. |
| `SHH_CLIENT_IP_HEADER` | — | Trusted single-value client-IP header, e.g. `cf-connecting-ip`. |
| `SHH_DB_PATH` | `./data/secrets.db` | SQLite location. |

Generate a token with `openssl rand -base64 32`.

Set `SHH_BASE_URL` if you can. Without it the origin is derived from the
request's `X-Forwarded-Proto`/`Host`, which is correct behind the bundled nginx
config but client-controlled — a spoofed `Host` only poisons the spoofer's own
response, never anything stored, but an explicit value removes the question.

---

## Stability

`/api/v1` is additive-only: new response fields and new error `code` values may
appear, existing ones won't change meaning or disappear. Parse leniently and
ignore fields you don't recognise. A breaking change would ship as `/api/v2`
alongside it.
