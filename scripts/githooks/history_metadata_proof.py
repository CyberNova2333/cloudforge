# Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
"""Validate an operator-signed, exact-push exception for historical message style."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

SCHEMA = 'cloudforge-history-metadata-v1'
MAX_PROOF = 8 * 1024 * 1024
MAX_INPUT = 64 * 1024
OID = re.compile(r'[0-9a-f]{40}')
HASH = re.compile(r'[0-9a-f]{64}')


def require(ok, message):
    if not ok:
        raise ValueError('历史元数据证明：' + message)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode('ascii') + b'\n'


def run(*args, data=None, optional=False):
    result = subprocess.run(args, input=data, capture_output=True, timeout=60,
                            env={**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_NO_LAZY_FETCH': '1', 'GIT_OPTIONAL_LOCKS': '0'})
    require(result.returncode == 0 or optional and result.returncode == 1, '子检查失败：' + args[0])
    require(len(result.stdout) <= 64 * 1024 * 1024, '检查结果超过预算')
    return result.stdout


def bounded(path, maximum):
    with Path(path).open('rb') as handle:
        raw = handle.read(maximum + 1)
    require(len(raw) <= maximum, '文件超过读取预算')
    return raw


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'JSON 键重复')
        result[key] = value
    return result


def exact_keys(value, keys):
    require(isinstance(value, dict) and set(value) == set(keys), '字段不符合固定格式')


def updates_from_input(raw):
    require(len(raw) <= MAX_INPUT, '引用输入超过预算')
    updates = []
    for line in raw.decode('utf-8', 'strict').splitlines():
        parts = line.split()
        require(len(parts) == 4, '引用输入必须为四列')
        local_ref, local_oid, remote_ref, remote_oid = parts
        require(OID.fullmatch(local_oid) and OID.fullmatch(remote_oid), '只支持 SHA1 对象编号')
        require((local_ref.startswith('refs/') or local_ref == local_oid) and remote_ref.startswith('refs/'), '只支持明确的引用或精确本地对象')
        if local_ref.startswith('refs/'):
            run('git', 'check-ref-format', local_ref)
        run('git', 'check-ref-format', remote_ref)
        require(local_oid != '0' * 40, '证明不能用于删除引用')
        updates.append(dict(local_ref=local_ref, local_oid=local_oid, remote_ref=remote_ref, remote_oid=remote_oid))
    require(updates and len({u['remote_ref'] for u in updates}) == len(updates), '引用为空或重复')
    return sorted(updates, key=lambda u: (u['remote_ref'], u['local_ref']))


def config_one(name):
    # Git's effective (last) value includes the normal global/local precedence.
    values = run('git', 'config', '--get', name, optional=True).decode('utf-8').splitlines()
    require(len(values) == 1 and values[0], '配置项必须唯一：' + name)
    return values[0]


def exemptions(raw_input, remote_name, remote_url):
    require(len(raw_input) <= MAX_INPUT, '引用输入超过预算')
    # A command/environment override must not silently disable a configured proof or change its authority.
    forbidden = [key for key in os.environ if key in {
        'GIT_CONFIG', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
        'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_REPLACE_REF_BASE', 'GIT_NAMESPACE'}]
    require(not forbidden, '不接受 Git 配置或对象环境覆盖')
    config = run('git', 'config', '--null', '--show-scope', '--list').split(b'\0')
    require(config[-1] == b'' and len(config) % 2 == 1, '配置作用域不可解析')
    safe_transport = {'push.followtags': 'false', 'push.gpgsign': 'false', 'push.recursesubmodules': 'no',
                      'http.followredirects': 'false', 'credential.interactive': 'false'}
    for index in range(0, len(config) - 1, 2):
        if config[index] != b'command':
            continue
        key, _, value = config[index + 1].decode('utf-8').partition('\n')
        key = key.lower()
        require(safe_transport.get(key) == value or key.startswith('credential.') and key.endswith('.helper'),
                '命令配置只允许不改变证明权威的传输选项')
    configured = run('git', 'config', '--show-scope', '--get-all', 'repoMaintenance.historyProof', optional=True).decode('utf-8').splitlines()
    if not configured:
        return set()
    require(len(configured) == 1 and configured[0].startswith('local\t'), '证明必须由唯一仓库本地配置指定')
    proof_path = Path(configured[0].split('\t', 1)[1])
    require(proof_path.is_absolute(), '证明路径必须为绝对路径')
    raw = bounded(proof_path, MAX_PROOF)
    proof = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object)
    exact_keys(proof, ['schema', 'remote', 'updates', 'closure_sha256', 'commits'])
    require(raw == canonical(proof), 'JSON 必须为规范编码')
    require(proof['schema'] == SCHEMA, '格式版本不支持')
    exact_keys(proof['remote'], ['name', 'url'])
    require(proof['remote'] == {'name': remote_name, 'url': remote_url}, '远端不匹配')
    updates = updates_from_input(raw_input)
    require(proof['updates'] == updates, '引用协议与证明不匹配')
    require(config_one('gpg.format') == 'ssh', '证明要求 SSH 签名配置')
    principal = config_one('user.email')
    require(re.fullmatch(r'[^\s,<>]+@[^\s,<>]+', principal), '签名邮箱无效')
    key = config_one('user.signingKey')
    if key.startswith('key::'):
        public = key[5:].encode('ascii')
    else:
        public_path = Path(key).expanduser()
        if public_path.suffix != '.pub':
            public_path = Path(str(public_path) + '.pub')
        public = bounded(public_path, 4096)
    fields = public.split()
    require(len(fields) >= 2 and fields[0] == b'ssh-ed25519' and re.fullmatch(rb'[A-Za-z0-9+/=]+', fields[1]), '需要 Ed25519 签名公钥')
    signature = bounded(str(proof_path) + '.sig', 16384)
    with tempfile.TemporaryDirectory(prefix='history-metadata-') as directory:
        allowed = Path(directory) / 'allowed_signers'
        signed = Path(directory) / 'proof.sig'
        allowed.write_bytes(principal.encode() + b' ' + b' '.join(fields[:2]) + b'\n')
        signed.write_bytes(signature)
        run('ssh-keygen', '-Y', 'verify', '-f', str(allowed), '-I', principal, '-n', SCHEMA, '-s', str(signed), data=raw)
    require(run('git', 'rev-parse', '--is-shallow-repository').strip() == b'false', '浅克隆不能验证完整历史')
    require(not run('git', 'for-each-ref', 'refs/replace'), '替换引用不支持')
    for filename in ('info/grafts', 'objects/info/alternates'):
        path = Path(os.fsdecode(run('git', 'rev-parse', '--git-path', filename).strip()))
        require(not path.exists(), '对象图覆盖不支持')
    tips = [u['local_oid'] for u in updates]
    for tip in tips:
        require(run('git', 'cat-file', '-t', tip).strip() == b'commit', '证明顶点必须直接指向提交')
    closure = sorted(set(run('git', 'rev-list', '--max-count=100001', *tips).decode('ascii').splitlines()))
    require(len(closure) <= 100000 and proof['closure_sha256'] == hashlib.sha256(canonical(closure)).hexdigest(), '完整提交闭包不匹配')
    require(isinstance(proof['commits'], list) and len(proof['commits']) <= len(closure), '提交列表无效')
    allowed_oids = set()
    previous = ''
    closure_set = set(closure)
    for entry in proof['commits']:
        exact_keys(entry, ['oid', 'message_sha256'])
        oid, digest = entry['oid'], entry['message_sha256']
        require(isinstance(oid, str) and OID.fullmatch(oid) and oid > previous and oid in closure_set, '提交重复、无序或不在本次闭包内')
        require(isinstance(digest, str) and HASH.fullmatch(digest), '信息摘要无效')
        size = int(run('git', 'cat-file', '-s', oid))
        require(size <= MAX_PROOF, '提交对象超过读取预算')
        commit = run('git', 'cat-file', 'commit', oid)
        _, boundary, message = commit.partition(b'\n\n')
        require(boundary and hashlib.sha256(message).hexdigest() == digest, '提交信息摘要不匹配')
        allowed_oids.add(oid)
        previous = oid
    return allowed_oids


def main():
    require(len(sys.argv) == 3, '需要远端名称与地址')
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    allowed = exemptions(raw, sys.argv[1], sys.argv[2])
    print(json.dumps({'schema': SCHEMA, 'style_exempt_commits': sorted(allowed)}, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
