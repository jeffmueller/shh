# Running shh in Docker

Self-hosted secret sharing on a NAS, a Raspberry Pi, or any box that runs
containers. Images are published for `linux/amd64` and `linux/arm64`.

> Raspberry Pi needs a **64-bit** OS. 32-bit `armv7` is not built — check with
> `uname -m` (want `aarch64`, not `armv7l`).

## Quick start

```sh
git clone https://github.com/jeffmueller/shh.git
cd shh
cp .env.docker.example .env
$EDITOR .env                 # set SHH_BASE_URL to the address people will visit
mkdir -p data && chown 1000:1000 data
docker compose up -d
```

The app listens on `127.0.0.1:3011` and expects a reverse proxy in front. Point
yours at it, or use the [bundled Caddy overlay](#option-b-bundled-caddy) for
automatic HTTPS.

Check it came up:

```sh
curl -sS localhost:3011/api/health          # {"status":"ok"}
docker compose ps                            # STATUS should say (healthy)
```

## Configuration

Everything is read from the environment **at runtime**, so changing a value and
running `docker compose up -d` is enough — images are never rebuilt for config.

| Variable | Default | Purpose |
|---|---|---|
| `SHH_BASE_URL` | derived from proxy headers | Public origin. What the API puts in the shareable link. No trailing slash. |
| `SHH_INSTANCE_NAME` | the host | Friendly label reported by `/api/v1/info`. |
| `SHH_API_TOKENS` | *(unset — API open)* | Bearer tokens for `/api/v1`, comma separated. |
| `SHH_CREATE_RATE_LIMIT` | `60` | Secrets one IP may create per hour. `0` disables. |
| `SHH_TRUSTED_PROXY_HOPS` | `1` | Reverse proxies in front. See below — this one matters. |
| `SHH_CLIENT_IP_HEADER` | *(unset)* | Trusted single-value client-IP header, e.g. `CF-Connecting-IP`. |
| `SHH_DB_PATH` | `/data/secrets.db` | SQLite location inside the container. |

Generate an API token with `openssl rand -base64 32`. See
[PLUGIN_API.md](PLUGIN_API.md) for what the API does.

### Set `SHH_BASE_URL`

Without it the origin is inferred from the proxy's `X-Forwarded-Proto` and
`Host`. That is correct behind a properly configured proxy and silently wrong
behind a misconfigured one — and "silently wrong" here means handing people
share links that don't work. Set it explicitly.

## Reverse proxy

shh speaks plain HTTP and expects TLS to terminate in front of it. Your proxy
must pass three things:

| Header | Why |
|---|---|
| `X-Forwarded-Proto` | So generated links say `https://`, not `http://`. |
| `Host` or `X-Forwarded-Host` | So links use your domain, not the container's. |
| `X-Forwarded-For` | So rate limits key on the real client. |

Also allow request bodies up to **256 KB** (secrets cap at 100 KB, plus JSON
overhead). nginx's default `client_max_body_size` of 1 MB is fine; some proxies
are stricter.

### `SHH_TRUSTED_PROXY_HOPS` — read this one

`X-Forwarded-For` is a list that each proxy *appends* to, so a client can
pre-seed it. Trusting the leftmost entry lets anyone hand themselves a fresh
rate-limit bucket per request, which defeats brute-force protection on
password-protected secrets entirely. shh instead counts back from the right,
and needs to know how many entries your infrastructure added.

| Topology | Value |
|---|---|
| One proxy — Caddy, Traefik, nginx, NPM, a NAS's built-in proxy | `1` *(default)* |
| Cloudflare (or similar) in front of your own proxy | `2` |
| No proxy at all | `0` |

`0` makes the app ignore forwarded headers entirely; every request then shares
one rate-limit bucket, which throttles rather than lets abuse through. Only
appropriate when the instance isn't publicly reachable.

Behind Cloudflare you can instead set `SHH_CLIENT_IP_HEADER=cf-connecting-ip`,
which Cloudflare always overwrites.

### Option A: your existing proxy

If the proxy runs **on the host**, the default loopback publish works — point it
at `http://127.0.0.1:3011`.

If the proxy is **a container**, don't publish a port at all. Delete the `ports:`
block from `docker-compose.yml`, put both containers on a shared network, and
have the proxy target `http://shh:3000`.

<details>
<summary>nginx</summary>

```nginx
location / {
    proxy_pass http://127.0.0.1:3011;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 256k;
}
```
</details>

<details>
<summary>Traefik labels</summary>

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.shh.rule=Host(`shh.example.org`)
  - traefik.http.routers.shh.tls.certresolver=le
  - traefik.http.services.shh.loadbalancer.server.port=3000
```
</details>

### Option B: bundled Caddy

Only if nothing else owns :80/:443. Caddy handles Let's Encrypt automatically;
the domain must already resolve to this host and both ports must be reachable
for the ACME challenge.

```sh
echo "SHH_DOMAIN=shh.example.org" >> .env
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

Certificates live in the `caddy_data` volume — keep it, or Caddy re-issues on
every recreate and you may hit Let's Encrypt rate limits.

## Data and backups

Everything lives in `./data`, mounted at `/data`. That single directory is the
whole instance.

SQLite runs in WAL mode, so recent writes may sit in `secrets.db-wal` rather
than `secrets.db`. **Copying `secrets.db` alone from a running container can
miss data.** Either stop the container first:

```sh
docker compose stop shh
cp -a data "backup-$(date +%F)"
docker compose start shh
```

or take a consistent online copy with the `sqlite3` CLI on the host, which
checkpoints the WAL for you:

```sh
sqlite3 data/secrets.db ".backup 'backup-$(date +%F).db'"
```

Backups are worth thinking about carefully here: the database holds only
ciphertext, and decryption keys live in the share URLs, never on disk. A stolen
backup reveals nothing on its own — which is the point of the design, and a
reason not to weaken it by storing links next to it.

### Permissions

The container runs as uid/gid **1000** and cannot write a directory owned by
someone else. This is the most common failure on a NAS.

```sh
chown -R 1000:1000 ./data
```

If your NAS insists on a different uid, uncomment `user:` in
`docker-compose.yml` and set `PUID`/`PGID` in `.env` to match the directory's
actual owner (`stat -c '%u:%g' ./data`).

## NAS notes

**Synology** — Container Manager can import `docker-compose.yml` as a Project.
Put the project under `/volume1/docker/shh`, and set `PUID`/`PGID` to the owner
of the `data` folder. If you use Synology's own reverse proxy (Control Panel →
Login Portal → Advanced), it terminates TLS, so keep `SHH_TRUSTED_PROXY_HOPS=1`
and add `X-Forwarded-For` in the custom-header section — it is not sent by
default.

