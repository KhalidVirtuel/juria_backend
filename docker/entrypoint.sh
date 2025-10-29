#!/usr/bin/env sh
set -e

# Prisma client (idempotent)
npx prisma generate 1>/dev/null

# Option A: pousser le schéma direct (sans migrations)
npx prisma db push 1>/dev/null || true

# Option B (si tu utilises des migrations) :
# npx prisma migrate deploy 1>/dev/null || true

exec npm run start
