#!/bin/sh
# Prepare the database, then start whatever CMD was given (the API by default).
#   empty database -> schema (+ demo data only when SEED_DEMO_DATA=true)
#   existing one   -> pending migrations
set -e
node scripts/db.mjs init
exec "$@"
