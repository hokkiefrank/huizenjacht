#!/bin/sh
# Nightly database dump, keeps the last 14. Installed as a cron job by the deploy user.
set -eu
cd /opt/huizen
mkdir -p backups
docker compose exec -T db pg_dump -U huizen huizen | gzip > "backups/huizen-$(date +%F).sql.gz"
ls -1t backups/huizen-*.sql.gz | tail -n +15 | xargs -r rm --
