#!/usr/bin/env bash
# Sets up (or updates) ConqChat on an Ubuntu EC2 server.
# Run from inside the cloned repo:   bash deploy/setup.sh
# To update later:                   git pull && bash deploy/setup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="$(whoami)"

echo "==> 1/5 Installing system packages (Python, nginx, PostgreSQL)"
sudo apt-get update -y
sudo apt-get install -y python3-venv python3-pip nginx postgresql openssl

echo "==> 2/5 Creating database and .env (first run only)"
if [ ! -f "$APP_DIR/.env" ]; then
    DB_PASSWORD="$(openssl rand -hex 16)"
    (cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER conqchat WITH PASSWORD '$DB_PASSWORD';")
    (cd /tmp && sudo -u postgres createdb -O conqchat private_chat)
    cat > "$APP_DIR/.env" <<EOF
SECRET_KEY=$(openssl rand -hex 32)
DATABASE_URL=postgresql+psycopg://conqchat:$DB_PASSWORD@localhost:5432/private_chat
COOKIE_SECURE=false
EOF
    chmod 600 "$APP_DIR/.env"   # only this user can read the secrets
else
    echo "    .env already exists, keeping it"
fi

echo "==> 3/5 Installing Python packages"
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip
"$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"

echo "==> 4/5 Starting the app as a systemd service"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__USER__|$APP_USER|g" "$APP_DIR/deploy/conqchat.service" \
    | sudo tee /etc/systemd/system/conqchat.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --quiet conqchat
sudo systemctl restart conqchat

echo "==> 5/5 Configuring nginx on port 80"
sudo cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/conqchat
sudo ln -sf /etc/nginx/sites-available/conqchat /etc/nginx/sites-enabled/conqchat
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "==> Checking the app responds through nginx"
for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1/health > /dev/null 2>&1; then
        echo "    OK! Open:  http://$(curl -s https://checkip.amazonaws.com)"
        exit 0
    fi
    sleep 1
done
echo "    App did not respond. See logs with:  sudo journalctl -u conqchat -n 50"
exit 1
