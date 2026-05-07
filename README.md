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