**Unraid** — either the Compose Manager plugin, or a manual container with
`/data` mapped to `/mnt/user/appdata/shh` and the env vars from the table above.

**QNAP** — Container Station supports Compose applications. Same `PUID`/`PGID`
caveat as Synology.

## Updating

```sh
docker compose pull && docker compose up -d
```

Pin a version rather than tracking `:latest` if you'd rather update
deliberately — `ghcr.io/jeffmueller/shh:1.0.0`. The schema is created on demand
and additive, so upgrades don't need a migration step.

## Building it yourself

```sh
docker compose build && docker compose up -d          # local, current arch
```

Multi-arch, for pushing to your own registry:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -t your-registry/shh:local --push .
```

The build compiles `better-sqlite3` inside the target architecture, so the
native binding always matches the runtime — the class of problem that
`deployment/deploy.sh` works around when cross-building for a Pi from a laptop.

No `NEXT_PUBLIC_*` build arguments are accepted on purpose: Next inlines those
as build-time constants, and baking one operator's hostname into an image
everyone else pulls is exactly the bug this setup avoids.

## Troubleshooting

**`(unhealthy)` or 503 from `/api/health`** — the health check opens SQLite, so
this almost always means `/data` isn't writable. Check ownership (above) and
`docker compose logs shh`.

**Share links have the wrong host or say `http://`** — `SHH_BASE_URL` is unset
and the proxy isn't sending `X-Forwarded-Proto`/`Host`. Set `SHH_BASE_URL`.

**Everyone gets rate-limited at once** — `SHH_TRUSTED_PROXY_HOPS` is `0`, or
your proxy isn't sending `X-Forwarded-For`, so every request keys to the same
bucket. Confirm with `curl -sS localhost:3011/api/v1/info` and check the proxy.

**`exec format error`** — 32-bit OS. Reinstall 64-bit, or build locally.

**Container starts, secrets vanish on restart** — `./data` isn't actually
mounted; the database is being written inside the container's writable layer.
Check `docker compose config` shows the volume.
