# Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shlex
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / 'scripts/githooks/history_metadata_proof.py'
GUARD = ROOT / 'tools/repo_maintenance_guard.py'
NODE = ROOT / 'scripts/githooks/pre-push.mjs'
spec = importlib.util.spec_from_file_location('proof', VALIDATOR)
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class HistoryMetadataTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cf-history-proof-')
        self.repo = Path(self.temp.name)
        self.env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'gpg.format', 'ssh')
        self.key = self.repo / 'fixture-signing'
        self.command(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(self.key)])
        self.git('config', 'user.signingKey', str(self.key))
        self.old = self.commit('Original upstream history')
        self.tip = self.commit('fix: 新增检查\n\n文档: 不影响说明\nCo-authored-by: Fixture <fixture@example.invalid>')
        self.path = self.repo / 'proof.json'
        self.url = 'https://example.invalid/fixture.git'
        self.input = f'refs/heads/main {self.tip} refs/heads/main {"0" * 40}\n'.encode()
        self.git('config', '--local', 'repoMaintenance.historyProof', str(self.path))
        self.prepare()

    def tearDown(self):
        self.temp.cleanup()

    def command(self, args, **kwargs):
        return subprocess.check_output(args, cwd=self.repo, env=self.env, stderr=subprocess.DEVNULL, **kwargs)

    def git(self, *args):
        return self.command(['git', *args]).decode('utf-8').strip()

    def commit(self, message, content='safe fixture\n', filename='f'):
        (self.repo / filename).write_text(content, encoding='utf-8')
        self.git('add', filename)
        self.git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', message)
        return self.git('rev-parse', 'HEAD')

    def prepare(self, allowed=None, mutate=None):
        closure = sorted(self.git('rev-list', self.tip).splitlines())
        rows = []
        for oid in sorted(allowed if allowed is not None else [self.old]):
            message = self.command(['git', 'cat-file', 'commit', oid]).partition(b'\n\n')[2]
            rows.append({'oid': oid, 'message_sha256': hashlib.sha256(message).hexdigest()})
        value = {'schema': proof.SCHEMA, 'remote': {'name': 'fixture', 'url': self.url},
                 'updates': [{'local_ref': 'refs/heads/main', 'local_oid': self.tip, 'remote_ref': 'refs/heads/main', 'remote_oid': '0' * 40}],
                 'closure_sha256': hashlib.sha256(proof.canonical(closure)).hexdigest(), 'commits': rows}
        if mutate:
            mutate(value)
        self.path.write_bytes(proof.canonical(value))
        Path(str(self.path) + '.sig').unlink(missing_ok=True)
        self.command(['ssh-keygen', '-Y', 'sign', '-f', str(self.key), '-n', proof.SCHEMA, str(self.path)])

    def invoke(self, target=VALIDATOR, input=None, url=None, env=None):
        args = ['node', str(target)] if target == NODE else [sys.executable, '-B', '-X', 'utf8', str(target)]
        if target == GUARD:
            args.append('pre-push')
        return subprocess.run(args + ['fixture', url or self.url], cwd=self.repo, env=env or self.env,
                              input=self.input if input is None else input, capture_output=True)

    def assert_blocked(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout.decode('utf-8', 'replace'))

    def test_signed_exact_proof_allows_only_imported_style(self):
        for target in [VALIDATOR, GUARD, NODE]:
            result = self.invoke(target)
            self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', 'replace'))

    def test_changed_tips_and_remote_scope_rejected(self):
        for wrong in [self.input.replace(self.tip.encode(), self.old.encode()), self.input.replace(b'refs/heads/main', b'refs/heads/other')]:
            self.assert_blocked(self.invoke(input=wrong))
        self.assert_blocked(self.invoke(url='https://example.invalid/other.git'))

    def test_wrong_message_digest_and_closure_rejected_even_if_signed(self):
        for mutation in [lambda p: p['commits'][0].update(message_sha256='0' * 64), lambda p: p.update(closure_sha256='0' * 64)]:
            self.prepare(mutate=mutation)
            self.assert_blocked(self.invoke())

    def test_missing_corrupted_or_wrong_signer_signature_rejected(self):
        signature = Path(str(self.path) + '.sig')
        signature.unlink()
        self.assert_blocked(self.invoke())
        signature.write_bytes(b'not a signature')
        self.assert_blocked(self.invoke(NODE))
        self.prepare()
        other = self.repo / 'other-key'
        self.command(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(other)])
        self.git('config', 'user.signingKey', str(other))
        self.assert_blocked(self.invoke())

    def test_duplicate_unknown_and_noncanonical_entries_rejected(self):
        for mutation in [lambda p: p['commits'].append(p['commits'][0]), lambda p: p.update(extra=True),
                         lambda p: p['commits'][0].update(oid='f' * 40)]:
            self.prepare(mutate=mutation)
            self.assert_blocked(self.invoke())
        self.prepare()
        self.path.write_bytes(self.path.read_bytes() + b' ')
        self.assert_blocked(self.invoke())

    def test_new_unlisted_message_remains_strict(self):
        self.tip = self.commit('new invalid message')
        self.input = f'refs/heads/main {self.tip} refs/heads/main {"0" * 40}\n'.encode()
        self.prepare()
        self.assert_blocked(self.invoke(GUARD))
        self.assert_blocked(self.invoke(NODE))

    def test_exempt_secret_message_still_rejected(self):
        token = 'gh' + 'p_' + 'a' * 35
        self.tip = self.commit('Imported message ' + token)
        self.input = f'refs/heads/main {self.tip} refs/heads/main {"0" * 40}\n'.encode()
        self.prepare(allowed=[self.old, self.tip])
        result = self.invoke(GUARD)
        self.assert_blocked(result)
        self.assertIn(b'github-token', result.stderr)
        self.assertNotIn(token.encode(), result.stderr)

    def test_exempt_secret_blob_and_sensitive_path_still_rejected(self):
        token = 'gh' + 'p_' + 'b' * 35
        self.tip = self.commit('Imported file', token, '.env')
        self.input = f'refs/heads/main {self.tip} refs/heads/main {"0" * 40}\n'.encode()
        self.prepare(allowed=[self.old, self.tip])
        result = self.invoke(GUARD)
        self.assert_blocked(result)
        self.assertIn(b'sensitive-path', result.stderr)
        self.assertIn(b'github-token', result.stderr)

    def test_environment_cannot_unset_configured_proof(self):
        self.assert_blocked(self.invoke(env={**self.env, 'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'repoMaintenance.historyProof', 'GIT_CONFIG_VALUE_0': ''}))

    def test_new_tip_requires_new_proof(self):
        new = self.commit('feat: 后续提交\n\n文档: 不影响\nCo-authored-by: Fixture <fixture@example.invalid>')
        self.assert_blocked(self.invoke(input=self.input.replace(self.tip.encode(), new.encode())))

    def test_installed_hook_accepts_normal_transport_config_and_blocks_stale_proof(self):
        remote = self.repo / 'destination.git'
        self.command(['git', 'init', '--bare', '-q', str(remote)])
        self.url = remote.as_posix()
        self.git('remote', 'add', 'fixture', self.url)
        self.prepare()
        hook = self.repo / '.git/hooks/pre-push'
        python = shlex.quote(Path(sys.executable).as_posix())
        copied_guard = self.repo / 'tools/repo_maintenance_guard.py'
        copied_validator = self.repo / 'scripts/githooks/history_metadata_proof.py'
        copied_guard.parent.mkdir(parents=True)
        copied_validator.parent.mkdir(parents=True)
        shutil.copyfile(GUARD, copied_guard)
        shutil.copyfile(VALIDATOR, copied_validator)
        guard = shlex.quote(copied_guard.as_posix())
        node = shlex.quote(NODE.as_posix())
        hook.write_text('#!/bin/sh\nset -e\ninput=$(mktemp)\ntrap \'rm -f "$input"\' EXIT\ncat > "$input"\n'
                        + f'{python} {guard} pre-push "$@" < "$input"\n'
                        + f'node {node} "$@" < "$input"\n', encoding='utf-8', newline='\n')
        hook.chmod(0o755)
        self.git('config', '--local', 'core.hooksPath', '.git/hooks')
        flags = ['-c', 'push.followTags=false', '-c', 'push.gpgSign=false', '-c', 'push.recurseSubmodules=no',
                 '-c', 'http.followRedirects=false', '-c', 'credential.interactive=false', '-c', 'credential.helper=']
        normal_env = {key: value for key, value in self.env.items() if key != 'PYTHONDONTWRITEBYTECODE'}
        result = subprocess.run(['git', *flags, 'push', 'fixture', 'main:main'], cwd=self.repo,
                                env=normal_env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', 'replace'))
        self.assertEqual(self.command(['git', '-C', str(remote), 'rev-parse', 'refs/heads/main']).decode().strip(), self.tip)
        self.assertEqual(list(self.repo.rglob('*.pyc')), [])
        stale = subprocess.run(['git', *flags, 'push', 'fixture', 'main:other'], cwd=self.repo,
                               env=normal_env, capture_output=True)
        self.assert_blocked(stale)


if __name__ == '__main__':
    unittest.main()
