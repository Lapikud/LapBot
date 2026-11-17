#!/usr/bin/env bash
set -euo pipefail

main() {
  cd "$(dirname "$0")/../.."
  deploy_script="$PWD/scripts/deploy/deploy.py"

  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT

  make_stubs
  make_root

  test_missing_env_fails
  test_first_deploy
  test_keeps_three_releases
  test_failed_startup_rolls_back
  test_failed_build_changes_nothing

  echo "deploy tests: all passed"
}

make_stubs() {
  mkdir "$work/bin"
  stub pnpm 'echo "pnpm $*"; [[ "$1" != build || -z "${FAIL_BUILD:-}" ]]'
  stub systemctl '[[ -z "${FAIL_HEALTH:-}" ]]'
  stub journalctl '[[ -n "${FAIL_HEALTH:-}" ]] || echo '"'"'{"level":30,"msg":"Ready"}'"'"
}

stub() {
  printf '#!/usr/bin/env bash\n%s\n' "$2" > "$work/bin/$1"
  chmod +x "$work/bin/$1"
}

make_root() {
  local seed="$work/seed"
  mkdir "$seed"
  git archive HEAD | tar -x -C "$seed"
  git -C "$seed" init --quiet --initial-branch main
  git -C "$seed" add --all
  git -C "$seed" -c user.name=test -c user.email=test@example.invalid commit --quiet -m seed
  git clone --quiet --bare "$seed" "$work/origin.git"

  mkdir "$work/root"
}

deploy() {
  command sleep 1
  env PATH="$work/bin:$PATH" LAPBOT_ROOT="$work/root" LAPBOT_REMOTE="$work/origin.git" LAPBOT_READY_TIMEOUT=3 "$@" \
    python3 -u "$deploy_script" > "$work/out.log" 2>&1
}

test_missing_env_fails() {
  if deploy; then
    fail "deploy passed without a .env"
  fi

  [[ ! -e "$work/root/releases" ]] || fail "built a release without a .env"
  pass "missing .env fails"
}

test_first_deploy() {
  echo "A=1" > "$work/root/.env"
  deploy || fail "first deploy failed"

  [[ -d "$work/root/repo/.git" ]] || fail "repo was not cloned"
  [[ -f "$work/root/current/package.json" ]] || fail "current has no app"
  expect_equal "$(readlink "$work/root/current/.env")" "$work/root/.env" "release links .env"
  expect_equal "$(readlink "$work/root/current/logs")" "$work/root/logs" "release links logs"
  expect_equal "$(cat "$work/root/.restart")" "$(readlink "$work/root/current")" "restart requested"
  expect_equal "$(release_count)" "1" "releases after first deploy"
  pass "first deploy"
}

test_keeps_three_releases() {
  local _
  for _ in 1 2 3; do
    deploy || fail "deploy failed"
  done

  expect_equal "$(release_count)" "3" "releases after four deploys"
  expect_equal "$(readlink "$work/root/current")" "$(newest_release)" "current is newest"
  pass "keeps three releases"
}

test_failed_startup_rolls_back() {
  local before
  before=$(readlink "$work/root/current")

  if deploy FAIL_HEALTH=1; then
    fail "deploy passed although the bot never became ready"
  fi

  expect_equal "$(readlink "$work/root/current")" "$before" "current after rollback"
  expect_equal "$(release_count)" "3" "releases after rollback"
  expect_equal "$(cat "$work/root/.restart")" "$before" "restart requested for the previous release"
  grep -q "requested a restart" "$work/out.log" || fail "no restart requested"
  pass "failed startup rolls back"
}

test_failed_build_changes_nothing() {
  local before
  before=$(readlink "$work/root/current")
  rm -f "$work/root/.restart"

  if deploy FAIL_BUILD=1; then
    fail "deploy passed with a failing build"
  fi

  expect_equal "$(readlink "$work/root/current")" "$before" "current after failed build"
  expect_equal "$(release_count)" "3" "releases after failed build"
  [[ ! -e "$work/root/.restart" ]] || fail "restart requested after a failed build"
  pass "failed build changes nothing"
}

release_count() {
  find "$work/root/releases" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '
}

newest_release() {
  find "$work/root/releases" -mindepth 1 -maxdepth 1 -type d -printf '%p\n' | sort | tail -n 1
}

expect_equal() {
  if [[ "$1" != "$2" ]]; then
    fail "$3: expected '$2', got '$1'"
  fi
}

pass() {
  echo "ok: $1"
}

fail() {
  echo "not ok: $1" >&2
  echo "--- last deploy output" >&2
  cat "$work/out.log" >&2 || true
  exit 1
}

main "$@"
