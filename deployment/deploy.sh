#!/bin/bash

# shh - Deployment Script
# Builds Next.js locally and deploys standalone output to Raspberry Pi.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status()  { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$SCRIPT_DIR/.env.deploy" ]; then
    source "$SCRIPT_DIR/.env.deploy"
fi

PI_USER=${PI_USER:-"pi"}
PI_HOST=${PI_HOST:-""}
DOMAIN_NAME=${DOMAIN_NAME:-""}

# No defaults for these two on purpose: a wrong host or domain silently
# deploys somewhere unintended, so fail loudly instead.
require_config() {
    local missing=0
    [ -z "$PI_HOST" ]     && { echo "PI_HOST is not set"; missing=1; }
    [ -z "$DOMAIN_NAME" ] && { echo "DOMAIN_NAME is not set"; missing=1; }
    if [ "$missing" = 1 ]; then
        echo ""
        echo "Set them in deployment/.env.deploy (copy .env.deploy.example) or"
        echo "pass them as environment variables:"
        echo "  PI_HOST=192.0.2.10 DOMAIN_NAME=shh.example.com $0"
        exit 1
    fi
}

# The nginx configs are templates; fill in the host-specific parts on upload.
render_nginx_conf() {
    sed -e "s|__DOMAIN_NAME__|$DOMAIN_NAME|g" \
        -e "s|__PI_USER__|$PI_USER|g" "$1"
}
RESTART_SERVICE=true
UPDATE_NGINX=false

show_usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --no-restart      Don't restart the service after deployment"
    echo "  --update-nginx    Also update the nginx config"
    echo "  --help            Show this help message"
    echo ""
    echo "Environment (or .env.deploy): PI_USER, PI_HOST, DOMAIN_NAME"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-restart)    RESTART_SERVICE=false; shift ;;
        --update-nginx)  UPDATE_NGINX=true; shift ;;
        --help)          show_usage; exit 0 ;;
        *)               print_error "Unknown option: $1"; show_usage; exit 1 ;;
    esac
done

require_config

print_status "═══════════════════════════════════════════════"
print_status "  shh - Deploy to Raspberry Pi"
print_status "═══════════════════════════════════════════════"
print_status "Target: $PI_USER@$PI_HOST"
print_status "═══════════════════════════════════════════════"
echo ""

print_status "Testing SSH connection..."
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$PI_USER@$PI_HOST" exit 2>/dev/null; then
    print_error "Cannot connect to $PI_USER@$PI_HOST"
    exit 1
fi
print_success "Connection OK"

# ─── Build ───────────────────────────────────────────────────────────────

print_status "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_status "  Building Next.js for production"
print_status "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$PROJECT_ROOT"

print_status "Installing dependencies..."
npm install --silent

print_status "Building..."
npm run build
print_success "Build complete"

# ─── Package ─────────────────────────────────────────────────────────────

print_status "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_status "  Packaging for deployment"
print_status "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DEPLOY_TMP=$(mktemp -d)
DEPLOY_ARCHIVE="$DEPLOY_TMP/shh-deploy.tar.gz"

mkdir -p "$DEPLOY_TMP/app"
cp -r .next/standalone/. "$DEPLOY_TMP/app/" 2>/dev/null || true

mkdir -p "$DEPLOY_TMP/app/.next/static"
cp -r .next/static/. "$DEPLOY_TMP/app/.next/static/" 2>/dev/null || true

if [ -d public ]; then
    mkdir -p "$DEPLOY_TMP/app/public"
    cp -r public/. "$DEPLOY_TMP/app/public/" 2>/dev/null || true
fi

mkdir -p "$DEPLOY_TMP/app/data"
cp package.json "$DEPLOY_TMP/app/package.json"

cd "$DEPLOY_TMP"
COPYFILE_DISABLE=1 tar -czf "$DEPLOY_ARCHIVE" -C "$DEPLOY_TMP" app/

ARCHIVE_SIZE=$(du -h "$DEPLOY_ARCHIVE" | cut -f1)
print_success "Package created ($ARCHIVE_SIZE)"

