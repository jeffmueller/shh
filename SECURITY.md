# Security Policy

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Use GitHub's private vulnerability reporting:
[Security → Report a vulnerability](https://github.com/jeffmueller/shh/security/advisories/new).
That opens a private thread visible only to the maintainers.

Include what you'd want to receive: what you did, what happened, what you
expected, and the smallest reproduction you can manage. A proof of concept
against a local instance is ideal — please don't test against someone else's
running instance.

This is a small project maintained in spare time. Expect an initial response
within about a week. There is no bounty programme.

## Supported versions

The latest release on `main` is the only supported version. Fixes ship forward;
there are no backports.

## What this app does and doesn't defend against

Reports are most useful when they're about something the design actually claims
to protect. The full threat model is in the [README](README.md#threat-model);
in short:

**In scope**

- Recovering plaintext from the database alone. Encryption keys are never
  persisted — only ciphertext, IV, and auth tag are stored.
- Defeating burn-on-read: revealing a `first_view` secret twice, or racing two
  concurrent reveals so both return plaintext.
- Bypassing the reveal rate limit and brute-forcing a secret's password.
- Bypassing bearer-token auth on `/api/v1` when `SHH_API_TOKENS` is set.
- XSS or HTML injection through secret content.
- Leaking the decryption key to the server — it lives in the URL fragment and
  must never reach request logs.
- Leaving revealed plaintext recoverable on disk (service worker cache,
  browser history, `CacheStorage`).

**Out of scope**

- An attacker who controls the server during a reveal. Decryption happens
  server-side, so a compromised host can read plaintext in flight. This is a
  stated limitation of the design, not a bug.
- Anyone holding the full share URL. The key is in that URL by design — whoever
  has the link can read the secret, which is the point.
- Missing HSTS, TLS misconfiguration, or an exposed instance on a deployment the
  operator set up themselves. Configuration guidance is in
  [DOCKER.md](DOCKER.md).
- Rate limits behaving oddly when `SHH_TRUSTED_PROXY_HOPS` doesn't match the
  actual proxy topology. That's a misconfiguration — though a report that the
  *documented* setting doesn't work is very much in scope.
- Denial of service by simply sending lots of traffic.
- Vulnerabilities in dependencies with no exploitable path in this app. Please
  say how it's reachable from here.

## Notes for operators

- Set `SHH_TRUSTED_PROXY_HOPS` to match your topology. Getting it wrong makes
  the rate limits either global or bypassable — see
  [DOCKER.md](DOCKER.md#shh_trusted_proxy_hops--read-this-one).
- The `/api/v1` surface is unauthenticated unless you set `SHH_API_TOKENS`. The
  web form is always open; put auth in front of the whole instance if you need
  it private.
- Back up `data/` — and note that a stolen backup reveals nothing on its own,
  because the keys were never in it. Don't undermine that by storing share
  links alongside it.
