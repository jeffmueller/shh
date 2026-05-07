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
PI_HOST=${PI_HOST:-"192.0.2.10"}
DOMAIN_NAME=${DOMAIN_NAME:-"shh.example.com"}
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

# Rebuild native modules for Pi architecture (better-sqlite3, bcryptjs is pure JS)
echo "Rebuilding native modules for this architecture..."
cd ~/shh/app
npm rebuild better-sqlite3 2>&1 || echo "Warning: better-sqlite3 rebuild failed"

# Copy rebuilt binary into the standalone server's hashed copy if present
for bsq_dir in ~/shh/app/.next/node_modules/better-sqlite3-*/; do
    if [ -d "$bsq_dir" ]; then
        echo "Copying rebuilt binary to standalone: $bsq_dir"
        cp ~/shh/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node \
           "${bsq_dir}build/Release/better_sqlite3.node" 2>/dev/null || true
    fi
done

echo "Deployment extracted successfully"
ENDSSH

rm -rf "$DEPLOY_TMP"
print_success "Upload complete"

# ─── Update nginx (optional) ────────────────────────────────────────────

if [ "$UPDATE_NGINX" = true ]; then
    print_status "Updating nginx config..."
    scp -q "$SCRIPT_DIR/conf/nginx.conf" "$PI_USER@$PI_HOST":~/shh-nginx.conf
    ssh "$PI_USER@$PI_HOST" << 'ENDSSH'
sudo mv ~/shh-nginx.conf /etc/nginx/sites-available/shh
sudo nginx -t && sudo systemctl reload nginx
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
