"""Health checks must observe the restarted invocation, including rollback."""
import importlib.util
import unittest
import tempfile
from subprocess import CalledProcessError
from datetime import datetime
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'deploy', Path(__file__).parents[1] / 'deploy' / 'deploy.py'
)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class HealthTests(unittest.TestCase):
    def check_states(self, states, ready=True):
        journal = CompletedProcess([], 0, stdout='{"msg":"Ready"}' if ready else '')
        with patch.object(deploy, 'ready_timeout', len(states)), \
             patch.object(deploy, 'service_state', side_effect=states), \
             patch.object(deploy.time, 'sleep'), \
             patch.object(deploy.subprocess, 'run', return_value=journal) as run:
            result = deploy.ready((datetime.now(), 'old'))
        return result, run

    def test_slow_shutdown_then_new_ready(self):
        result, run = self.check_states([
            {'InvocationID': 'old', 'ActiveState': 'deactivating'},
            {'InvocationID': '', 'ActiveState': 'inactive'},
            {'InvocationID': 'new', 'ActiveState': 'active'},
        ])
        self.assertTrue(result)
        self.assertIn('_SYSTEMD_INVOCATION_ID=new', run.call_args.args[0])

    def test_outgoing_readiness_is_ignored(self):
        result, _ = self.check_states([
            {'InvocationID': 'old', 'ActiveState': 'active'},
        ])
        self.assertFalse(result)

    def test_new_invocation_must_be_ready(self):
        result, _ = self.check_states([
            {'InvocationID': 'new', 'ActiveState': 'active'},
        ], ready=False)
        self.assertFalse(result)

    def test_failed_new_invocation(self):
        result, _ = self.check_states([
            {'InvocationID': 'new', 'ActiveState': 'failed'},
        ])
        self.assertFalse(result)

    def test_rollback_checks_health(self):
        with patch.object(deploy, 'switch_to') as switch, \
             patch.object(deploy, 'restart', return_value='request'), \
             patch.object(deploy, 'ready', return_value=True) as ready:
            deploy.roll_back(Path('/previous'))
        switch.assert_called_once_with(Path('/previous'))
        ready.assert_called_once_with('request')

    def test_failed_rollback_is_reported(self):
        with patch.object(deploy, 'switch_to'), \
             patch.object(deploy, 'restart'), \
             patch.object(deploy, 'ready', return_value=False), \
             patch('builtins.print') as output:
            deploy.roll_back(Path('/previous'))
        self.assertTrue(any('FAILED' in str(call) for call in output.call_args_list))


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name, value in {
            'root_dir': self.root,
            'env_file': self.root / '.env',
            'lock_file': self.root / '.deploy.lock',
            'restart_file': self.root / '.restart',
            'repo_dir': self.root / 'repo',
            'releases_dir': self.root / 'releases',
            'current_link': self.root / 'current',
            'logs_dir': self.root / 'logs',
        }.items():
            patcher = patch.object(deploy, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.env = self.root / '.env'
        self.env.write_text('A=1\n')
        self.releases = self.root / 'releases'
        self.previous = self.releases / '0000-previous'

    def build(self, release):
        release.mkdir(parents=True)
        (release / '.env').symlink_to(self.env)
        (release / 'logs').symlink_to(self.root / 'logs')
        (release / 'package.json').write_text('{}')

    def seed_previous(self):
        self.previous.mkdir(parents=True)
        deploy.switch_to(self.previous)

    def run_deploy(self, health=True, build=None):
        # Exercise real filesystem switching, restart requests, cleanup and pruning.
        # External fetching, package installation and systemd are boundary mocks.
        with patch.object(deploy, 'update_code'), \
             patch.object(deploy, 'git', return_value='test-commit'), \
             patch.object(deploy, 'build', side_effect=build or self.build), \
             patch.object(deploy, 'service_state', return_value={}), \
             patch.object(deploy, 'ready', side_effect=health if isinstance(health, list) else None,
                          return_value=health) as ready:
            deploy.main()
        return ready

    def test_missing_env_fails_before_build(self):
        self.env.unlink()
        with self.assertRaises(SystemExit):
            self.run_deploy()
        self.assertFalse(self.releases.exists())

    def test_first_deploy_links_and_requests_restart(self):
        self.run_deploy()
        current = deploy.live()
        self.assertTrue((current / 'package.json').is_file())
        self.assertEqual((current / '.env').readlink(), self.env)
        self.assertEqual((current / 'logs').readlink(), self.root / 'logs')
        self.assertEqual(deploy.restart_file.read_text().strip(), str(current))
        self.assertEqual(len(list(self.releases.iterdir())), 1)

    def test_prunes_to_three_releases(self):
        self.releases.mkdir()
        for number in range(5):
            (self.releases / f'000{number}-old').mkdir()
        self.run_deploy()
        self.assertEqual(len(list(self.releases.iterdir())), 3)
        self.assertTrue(deploy.live().is_dir())

    def test_failed_startup_rolls_back_and_verifies(self):
        self.seed_previous()
        with self.assertRaises(SystemExit):
            self.run_deploy(health=[False, True])
        self.assertEqual(deploy.live(), self.previous)
        self.assertEqual(list(self.releases.iterdir()), [self.previous])
        self.assertEqual(deploy.restart_file.read_text().strip(), str(self.previous))

    def test_failed_build_preserves_current_without_restart(self):
        self.seed_previous()

        def fail(release):
            self.build(release)
            raise CalledProcessError(1, ['pnpm', 'build'])

        with self.assertRaises(CalledProcessError):
            self.run_deploy(build=fail)
        self.assertEqual(deploy.live(), self.previous)
        self.assertEqual(list(self.releases.iterdir()), [self.previous])
        self.assertFalse(deploy.restart_file.exists())


if __name__ == '__main__':
    unittest.main()