# ─── Upload & Extract ────────────────────────────────────────────────────

print_status "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_status "  Uploading to Raspberry Pi"
print_status "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

scp -q "$DEPLOY_ARCHIVE" "$PI_USER@$PI_HOST":~/shh-deploy.tar.gz

print_status "Extracting on Pi..."
ssh "$PI_USER@$PI_HOST" << 'ENDSSH'
set -e

# Backup current deployment
if [ -f ~/shh/app/server.js ]; then
    echo "Backing up current deployment..."
    BACKUP_DIR=~/shh/backups/$(date +%Y%m%d_%H%M%S)
    mkdir -p "$BACKUP_DIR"
    cp -r ~/shh/app "$BACKUP_DIR/"

    cd ~/shh/backups
    BACKUPS=$(ls -dt */ 2>/dev/null || true)
    if [ -n "$BACKUPS" ]; then
        count=$(echo "$BACKUPS" | wc -l)
        if [ "$count" -gt 5 ]; then
            echo "$BACKUPS" | tail -n +6 | xargs -r rm -rf
            echo "Cleaned old backups (kept 5 most recent)"
        fi
    fi
fi

# Preserve the SQLite database before swap
SAVED_DB=""
if [ -f ~/shh/app/data/secrets.db ]; then
    cp ~/shh/app/data/secrets.db /tmp/shh-secrets.db
    # Also preserve WAL/SHM if present
    [ -f ~/shh/app/data/secrets.db-wal ] && cp ~/shh/app/data/secrets.db-wal /tmp/shh-secrets.db-wal
    [ -f ~/shh/app/data/secrets.db-shm ] && cp ~/shh/app/data/secrets.db-shm /tmp/shh-secrets.db-shm
    SAVED_DB=1
    echo "Saved secrets.db before deploy"
fi

# Extract new deployment into a staging dir, then swap atomically.
mkdir -p ~/shh
cd ~/shh
rm -rf app.new app.old
mkdir app.new
tar -xzf ~/shh-deploy.tar.gz -C app.new --strip-components=1
if [ -d app ]; then
    mv app app.old
fi
mv app.new app
rm -rf app.old
rm ~/shh-deploy.tar.gz

# Restore SQLite database after swap
if [ -n "$SAVED_DB" ]; then
    mkdir -p ~/shh/app/data
    mv /tmp/shh-secrets.db ~/shh/app/data/secrets.db
    [ -f /tmp/shh-secrets.db-wal ] && mv /tmp/shh-secrets.db-wal ~/shh/app/data/secrets.db-wal
    [ -f /tmp/shh-secrets.db-shm ] && mv /tmp/shh-secrets.db-shm ~/shh/app/data/secrets.db-shm
    echo "Restored secrets.db after deploy"
fi

# Install better-sqlite3 fresh so npm fetches the prebuilt binary for THIS
# architecture (the Mac-built binary inside the standalone bundle won't load
# on the Pi). Then replace the standalone's hashed copy with the native one.
echo "Installing native better-sqlite3 for this architecture..."
cd ~/shh/app
npm install better-sqlite3 --no-save --no-audit --no-fund 2>&1 | tail -5

NATIVE_BIN=~/shh/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node
if [ ! -f "$NATIVE_BIN" ]; then
    echo "ERROR: native better-sqlite3 binary not found at $NATIVE_BIN"
    exit 1
fi

echo "Replacing macOS binary in standalone bundle..."
REPLACED=0
for bsq_dir in ~/shh/app/.next/node_modules/better-sqlite3-*/; do
    if [ -d "$bsq_dir" ]; then
        BSQ_DEST="${bsq_dir}build/Release/better_sqlite3.node"
        # npm unpacks from its content-addressable cache using hardlinks, so
        # the standalone copy and node_modules copy can already be the SAME
        # inode. cp then fails with "are the same file" -- which under `set -e`
        # aborted the whole deploy before the service restart below, leaving
        # the old process running against new on-disk assets (broken CSS).
        # The binary is already correct in that case, so treat it as success.
        if [ "$NATIVE_BIN" -ef "$BSQ_DEST" ]; then
            echo "  -> ${bsq_dir} (already correct; shared inode)"
        else
            cp -f "$NATIVE_BIN" "$BSQ_DEST"
            echo "  -> ${bsq_dir}"
        fi
        REPLACED=$((REPLACED+1))
    fi
