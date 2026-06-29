#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${W7S_METAL_REPO_URL:-https://github.com/w7s-io/w7s-metal.git}"
REPO_REF="${W7S_METAL_REPO_REF:-main}"
APP_DIR="${W7S_METAL_APP_DIR:-/opt/w7s-metal}"
DATA_DIR="${W7S_METAL_DATA_DIR:-/var/lib/w7s-metal}"
ENV_FILE="${W7S_METAL_ENV_FILE:-/etc/w7s-metal/w7s-metal.env}"
SERVICE_USER="${W7S_METAL_USER:-w7s-metal}"
SERVICE_GROUP="${W7S_METAL_GROUP:-w7s-metal}"
HOST="${W7S_METAL_HOST:-127.0.0.1}"
PORT="${W7S_METAL_PORT:-8787}"
BASE_DOMAIN="${W7S_METAL_BASE_DOMAIN:-}"
PUBLIC_URL="${W7S_METAL_PUBLIC_URL:-}"
APP_PROTOCOL="${W7S_METAL_APP_PROTOCOL:-http}"
DEPLOY_TOKEN="${W7S_METAL_DEPLOY_TOKEN:-}"
INSTALL_CADDY="${W7S_METAL_INSTALL_CADDY:-true}"
DEPLOY_HOST="${W7S_METAL_DEPLOY_HOST:-}"
NODE_MAJOR="${W7S_METAL_NODE_MAJOR:-22}"
COMMIT_HASH=""
DEPLOYED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

log() {
  printf '\033[1;34m==>\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2
}

fail() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "setup.sh must be run as root. Try: sudo bash setup.sh"
  fi
}

detect_os() {
  if [ ! -r /etc/os-release ]; then
    fail "Cannot detect OS. This installer supports Ubuntu/Debian-style systems."
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *)
      case "${ID_LIKE:-}" in
        *debian*) ;;
        *) fail "Unsupported OS '${ID:-unknown}'. Use Ubuntu or Debian for the MVP installer." ;;
      esac
      ;;
  esac
}

require_config() {
  if [ -z "$BASE_DOMAIN" ]; then
    fail "Set W7S_METAL_BASE_DOMAIN, for example: W7S_METAL_BASE_DOMAIN=example.com bash setup.sh"
  fi
  if [ -z "$DEPLOY_HOST" ]; then
    DEPLOY_HOST="deploy.${BASE_DOMAIN}"
  fi
  if [ -z "$PUBLIC_URL" ]; then
    PUBLIC_URL="https://${DEPLOY_HOST}"
  fi
}

install_packages() {
  log "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg git openssl rsync
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local current_major
    current_major="$(node -p "Number(process.versions.node.split('.')[0])")"
    if [ "$current_major" -ge 20 ]; then
      log "Node $(node --version) already installed"
      return
    fi
    warn "Existing Node $(node --version) is older than 20; installing Node ${NODE_MAJOR}"
  fi

  log "Installing Node.js ${NODE_MAJOR}"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
}

install_caddy() {
  if [ "$INSTALL_CADDY" != "true" ]; then
    log "Skipping Caddy install because W7S_METAL_INSTALL_CADDY=${INSTALL_CADDY}"
    return
  fi

  if command -v caddy >/dev/null 2>&1; then
    log "Caddy already installed"
    return
  fi

  log "Installing Caddy"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/caddy-stable-archive-keyring.gpg
  chmod 0644 /etc/apt/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
}

create_user_and_dirs() {
  log "Creating service user and directories"
  if ! getent group "$SERVICE_GROUP" >/dev/null; then
    groupadd --system "$SERVICE_GROUP"
  fi
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --gid "$SERVICE_GROUP" --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi

  install -d -m 0755 /etc/w7s-metal
  install -d -m 0755 "$APP_DIR"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$DATA_DIR"
}

checkout_repo() {
  log "Checking out ${REPO_URL}#${REPO_REF}"
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch --prune origin
    git -C "$APP_DIR" checkout "$REPO_REF"
    git -C "$APP_DIR" pull --ff-only origin "$REPO_REF"
  else
    rm -rf "$APP_DIR"
    git clone --branch "$REPO_REF" "$REPO_URL" "$APP_DIR"
  fi
  COMMIT_HASH="$(git -C "$APP_DIR" rev-parse HEAD)"
}

