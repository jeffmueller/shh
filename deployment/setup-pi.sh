#!/bin/bash

# shh - One-time Raspberry Pi Setup
# Creates systemd service and nginx config on the Pi.
# Handles SSL cert provisioning automatically.
# Prerequisites: nginx, Node.js, and certbot already installed.

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
APP_PORT=3011

require_config

print_status "═══════════════════════════════════════════════"
print_status "  shh - Raspberry Pi Setup"
print_status "═══════════════════════════════════════════════"
print_status "Target: $PI_USER@$PI_HOST"
print_status "Domain: $DOMAIN_NAME"
print_status "App port: $APP_PORT"
print_status "═══════════════════════════════════════════════"
echo ""

print_warning "This will create a systemd service, nginx config, and SSL cert on the Pi."
read -p "Continue? (y/N): " confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

print_status "Uploading nginx configs..."
render_nginx_conf "$SCRIPT_DIR/conf/nginx-pre-ssl.conf" | ssh "$PI_USER@$PI_HOST" 'cat > ~/shh-nginx-pre-ssl.conf'
render_nginx_conf "$SCRIPT_DIR/conf/nginx.conf"         | ssh "$PI_USER@$PI_HOST" 'cat > ~/shh-nginx-full.conf' 

ssh "$PI_USER@$PI_HOST" "bash -s" << ENDSSH
set -e

echo "Creating directory structure..."
mkdir -p ~/shh/app
mkdir -p ~/shh/app/public
mkdir -p ~/shh/app/.next/static
mkdir -p ~/shh/app/data

# ─── Create systemd service ─────────────────────────────────────────────

echo "Creating shh systemd service..."
sudo tee /etc/systemd/system/shh.service > /dev/null << 'EOF'
[Unit]
Description=shh - Self-destructing Secret Sharing
After=network.target

[Service]
Type=simple
User=$PI_USER
WorkingDirectory=/home/$PI_USER/shh/app
EnvironmentFile=-/home/$PI_USER/shh/.env
Environment=NODE_ENV=production
Environment=PORT=$APP_PORT
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/$PI_USER/shh/app/data

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable shh

# nginx (www-data) serves /_next/static straight from the deploy user's home
# directory via group permissions, so it must belong to that user's group.
echo "Adding www-data to the $PI_USER group (static asset access)..."
sudo usermod -aG $PI_USER www-data

# ─── Step 1: Install HTTP-only nginx config (for certbot) ───────────────

echo ""
echo "Installing HTTP-only nginx config (for certbot)..."
sudo mv ~/shh-nginx-pre-ssl.conf /etc/nginx/sites-available/shh

if [ ! -L /etc/nginx/sites-enabled/shh ]; then
    sudo ln -s /etc/nginx/sites-available/shh /etc/nginx/sites-enabled/shh
fi

sudo nginx -t
sudo systemctl reload nginx
echo "HTTP-only config active."

# ─── Step 2: Get SSL certificate ────────────────────────────────────────

echo ""
echo "Requesting SSL certificate from Let's Encrypt..."
if [ -f /etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem ]; then
    echo "SSL cert already exists, skipping certbot."
else
    sudo certbot certonly --nginx -d $DOMAIN_NAME --non-interactive --agree-tos --register-unsafely-without-email
    echo "SSL certificate obtained."
fi

# ─── Step 3: Install full HTTPS nginx config ────────────────────────────

echo ""
echo "Installing full HTTPS nginx config..."
sudo mv ~/shh-nginx-full.conf /etc/nginx/sites-available/shh

sudo nginx -t
# restart (not reload) so nginx's master process picks up www-data's new
# group membership added above.
sudo systemctl restart nginx

echo ""
echo "═══════════════════════════════════════════════"
echo "  Setup complete!"
echo "═══════════════════════════════════════════════"
echo ""
echo "  Run deploy.sh to deploy the app."
echo ""
ENDSSH

print_success "Pi setup complete!"
print_status "Run ./deploy.sh to deploy the app."