done
if [ "$REPLACED" -eq 0 ]; then
    echo "WARNING: no better-sqlite3-* dirs found under .next/node_modules"
fi

# Let nginx read static assets directly from disk for the /_next/static alias
# in nginx.conf. nginx (www-data) is a member of the deploy user's group (added
# in setup-pi.sh / the --update-nginx step below), so grant that group traverse
# on the home-dir chain and read on the asset tree. Assets are public anyway.
echo "Granting the deploy group read access to static assets..."
chmod g+x "$HOME" "$HOME/shh" "$HOME/shh/app" "$HOME/shh/app/.next" 2>/dev/null || true
chmod -R g+rX "$HOME/shh/app/.next/static" 2>/dev/null || true

echo "Deployment extracted successfully"
ENDSSH

rm -rf "$DEPLOY_TMP"
print_success "Upload complete"

# ─── Update nginx (optional) ────────────────────────────────────────────

if [ "$UPDATE_NGINX" = true ]; then
    print_status "Updating nginx config..."
    render_nginx_conf "$SCRIPT_DIR/conf/nginx.conf" | ssh "$PI_USER@$PI_HOST" 'cat > ~/shh-nginx.conf' 
    ssh "$PI_USER@$PI_HOST" << 'ENDSSH'
sudo mv ~/shh-nginx.conf /etc/nginx/sites-available/shh

# nginx (www-data) serves /_next/static straight from the deploy user's home
# via group permissions, so it must belong to that group. Adding a user to a
# group only takes effect for a NEW master process, so restart (not reload)
# nginx the one time membership changes; a reload is enough thereafter.
DEPLOY_GROUP=$(id -gn)
if id -nG www-data 2>/dev/null | tr ' ' '\n' | grep -qx "$DEPLOY_GROUP"; then
    NEED_RESTART=0
else
    sudo usermod -aG "$DEPLOY_GROUP" www-data
    echo "Added www-data to '$DEPLOY_GROUP' group"
    NEED_RESTART=1
fi

sudo nginx -t
if [ "$NEED_RESTART" = 1 ]; then
    sudo systemctl restart nginx
    echo "nginx restarted (picked up new group membership)"
else
    sudo systemctl reload nginx
fi
echo "nginx config updated"
ENDSSH
    print_success "nginx updated"
fi

# ─── Restart Service ─────────────────────────────────────────────────────

if [ "$RESTART_SERVICE" = true ]; then
    print_status "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    print_status "  Restarting Service"
    print_status "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    ssh "$PI_USER@$PI_HOST" << 'ENDSSH'
sudo systemctl restart shh
sleep 2

STATUS=$(systemctl is-active shh 2>/dev/null || true)
case "$STATUS" in
    active)   echo "  shh: ● running" ;;
    inactive) echo "  shh: ○ inactive" ;;
    failed)   echo "  shh: ✗ failed (check: sudo journalctl -u shh -n 20)" ;;
    *)        echo "  shh: - unknown ($STATUS)" ;;
esac

NGINX_STATUS=$(systemctl is-active nginx 2>/dev/null || true)
echo "  nginx: $NGINX_STATUS"
ENDSSH

    print_success "Service restarted"
fi

echo ""
print_status "═══════════════════════════════════════════════"
print_success "Deployment complete!"
print_status "═══════════════════════════════════════════════"
print_status "URL: https://$DOMAIN_NAME"
print_status "═══════════════════════════════════════════════"
echo ""
print_warning "Logs: ssh $PI_USER@$PI_HOST 'sudo journalctl -u shh -f'"
