#!/bin/sh
set -e
npx prisma migrate deploy
node dist/seed.js
node dist/index.js
