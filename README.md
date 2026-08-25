# shh.

Self-destructing secret sharing. Like OneTimeSecret, self-hosted on a Raspberry Pi.

## How it works

1. Paste a secret on the home page, choose an expiry (`first_view`, `1h`, `6h`, `12h`, `1d`, `1w`), optionally set a password.
2. The server generates a random AES-256-GCM key, encrypts the plaintext, and stores **only the ciphertext** in SQLite. The key is never persisted.
3. You get a private URL like `https://shh.example.com/s/<uuid>#<key>`. The key lives in the URL **fragment** so it never reaches the server in normal request logs.
4. The recipient opens the URL, clicks to reveal, and (if password-protected) enters the password. The server uses the key from the request body to decrypt the ciphertext.
5. If `first_view`, the row is deleted in the same transaction. Otherwise, a sweeper runs every minute and deletes anything past its `expires_at`.

## Threat model

- **DB-only compromise**: nothing is recoverable. Encryption keys are not in the DB.
- **DB + URL**: the secret is recoverable. If a password was set, the password must also be cracked (bcrypt, 12 rounds). For high-stakes secrets, set a strong password.
- **Server compromise during reveal**: an attacker controlling the server can intercept the decrypted plaintext. This app cannot defend against that.
- **XSS**: secrets are rendered as text inside `<pre>` (React auto-escapes). CSP forbids inline scripts. There is no rich-text rendering.
- **Link-preview burn**: viewing requires a click, so chat clients that prefetch URLs (Slack, iMessage, etc.) won't burn first-view secrets.
- **On-device cache**: the service worker's cache is opt-in, not opt-out. Only `/_next/static/*` (immutable build output) and `/icons/*` are ever written to CacheStorage. `/s/*`, `/created/*` and `/api/*` are hard-denied before any caching strategy runs, and *no* navigation response is cached — so a revealed secret can't be replayed from disk after it self-destructs.

## Install as an app (PWA)

The app is installable on desktop and mobile: `app/manifest.ts` serves
`/manifest.webmanifest`, and `public/sw.js` provides the offline behaviour that
browsers require before offering an install prompt.

The service worker is registered in production only
(`components/ServiceWorkerRegistrar.tsx`). Under `next dev` it actively
unregisters instead, because it serves `/_next/static/*` cache-first — true of a
production build, but not of dev, where those URLs change on every recompile.

Offline, every navigation falls back to `/offline`. Nothing else is cached; see
the on-device cache note in the threat model above. After changing the caching
rules, bump `CACHE_VERSION` in `public/sw.js` to invalidate existing clients.

Icons are generated from `public/icons/icon.svg` and `public/icons/maskable.svg`:

```sh
cd public/icons
rsvg-convert -w 192 -h 192 icon.svg     -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg     -o icon-512.png
rsvg-convert -w 192 -h 192 maskable.svg -o maskable-192.png
rsvg-convert -w 512 -h 512 maskable.svg -o maskable-512.png
rsvg-convert -w 180 -h 180 maskable.svg -o apple-touch-icon.png
```

## Local development

```sh
npm install
npm run dev
```

Open http://localhost:3000.

## Deployment (Raspberry Pi)

One-time:
```sh
cd deployment
cp .env.deploy.example .env.deploy   # set PI_USER / PI_HOST / DOMAIN_NAME
./setup-pi.sh
```

Each deploy:
```sh
./deployment/deploy.sh
```

Nginx config and systemd unit live in `deployment/`. Service runs on port 3011.

## Limits

- Plaintext: 100 KB max.
- Reveal attempts: 10 per IP+id per 5 minutes.
- Plain text only — no file upload, no markdown.