build_app() {
  log "Installing npm dependencies and building"
  npm --prefix "$APP_DIR" ci
  npm --prefix "$APP_DIR" run build
  chown -R root:root "$APP_DIR"
}

ensure_deploy_token() {
  if [ -n "$DEPLOY_TOKEN" ]; then
    return
  fi
  if [ -r "$ENV_FILE" ]; then
    DEPLOY_TOKEN="$(grep -E '^W7S_METAL_DEPLOY_TOKEN=' "$ENV_FILE" | sed 's/^W7S_METAL_DEPLOY_TOKEN=//' | tr -d '\"' || true)"
  fi
  if [ -n "$DEPLOY_TOKEN" ]; then
    return
  fi
  DEPLOY_TOKEN="$(openssl rand -hex 32)"
}

write_env_file() {
  log "Writing ${ENV_FILE}"
  ensure_deploy_token
  umask 077
  cat > "$ENV_FILE" <<EOF
W7S_METAL_BASE_DOMAIN="${BASE_DOMAIN}"
W7S_METAL_PUBLIC_URL="${PUBLIC_URL}"
W7S_METAL_APP_PROTOCOL="${APP_PROTOCOL}"
W7S_METAL_DATA_DIR="${DATA_DIR}"
W7S_METAL_HOST="${HOST}"
W7S_METAL_PORT="${PORT}"
W7S_METAL_DEPLOY_TOKEN="${DEPLOY_TOKEN}"
W7S_METAL_BRANCH="${REPO_REF}"
W7S_METAL_COMMIT_HASH="${COMMIT_HASH}"
W7S_METAL_DEPLOYED_AT="${DEPLOYED_AT}"
EOF
  chown root:"$SERVICE_GROUP" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
}

write_systemd_service() {
  log "Installing systemd service"
  cat > /etc/systemd/system/w7s-metal.service <<EOF
[Unit]
Description=W7S Metal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_DIR}/dist/src/cli.js serve
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now w7s-metal.service
}

write_caddyfile() {
  if [ "$INSTALL_CADDY" != "true" ]; then
    return
  fi

  log "Writing Caddy reverse proxy"
  cat > /etc/caddy/Caddyfile <<EOF
{
  email ${W7S_METAL_ACME_EMAIL:-admin@${BASE_DOMAIN}}
}

${DEPLOY_HOST} {
  reverse_proxy 127.0.0.1:${PORT}
}

http://*.${BASE_DOMAIN} {
  reverse_proxy 127.0.0.1:${PORT}
}
EOF
  systemctl enable --now caddy
  systemctl reload caddy
}

print_summary() {
  log "W7S Metal is installed"
  cat <<EOF

Service:
  systemctl status w7s-metal --no-pager
  journalctl -u w7s-metal -f

Health:
  curl -fsS http://127.0.0.1:${PORT}/health
  curl -fsS ${PUBLIC_URL}/health

DNS to configure:
  ${DEPLOY_HOST}        A/AAAA -> this server
  *.${BASE_DOMAIN}      A/AAAA -> this server

Routing:
  Deploy endpoint uses HTTPS through ${DEPLOY_HOST}.
  Wildcard app hosts are routed over HTTP in this MVP setup.
  HTTPS wildcard app hosts need a Caddy DNS challenge plugin or a custom reverse proxy configuration.

GitHub Action:
  - uses: w7s-io/w7s-cloud@v1
    with:
      deploy-url: ${PUBLIC_URL}/api/v1/deploy
      token: \${{ secrets.W7S_METAL_DEPLOY_TOKEN }}

Store this token as GitHub secret W7S_METAL_DEPLOY_TOKEN:
  ${DEPLOY_TOKEN}

EOF
}

main() {
  require_root
  detect_os
  require_config
  install_packages
  install_node
  install_caddy
  create_user_and_dirs
  checkout_repo
  build_app
  write_env_file
  write_systemd_service
  write_caddyfile
  print_summary
}

main "$@"
