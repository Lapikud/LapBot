#!/usr/bin/env bash
set -euo pipefail

root="${LAPBOT_ROOT:-/opt/lapbot}"
service="${LAPBOT_SERVICE:-lapbot}"
ready_timeout="${LAPBOT_READY_TIMEOUT:-90}"
keep_releases=3
release=""

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

main() {
  cd "$root"

  lock
  require_env
  update_code

  local previous
  release="releases/$(date +%Y%m%d-%H%M%S)-$(git -C repo rev-parse --short HEAD)"
  previous=$(readlink current || true)
  trap discard_failed_release EXIT

  build_release "$release"
  switch_to "$release"
  restart_service

  if ! wait_for_ready; then
    roll_back "$previous"
    exit 1
  fi

  prune_releases
}

lock() {
  exec 9> .deploy.lock
  flock 9
}

require_env() {
  if [[ ! -f .env ]]; then
    echo "env: $root/.env is missing" >&2
    exit 1
  fi
}

update_code() {
  git -C repo fetch --quiet origin main
  git -C repo reset --quiet --hard origin/main

  echo "code: at $(git -C repo log -1 --format='%h %s')"
}

build_release() {
  local release="$1"

  mkdir -p "$release" logs
  git -C repo archive HEAD | tar -x -C "$release"
  ln -s "$root/.env" "$release/.env"
  ln -s "$root/logs" "$release/logs"

  (
    cd "$release"
    pnpm install --frozen-lockfile
    pnpm build
  )

  echo "build: $release"
}

switch_to() {
  local release="$1"

  ln -sfn "$release" current.next
  mv -Tf current.next current

  echo "release: current is $release"
}

restart_service() {
  started=$(date '+%Y-%m-%d %H:%M:%S')
  readlink current > .restart
  echo "service: requested a restart of $service"
}

wait_for_ready() {
  for _ in $(seq "$ready_timeout"); do
    if journalctl -u "$service" --since "$started" -o cat --no-pager | grep -q '"msg":"Ready"'; then
      echo "health: $service is ready"
      return
    fi

    if ! systemctl is-active --quiet "$service"; then
      break
    fi

    sleep 1
  done

  echo "health: $service did not become ready" >&2
  journalctl -u "$service" --since "$started" -n 50 --no-pager >&2 || true
  return 1
}

roll_back() {
  local previous="$1"

  if [[ -z "$previous" ]]; then
    echo "rollback: no previous release" >&2
    return
  fi

  switch_to "$previous"
  restart_service
  echo "rollback: back on $previous" >&2
}

discard_failed_release() {
  local status=$?

  if ((status != 0)) && [[ -n "$release" && "$(readlink current || true)" != "$release" ]]; then
    rm -rf "$release"
    echo "release: discarded $release" >&2
  fi
}

prune_releases() {
  local live old
  live=$(readlink current)

  find releases -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +$((keep_releases + 1)) |
    while read -r old; do
      if [[ "$old" != "$live" ]]; then
        rm -rf "$old"
        echo "prune: removed $old"
      fi
    done
}

main "$@"; exit
