#!/bin/sh
# Starts or updates OpenShop in this directory. Run it after editing .env; CD runs it too.
# OPENSHOP_IMAGE in the environment (or .env) picks the image; COMPOSE_FILE in .env picks the layout.
set -eu
cd "$(dirname "$0")"
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }

domain=$(env_value OPENSHOP_DOMAIN)
[ -n "$domain" ] || { echo "set OPENSHOP_DOMAIN in .env" >&2; exit 1; }
mkdir -p backups
layout=$(env_value COMPOSE_FILE)

case "$layout" in
  *docker-compose.edge.yml*)
    edge=/opt/edge
    [ -x "$edge/up.sh" ] || { echo "no edge Caddy in $edge: set it up from the hive repo (deploy/edge), see docs/deploy.md" >&2; exit 1; }
    docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null ;;
  *) edge="" ;;
esac

case "$layout" in
  *docker-compose.build.yml*) docker compose up -d --build --remove-orphans ;;
  *)
    # A failed pull (e.g. a private package without docker login) falls back to the local image.
    docker compose pull --quiet app || echo "pull failed; starting the image already on this machine" >&2
    docker compose up -d --remove-orphans ;;
esac

if [ -n "$edge" ]; then
  mkdir -p "$edge/sites"
  sed "s|__DOMAIN__|$domain|g" site.caddy > "$edge/sites/openshop.caddy"
  "$edge/up.sh"
fi
echo "openshop: https://$domain"
