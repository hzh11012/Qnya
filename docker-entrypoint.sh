#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
node dist/db/migrate.js

echo "[entrypoint] Starting Qnya..."
exec supervisord -c /etc/supervisord.conf
