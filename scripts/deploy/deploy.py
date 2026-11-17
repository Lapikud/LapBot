#!/usr/bin/env -S python3 -u
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from fcntl import LOCK_EX, flock
from pathlib import Path

root = Path(os.environ.get("LAPBOT_ROOT", "/opt/lapbot"))
service = os.environ.get("LAPBOT_SERVICE", "lapbot")
ready_timeout = int(os.environ.get("LAPBOT_READY_TIMEOUT", "90"))
keep_releases = 3

env_file = root / ".env"
lock_file = root / ".deploy.lock"
restart_file = root / ".restart"
repo = root / "repo"
releases = root / "releases"
current = root / "current"
logs = root / "logs"


def main():
    lock = lock_file.open("w")
    flock(lock, LOCK_EX)

    if not env_file.is_file():
        sys.exit(f"env: {env_file} is missing\nCheck .env.example")

    update_code()
    commit = git("rev-parse", "--short", "HEAD")
    release = releases / f"{datetime.now():%Y%m%d-%H%M%S}-{commit}"
    previous = live()

    try:
        build(release)
    except BaseException:
        discard(release)
        raise

    switch_to(release)
    started = restart()

    if not ready(started):
        roll_back(previous)

        if live() != release:
            discard(release)

        sys.exit(1)

    prune()


def run(*command, cwd=None, stdin=None):
    subprocess.run(command, cwd=cwd, input=stdin, check=True)


def git(*args):
    result = subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    )

    return result.stdout.strip()


def live():
    return Path(os.readlink(current)) if current.is_symlink() else None


def update_code():
    git("fetch", "--quiet", "origin", "main")
    git("reset", "--quiet", "--hard", "origin/main")
    print(f"code: at {git('log', '-1', '--format=%h %s')}")


def build(release):
    release.mkdir(parents=True)
    logs.mkdir(exist_ok=True)
    archive = subprocess.run(
        ["git", "-C", str(repo), "archive", "HEAD"], check=True, capture_output=True
    ).stdout
    run("tar", "-x", "-C", str(release), stdin=archive)
    (release / ".env").symlink_to(env_file)
    (release / "logs").symlink_to(logs)
    run("pnpm", "install", "--frozen-lockfile", cwd=release)
    run("pnpm", "build", cwd=release)
    print(f"build: {release}")


def switch_to(release):
    staged = root / "current.next"
    staged.unlink(missing_ok=True)
    staged.symlink_to(release)
    staged.replace(current)
    print(f"release: current is {release}")


def restart():
    started = datetime.now()
    restart_file.write_text(f"{live()}\n")
    print(f"service: requested a restart of {service}")

    return started


def ready(started):
    since = f"{started:%Y-%m-%d %H:%M:%S}"
    journal = ["journalctl", "-u", service, "--since", since, "--no-pager"]

    for _ in range(ready_timeout):
        entries = subprocess.run(
            [*journal, "-o", "cat"], capture_output=True, text=True
        ).stdout

        if '"msg":"Ready"' in entries:
            print(f"health: {service} is ready")

            return True

        if subprocess.run(["systemctl", "is-active", "--quiet", service]).returncode:
            break

        time.sleep(1)

    print(f"health: {service} did not become ready", file=sys.stderr)
    subprocess.run([*journal, "-n", "50"], stdout=sys.stderr)

    return False


def roll_back(previous):
    if previous is None:
        print("rollback: no previous release", file=sys.stderr)

        return

    switch_to(previous)
    restart()
    print(f"rollback: back on {previous}", file=sys.stderr)


def discard(release):
    shutil.rmtree(release, ignore_errors=True)
    print(f"release: discarded {release}", file=sys.stderr)


def prune():
    live_release = live()
    built = sorted((path for path in releases.iterdir() if path.is_dir()), reverse=True)

    for old in built[keep_releases:]:
        if old != live_release:
            shutil.rmtree(old)
            print(f"prune: removed {old}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(f"failed: {' '.join(map(str, error.cmd))}")
