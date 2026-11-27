#!/usr/bin/env -S python3 -u
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from fcntl import LOCK_EX, flock
from pathlib import Path

root_dir = Path(os.environ.get("LAPBOT_ROOT", "/opt/lapbot"))
service = os.environ.get("LAPBOT_SERVICE", "lapbot")
ready_timeout = int(os.environ.get("LAPBOT_READY_TIMEOUT", "90"))
keep_releases = 3

env_file = root_dir / ".env"
lock_file = root_dir / ".deploy.lock"
restart_file = root_dir / ".restart"
repo_dir = root_dir / "repo"
releases_dir = root_dir / "releases"
current_link = root_dir / "current"
logs_dir = root_dir / "logs"


def main():
    if not root_dir.is_dir():
        sys.exit(f"root: {root_dir} does not exist")

    with lock_file.open("w") as lock:
        flock(lock, LOCK_EX)

        if not env_file.is_file():
            sys.exit(f"env: {env_file} is missing\nCheck .env.example")

        update_code()
        commit = git("rev-parse", "--short", "HEAD")
        release = releases_dir / f"{datetime.now():%Y%m%d-%H%M%S}-{commit}"
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
        ["git", "-C", str(repo_dir), *args], check=True, capture_output=True, text=True
    )

    return result.stdout.strip()


def remote():
    configured = os.environ.get("LAPBOT_REMOTE")

    if configured:
        return configured

    own = subprocess.run(
        ["git", "-C", str(Path(__file__).parent), "remote", "get-url", "origin"],
        capture_output=True,
        text=True,
    ).stdout.strip()

    if not own:
        sys.exit(f"repo: {repo_dir} is missing and LAPBOT_REMOTE is not set")

    return own


def live():
    return Path(os.readlink(current_link)) if current_link.is_symlink() else None


def update_code():
    if not (repo_dir / ".git").is_dir():
        run("git", "clone", remote(), str(repo_dir))
        print(f"code: cloned into {repo_dir}")

    git("fetch", "origin", "main")
    git("reset", "--hard", "origin/main")
    print(f"code: at {git('log', '-1', '--format=%h %s')}")


one_cpu = ("nice", "-n", "10", "taskset", "-c", str(min(os.sched_getaffinity(0))))


def build(release):
    release.mkdir(parents=True)
    logs_dir.mkdir(exist_ok=True)
    archive = subprocess.run(
        ["git", "-C", str(repo_dir), "archive", "HEAD"], check=True, capture_output=True
    ).stdout
    run("tar", "-x", "-C", str(release), stdin=archive)
    (release / ".env").symlink_to(env_file)
    (release / "logs").symlink_to(logs_dir)
    run(*one_cpu, "pnpm", "install", "--frozen-lockfile", cwd=release)
    run(*one_cpu, "pnpm", "build", cwd=release)
    print(f"build: {release}")


def switch_to(release):
    staged = root_dir / "current.next"
    staged.unlink(missing_ok=True)
    staged.symlink_to(release)
    staged.replace(current_link)
    print(f"release: current_link is {release}")


def restart():
    started = (datetime.now(), service_state().get("InvocationID", ""))
    restart_file.write_text(f"{live()}\n")
    print(f"service: requested a restart of {service}")

    return started


def service_state():
    result = subprocess.run(
        ["systemctl", "show", service, "--property=InvocationID,ActiveState"],
        capture_output=True, text=True, check=True,
    )
    return {
        key: value
        for key, sep, value in (line.partition("=") for line in result.stdout.splitlines())
        if sep
    }


def ready(started):
    requested, previous_invocation = started
    journal = ["journalctl", "-u", service, "--since",
               f"{requested:%Y-%m-%d %H:%M:%S}", "--no-pager"]
    observed_new = False

    for _ in range(ready_timeout):
        state = service_state()
        invocation = state.get("InvocationID", "")
        if invocation and invocation != previous_invocation:
            observed_new = True
            entries = subprocess.run(
                [*journal, f"_SYSTEMD_INVOCATION_ID={invocation}", "-o", "cat"],
                capture_output=True, text=True,
            )
            if state.get("ActiveState") == "active" and entries.returncode == 0 and '"msg":"Ready"' in entries.stdout:
                print(f"health: {service} is ready")
                return True

        if observed_new and state.get("ActiveState") in ("failed", "inactive"):
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
    if ready(restart()):
        print(f"rollback: verified {previous}", file=sys.stderr)
    else:
        print(f"rollback: FAILED to restore a healthy {previous}", file=sys.stderr)


def discard(release):
    shutil.rmtree(release, ignore_errors=True)
    print(f"release: discarded {release}", file=sys.stderr)


def prune():
    live_release = live()
    built = sorted((path for path in releases_dir.iterdir() if path.is_dir()), reverse=True)

    for old in built[keep_releases:]:
        if old != live_release:
            shutil.rmtree(old)
            print(f"prune: removed {old}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(f"failed: {' '.join(map(str, error.cmd))}")
