#!/bin/sh
# Runs inside the `backup` compose service (postgres image, so pg_dump matches the server).
# Once a day at BACKUP_HOUR_UTC (default 19:00 UTC = 03:00 Beijing) it writes
#   /backups/openshop-<UTC time>.dump     database, pg_dump custom format (restore with pg_restore)
#   /backups/uploads-<UTC time>.tar.gz    uploaded images
# and deletes backups older than BACKUP_KEEP_DAYS. /backups is ./backups on the host; copying
# it off the machine (e.g. ossutil sync to an OSS bucket from host cron) is in docs/deploy.md.
# `docker compose run --rm backup now` takes one backup immediately and exits.
set -eu

keep_days="${BACKUP_KEEP_DAYS:-14}"
hour="${BACKUP_HOUR_UTC:-19}"

backup() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  pg_dump --format=custom --file="/backups/openshop-$stamp.dump.partial"
  mv "/backups/openshop-$stamp.dump.partial" "/backups/openshop-$stamp.dump"
  if [ -d /uploads ]; then
    tar -czf "/backups/uploads-$stamp.tar.gz.partial" -C /uploads .
    mv "/backups/uploads-$stamp.tar.gz.partial" "/backups/uploads-$stamp.tar.gz"
  fi
  find /backups -name 'openshop-*.dump' -mtime +"$keep_days" -delete
  find /backups -name 'uploads-*.tar.gz' -mtime +"$keep_days" -delete
  echo "backup $stamp done"
}

if [ "${1:-}" = "now" ]; then
  backup
  exit 0
fi

while true; do
  # Sleep until the next BACKUP_HOUR_UTC:00.
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) $hour:00:00" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  backup || echo "backup failed" >&2
done
