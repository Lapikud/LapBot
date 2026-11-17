#!/usr/bin/env -S python3 -u
import fcntl
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

root = Path(os.environ.get("LAPBOT_ROOT", "/opt/lapbot"))
service = os.environ.get("LAPBOT_SERVICE", "lapbot")
ready_timeout = int(os.environ.get("LAPBOT_READY_TIMEOUT", "90"))
keep_releases = 3


def main():
    os.chdir(root)
    lock = open(".deploy.lock", "w")
    fcntl.flock(lock, fcntl.LOCK_EX)

    if not Path(".env").is_file():
        sys.exit(f"env: {root}/.env is missing")

    update_code()
    commit = output("git", "-C", "repo", "rev-parse", "--short", "HEAD")
    release = Path("releases") / f"{datetime.now():%Y%m%d-%H%M%S}-{commit}"
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

        if live() != str(release):
            discard(release)

        sys.exit(1)

    prune()


def run(*command, cwd=None, stdin=None):
    subprocess.run(command, cwd=cwd, input=stdin, check=True)


def output(*command):
    result = subprocess.run(command, check=True, capture_output=True, text=True)

    return result.stdout.strip()


def live():
    current = Path("current")

    return os.readlink(current) if current.is_symlink() else None


def update_code():
    run("git", "-C", "repo", "fetch", "--quiet", "origin", "main")
    run("git", "-C", "repo", "reset", "--quiet", "--hard", "origin/main")
    print(f"code: at {output('git', '-C', 'repo', 'log', '-1', '--format=%h %s')}")


def build(release):
    release.mkdir(parents=True)
    Path("logs").mkdir(exist_ok=True)
    archive = subprocess.run(
        ["git", "-C", "repo", "archive", "HEAD"], check=True, capture_output=True
    ).stdout
    run("tar", "-x", "-C", str(release), stdin=archive)
    (release / ".env").symlink_to(root / ".env")
    (release / "logs").symlink_to(root / "logs")
    run("pnpm", "install", "--frozen-lockfile", cwd=release)
    run("pnpm", "build", cwd=release)
    print(f"build: {release}")


def switch_to(release):
    staged = Path("current.next")
    staged.unlink(missing_ok=True)
    staged.symlink_to(release)
    os.replace(staged, "current")
    print(f"release: current is {release}")


def restart():
    started = datetime.now()
    Path(".restart").write_text(f"{live()}\n")
    print(f"service: requested a restart of {service}")

    return started


def ready(started):
    since = f"{started:%Y-%m-%d %H:%M:%S}"
    journal = ["journalctl", "-u", service, "--since", since, "--no-pager"]

    for _ in range(ready_timeout):
        logs = subprocess.run(
            [*journal, "-o", "cat"], capture_output=True, text=True
        ).stdout

        if '"msg":"Ready"' in logs:
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
    current = live()
    releases = sorted(
        (path for path in Path("releases").iterdir() if path.is_dir()), reverse=True
    )

    for old in releases[keep_releases:]:
        if str(old) != current:
            shutil.rmtree(old)
            print(f"prune: removed {old}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(f"failed: {' '.join(map(str, error.cmd))}")
