import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class MirrorPrePushTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cf-guard-mirror-')
        self.repo = Path(self.temp.name)
        self.guard = Path(__file__).with_name('repo_maintenance_guard.py')
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.email', 't@example.com')
        self.git('config', 'user.name', 'T')
        self.upstream = self.commit('Crew redesign: original upstream history')
        self.git('update-ref', 'refs/remotes/upstream/main', self.upstream)
        self.fork = self.commit('feat: 新增 fork 功能')

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo, text=True).strip()

    def commit(self, message):
        (self.repo / 'f').write_text(message, encoding='utf-8')
        self.git('add', 'f')
        self.git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message)
        return self.git('rev-parse', 'HEAD')

    def push(self, remote):
        return subprocess.run(
            [sys.executable, str(self.guard), 'pre-push', remote],
            cwd=self.repo,
            input=f"refs/heads/main {self.fork} refs/heads/main {'0' * 40}\n",
            text=True,
            encoding='utf-8',
            capture_output=True,
        )

    def test_empty_github_mirror_excludes_upstream_history(self):
        result = self.push('github')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_empty_origin_still_checks_upstream_history(self):
        result = self.push('origin')
        self.assertEqual(result.returncode, 1)
        self.assertIn('标题须为 Conventional Commits', result.stderr)


if __name__ == '__main__':
    unittest.main()
