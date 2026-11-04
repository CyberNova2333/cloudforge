// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
'use strict';

// 离线容器检查：挂载本文件为只读，所有夹具、缓存和配置只写 /tmp。
// docker run --rm --network none --read-only --tmpfs /tmp:exec \
//   --mount type=bind,source=<absolute smoke.cjs>,target=/smoke.cjs,readonly \
//   --entrypoint node <image> /smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

assert.equal(
  process.platform,
  'linux',
  '请在 Linux runner 容器内运行 smoke.cjs'
);
const root = fs.mkdtempSync('/tmp/cloudforge-runner-smoke-');
const home = path.join(root, 'home');
fs.mkdirSync(home);
const env = {
  ...process.env,
  HOME: home,
  XDG_CACHE_HOME: path.join(root, 'cache'),
  XDG_CONFIG_HOME: path.join(root, 'config'),
  npm_config_cache: path.join(root, 'npm-cache'),
  npm_config_userconfig: path.join(home, 'npmrc'),
  npm_config_globalconfig: path.join(root, 'npm-globalrc'),
  npm_config_update_notifier: 'false',
  PIP_CONFIG_FILE: '/dev/null',
  PIP_NO_INDEX: '1',
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
  PIP_NO_CACHE_DIR: '1',
  PYTHONDONTWRITEBYTECODE: '1',
  GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
  GIT_TERMINAL_PROMPT: '0',
  GIT_ALLOW_PROTOCOL: 'file',
  GCM_INTERACTIVE: 'never',
};

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === 'string' || Buffer.isBuffer(value)
      ? value
      : `${JSON.stringify(value, null, 2)}\n`
  );
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function run(command, args, options = {}) {
  const displayArgs = args.map((arg, index) =>
    ['-c', '-e'].includes(args[index - 1]) ? '<inline fixture>' : arg
  );
  console.log(`RUN ${command} ${JSON.stringify(displayArgs)}`);
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
    env: { ...env, ...options.env },
  });
}

function executable(name) {
  for (const dir of env.PATH.split(path.delimiter)) {
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return fs.realpathSync(file);
    } catch {}
  }
  throw new Error(`runner 缺少命令：${name}`);
}

function packageFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) packageFiles(file, files);
    else if (entry.name === 'package.json') files.push(file);
  }
  return files;
}

function npmDependencies() {
  const npmRoot = path.dirname(path.dirname(executable('npm')));
  const npmRequire = createRequire(path.join(npmRoot, 'package.json'));
  const semver = npmRequire('semver');
  const minimum = {
    undici: '6.29.1',
    'ip-address': '10.7.4',
    glob: '14.0.2',
    minimatch: '11.0.1',
  };
  const packages = packageFiles(path.dirname(npmRoot)).map((file) => ({
    file,
    pkg: readJson(file),
  }));
  const inventory = packages
    .filter(({ pkg }) => Object.hasOwn(minimum, pkg.name))
    .map(({ file, pkg }) => ({
      path: file,
      name: pkg.name,
      version: pkg.version,
    }));
  const consumers = [];
  for (const { file, pkg } of packages) {
    const consumerRequire = createRequire(file);
    for (const name of Object.keys(minimum)) {
      if (!pkg.dependencies?.[name]) continue;
      const resolved = consumerRequire.resolve(`${name}/package.json`);
      consumers.push({
        consumer: pkg.name,
        from: file,
        dependency: name,
        declared: pkg.dependencies[name],
        version: readJson(resolved).version,
        resolved,
      });
    }
  }
  console.log(
    JSON.stringify({ node: process.version, npmRoot, inventory, consumers })
  );
  for (const name of Object.keys(minimum)) {
    assert.ok(
      inventory.some((item) => item.name === name),
      `缺少依赖盘点：${name}`
    );
  }
  for (const item of [...inventory, ...consumers]) {
    const name = item.dependency || item.name;
    assert.ok(
      semver.gte(item.version, minimum[name]),
      `${name}@${item.version} 未达到 ${minimum[name]}：${item.resolved || item.path}`
    );
  }
}

function npmFunctions() {
  const packs = path.join(root, 'npm-packs');
  fs.mkdirSync(packs);
  const vendor = path.join(root, 'npm-vendor');
  write(path.join(vendor, 'package.json'), {
    name: 'cloudforge-smoke-tarball',
    version: '1.0.0',
    main: 'index.js',
  });
  write(path.join(vendor, 'index.js'), 'module.exports = 73\n');
  const vendorPack = JSON.parse(
    run(
      'npm',
      [
        'pack',
        '--offline',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        packs,
      ],
      { cwd: vendor }
    )
  )[0];
  const project = path.join(root, 'npm-project');
  write(path.join(project, 'package.json'), {
    name: 'cloudforge-smoke-root',
    version: '1.0.0',
    private: true,
    workspaces: ['packages/*', '!packages/private-*'],
    dependencies: {
      'cloudforge-smoke-tarball': `file:../npm-packs/${vendorPack.filename}`,
      'cloudforge-smoke-local': 'file:./local-dep',
    },
    files: ['lib/**/*.{js,json}'],
  });
  write(path.join(project, 'README.md'), 'CloudForge runner smoke fixture.\n');
  write(path.join(project, 'lib/a.js'), 'module.exports = 1\n');
  write(path.join(project, 'lib/sub/b.json'), '{"ok":true}\n');
  write(path.join(project, 'lib/.hidden.js'), 'module.exports = true\n');
  write(path.join(project, 'lib/excluded.txt'), 'must not be packed\n');
  write(path.join(project, 'local-dep/package.json'), {
    name: 'cloudforge-smoke-local',
    version: '1.0.0',
    main: 'index.js',
  });
  write(path.join(project, 'local-dep/index.js'), 'module.exports = 42\n');
  for (const name of ['a', 'b', 'private-hidden']) {
    write(path.join(project, `packages/${name}/package.json`), {
      name: `cloudforge-smoke-workspace-${name}`,
      version: '1.0.0',
      main: 'index.js',
    });
    write(
      path.join(project, `packages/${name}/index.js`),
      `module.exports = '${name}'\n`
    );
  }
  const installFlags = [
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ];
  run('npm', ['install', ...installFlags], { cwd: project });
  assert.ok(
    readJson(path.join(project, 'package-lock.json')).packages[
      'node_modules/cloudforge-smoke-tarball'
    ].integrity,
    'npm install 没有为本地 tarball 保存完整性信息'
  );
  const verifyInstalled = () =>
    run(
      'node',
      [
        '-e',
        `
    const assert = require('node:assert/strict')
    assert.equal(require('cloudforge-smoke-tarball'), 73)
    assert.equal(require('cloudforge-smoke-local'), 42)
    assert.equal(require('cloudforge-smoke-workspace-a'), 'a')
    assert.equal(require('cloudforge-smoke-workspace-b'), 'b')
    assert.equal(require('node:fs').existsSync('node_modules/cloudforge-smoke-workspace-private-hidden'), false)
  `,
      ],
      { cwd: project }
    );
  verifyInstalled();
  const sentinel = path.join(project, 'node_modules/ci-sentinel');
  write(sentinel, 'npm ci must remove this\n');
  run('npm', ['ci', ...installFlags], { cwd: project });
  assert.equal(fs.existsSync(sentinel), false, 'npm ci 没有重建 node_modules');
  verifyInstalled();
  const packed = JSON.parse(
    run(
      'npm',
      [
        'pack',
        '--offline',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        packs,
      ],
      { cwd: project }
    )
  )[0];
  const packedFiles = packed.files.map((file) => file.path).sort();
  assert.deepEqual(
    packedFiles,
    [
      'README.md',
      'lib/.hidden.js',
      'lib/a.js',
      'lib/sub/b.json',
      'package.json',
    ],
    'npm pack 的 files glob 或 dotfile 行为发生变化'
  );
  const workspaces = JSON.parse(
    run(
      'npm',
      [
        'pack',
        '--offline',
        '--workspaces',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        packs,
      ],
      { cwd: project }
    )
  );
  assert.deepEqual(
    workspaces.map((pkg) => pkg.name).sort(),
    ['cloudforge-smoke-workspace-a', 'cloudforge-smoke-workspace-b'],
    'workspace 发现或排除规则发生变化'
  );
  const queried = JSON.parse(
    run(
      'npm',
      [
        'query',
        ':root > :is([name="cloudforge-smoke-tarball"], [name="cloudforge-smoke-local"])',
        '--json',
      ],
      { cwd: project }
    )
  );
  assert.deepEqual(queried.map((pkg) => pkg.name).sort(), [
    'cloudforge-smoke-local',
    'cloudforge-smoke-tarball',
  ]);
  const cacheResult = run('npm', ['cache', 'verify'], { cwd: project });
  assert.match(cacheResult, /Cache verified/, 'npm cache verify 没有成功收据');
  console.log(
    JSON.stringify({
      packedFiles,
      workspaces: workspaces.map((pkg) => pkg.name),
      cache: cacheResult.trim(),
    })
  );
}

const pythonSmoke = String.raw`
import base64, csv, hashlib, importlib.metadata, io, json, os, pathlib, pyexpat, shutil, sqlite3, subprocess, sys, zipfile
import xml.etree.ElementTree as ET
import pip
from pip._vendor import msgpack, urllib3

assert pip.__version__ == '26.3'
assert pyexpat.EXPAT_VERSION == 'expat_2.10.0'
assert ET.fromstring('<fixture><item>ok</item></fixture>')[0].text == 'ok'
assert importlib.metadata.version('pip') == pip.__version__
assert urllib3.__version__ == '2.8.0'
assert urllib3.__name__ == 'pip._vendor.urllib3'
assert msgpack.__version__ == '1.2.4'
assert msgpack.unpackb(msgpack.packb({'cloudforge': [42, True]})) == {'cloudforge': [42, True]}
vendor = pathlib.Path(pip.__file__).parent / '_vendor'
vendor_pins = {line.strip() for line in (vendor / 'vendor.txt').read_text().splitlines()}
assert {'urllib3==2.8.0', 'msgpack==1.2.4'} <= vendor_pins
bom = json.loads((vendor / 'bom.cdx.json').read_text())
component = next(item for item in bom['components'] if item['name'] == 'urllib3')
assert component['version'] == '2.8.0' and component['purl'] == 'pkg:pypi/urllib3@2.8.0'
component = next(item for item in bom['components'] if item['name'] == 'msgpack')
assert component['version'] == '1.2.4' and component['purl'] == 'pkg:pypi/msgpack@1.2.4'
assert 'pkg:pypi/urllib3@2.7.0' not in json.dumps(bom)
license_file = pathlib.Path(importlib.metadata.distribution('pip').locate_file(
    'pip-26.3.dist-info/licenses/src/pip/_vendor/urllib3/LICENSE.txt'))
assert (vendor / 'urllib3' / 'LICENSE.txt').read_bytes() == license_file.read_bytes()
sources = json.loads(pathlib.Path('/usr/local/share/cloudforge/python-sources.json').read_text())
assert sources['pip']['version'] == pip.__version__
for name in ('msgpack', 'urllib3', 'setuptools'):
    component = next(item for item in bom['components'] if item['name'] == name)
    assert sources['bundled_components'][name] == component['version']

root = pathlib.Path(sys.argv[1])
root.mkdir()
def run(args, env=None):
    print('RUN ' + json.dumps([str(arg) for arg in args]), flush=True)
    result = subprocess.run([str(arg) for arg in args], check=True, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90, env=env)
    print(result.stdout.strip(), flush=True)
    return result.stdout

run([sys.executable, '-m', 'pip', '--version'])
run([shutil.which('pip3'), '--version'])
run([sys.executable, '-m', 'wheel', 'version'])

# 自带最小 PEP 517 backend，不需要联网安装 setuptools 等构建依赖。
project = root / 'project'
project.mkdir()
(project / 'pyproject.toml').write_text('''[build-system]
requires = []
build-backend = "smoke_backend"
backend-path = ["."]
''', encoding='utf-8')
(project / 'smoke_backend.py').write_text('''import base64, csv, hashlib, io, pathlib, zipfile
def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    name = "cloudforge_smoke_pkg-1.0.0-py3-none-any.whl"
    info = "cloudforge_smoke_pkg-1.0.0.dist-info"
    files = {
        "cloudforge_smoke_pkg/__init__.py": b"VALUE = 42\\n",
        info + "/METADATA": b"Metadata-Version: 2.1\\nName: cloudforge-smoke-pkg\\nVersion: 1.0.0\\n\\n",
        info + "/WHEEL": b"Wheel-Version: 1.0\\nGenerator: cloudforge-smoke\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n",
    }
    rows = []
    for path, data in files.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        rows.append((path, "sha256=" + digest, str(len(data))))
    rows.append((info + "/RECORD", "", ""))
    record = io.StringIO()
    csv.writer(record, lineterminator="\\n").writerows(rows)
    files[info + "/RECORD"] = record.getvalue().encode()
    with zipfile.ZipFile(pathlib.Path(wheel_directory) / name, "w", zipfile.ZIP_DEFLATED) as wheel:
        for path, data in files.items():
            wheel.writestr(path, data)
    return name
''', encoding='utf-8')
wheels = root / 'wheels'
wheels.mkdir()
run([sys.executable, '-m', 'pip', 'wheel', '--no-index', '--no-deps', '--no-build-isolation',
     '--wheel-dir', wheels, project])
wheel = next(wheels.glob('*.whl'))
target = root / 'installed'
run([shutil.which('pip3'), 'install', '--no-index', '--no-deps', '--no-compile', '--target', target, wheel])
sys.path.insert(0, str(target))
import cloudforge_smoke_pkg
assert cloudforge_smoke_pkg.VALUE == 42, 'pip3 --target package import failed'
assert importlib.metadata.version('cloudforge-smoke-pkg') == '1.0.0'
for backend in ('0', '1'):
    backend_env = dict(os.environ, _PIP_USE_IMPORTLIB_METADATA=backend)
    expected_backend = 'pkg_resources' if backend == '0' else 'importlib'
    run([sys.executable, '-c', 'from pip._internal.metadata import select_backend; '
         + f'assert select_backend().NAME == {expected_backend!r}'], env=backend_env)
    packages = json.loads(run([sys.executable, '-m', 'pip', 'list', '--path', target, '--format=json',
                               '--disable-pip-version-check'], env=backend_env).splitlines()[-1])
    assert {'name': 'cloudforge-smoke-pkg', 'version': '1.0.0'} in packages
unpacked = root / 'unpacked'
run([sys.executable, '-m', 'wheel', 'unpack', '--dest', unpacked, wheel])
repacked = root / 'repacked'
repacked.mkdir()
run([sys.executable, '-m', 'wheel', 'pack', '--dest-dir', repacked,
     unpacked / 'cloudforge_smoke_pkg-1.0.0'])
with zipfile.ZipFile(next(repacked.glob('*.whl'))) as archive:
    assert archive.read('cloudforge_smoke_pkg/__init__.py') == b'VALUE = 42\n'
db = sqlite3.connect(':memory:')
db.execute('CREATE VIRTUAL TABLE documents USING fts5(body)')
db.execute('INSERT INTO documents(body) VALUES (?)', ('cloudforge offline smoke',))
assert db.execute('SELECT body FROM documents WHERE documents MATCH ?', ('cloudforge',)).fetchall() == [('cloudforge offline smoke',)]
assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
print(json.dumps({'python': sys.version.split()[0], 'pip': importlib.metadata.version('pip'),
                  'wheel': importlib.metadata.version('wheel'), 'sqlite': sqlite3.sqlite_version,
                  'fts5': True, 'packageValue': cloudforge_smoke_pkg.VALUE}), flush=True)
`;

function pythonFunctions() {
  console.log(
    run('python3', ['-c', pythonSmoke, path.join(root, 'python')]).trim()
  );
}

function gitLfsFunctions() {
  assert.match(
    run('git', ['lfs', 'version']),
    /CloudForge-custom-security-build/
  );
  const licenseDir = '/usr/local/share/licenses/git-lfs';
  const buildInfo = fs.readFileSync(
    path.join(licenseDir, 'git-lfs.buildinfo.txt'),
    'utf8'
  );
  assert.match(buildInfo, /go1\.27\.3/);
  for (const [module, version] of [
    ['crypto', 'v0.58.1-0.20261009181718-2f1f834330b2'],
    ['net', 'v0.62.0'],
    ['text', 'v0.43.0'],
  ]) {
    assert.ok(buildInfo.includes(`golang.org/x/${module}\t${version}`));
  }
  run('sha256sum', ['--check', 'SHA256SUMS'], { cwd: licenseDir });
  for (const [name, marker] of [
    ['clean', 'clean'],
    ['smudge', 'smudge'],
    ['process', 'filter-process'],
    ['required', 'true'],
  ]) {
    const value = run('git', [
      'config',
      '--system',
      '--get',
      `filter.lfs.${name}`,
    ]).trim();
    assert.ok(
      value.includes(marker),
      `Git LFS system filter ${name} 无效：${value}`
    );
    console.log(`filter.lfs.${name}=${value}`);
  }
  const source = path.join(root, 'git-source');
  const remote = path.join(root, 'git-remote.git');
  const checkout = path.join(root, 'git-checkout');
  run('git', ['init', '--initial-branch=main', source]);
  run('git', ['init', '--bare', '--initial-branch=main', remote]);
  const git = (args) => run('git', args, { cwd: source });
  git(['config', 'user.name', 'CloudForge Smoke']);
  git(['config', 'user.email', 'runner-smoke@example.invalid']);
  git(['lfs', 'track', '*.bin']);
  const payload = Buffer.from([
    0, 67, 108, 111, 117, 100, 70, 111, 114, 103, 101, 255, 10,
  ]);
  write(path.join(source, 'payload.bin'), payload);
  const pointer = run('git', ['lfs', 'clean', '--', 'payload.bin'], {
    cwd: source,
    input: payload,
  });
  assert.match(pointer, /^version https:\/\/git-lfs.github.com\/spec\/v1\n/);
  const restored = run('git', ['lfs', 'smudge', '--', 'payload.bin'], {
    cwd: source,
    input: pointer,
    encoding: null,
  });
  assert.deepEqual(restored, payload, 'Git LFS 本地 clean/smudge 内容不一致');
  git(['add', '.gitattributes', 'payload.bin']);
  git(['commit', '-m', 'runner smoke fixture']);
  assert.equal(
    git(['show', 'HEAD:payload.bin']),
    pointer,
    '提交没有保存 LFS pointer'
  );
  const remoteUrl = pathToFileURL(remote).href;
  git(['remote', 'add', 'origin', remoteUrl]);
  git(['push', 'origin', 'main']);
  git(['lfs', 'push', '--all', 'origin', 'main']);
  run('git', ['clone', '--branch', 'main', remoteUrl, checkout], {
    env: { GIT_LFS_SKIP_SMUDGE: '1' },
  });
  assert.equal(
    fs.readFileSync(path.join(checkout, 'payload.bin'), 'utf8'),
    pointer,
    'skip-smudge clone 应先留下 pointer'
  );
  run('git', ['lfs', 'fetch', 'origin', 'main'], { cwd: checkout });
  run('git', ['lfs', 'checkout'], { cwd: checkout });
  assert.deepEqual(
    fs.readFileSync(path.join(checkout, 'payload.bin')),
    payload,
    'Git LFS file remote fetch/checkout 内容不一致'
  );
  fs.unlinkSync(path.join(checkout, 'payload.bin'));
  run('git', ['checkout', '--', 'payload.bin'], { cwd: checkout });
  assert.deepEqual(
    fs.readFileSync(path.join(checkout, 'payload.bin')),
    payload,
    'Git checkout 未调用可用的 LFS smudge filter'
  );
  run('git', ['lfs', 'fsck'], { cwd: checkout });
}

function buildTools() {
  for (const [name, minimum] of [
    ['apt', '3.0.4'],
    ['libapt-pkg7.0', '3.0.4'],
    ['linux-libc-dev', '6.12.115-2'],
    ['libexpat1', '2.10.0-1+cloudforge1'],
    ['libexpat1-dev', '2.10.0-1+cloudforge1'],
  ]) {
    const installed = run('dpkg-query', ['-W', '-f=${Version}', name]).trim();
    run('dpkg', ['--compare-versions', installed, 'ge', minimum]);
    console.log(JSON.stringify({ package: name, installed, minimum }));
  }
  const tools = [
    'sh',
    'bash',
    'git',
    'git-lfs',
    'curl',
    'wget',
    'jq',
    'unzip',
    'zip',
    'xz',
    'zstd',
    'tar',
    'python3',
    'pip3',
    'make',
    'cc',
    'c++',
    'ssh',
    'ps',
    'yarn',
  ];
  console.log(
    JSON.stringify({
      tools: Object.fromEntries(tools.map((name) => [name, executable(name)])),
    })
  );
  console.log(run('cc', ['--version']).split('\n')[0]);
  const build = path.join(root, 'build');
  write(
    path.join(build, 'smoke.c'),
    'int cloudforge_smoke(void) { return 42; }\n'
  );
  write(
    path.join(build, 'Makefile'),
    'smoke.o: smoke.c\n\t$(CC) -Wall -Wextra -Werror -c smoke.c -o smoke.o\n'
  );
  run('make', ['--no-print-directory'], { cwd: build });
  assert.equal(
    run('dpkg-query', ['-W', '-f=${Version}', 'libexpat1']).trim(),
    run('dpkg-query', ['-W', '-f=${Version}', 'libexpat1-dev']).trim()
  );
  write(
    path.join(build, 'xml.c'),
    '#include <expat.h>\n#include <string.h>\n' +
      'int main(void) {\n' +
      '  if (strcmp(XML_ExpatVersion(), "expat_2.10.0")) return 1;\n' +
      '  XML_Parser parser = XML_ParserCreate(NULL);\n' +
      '  if (!parser) return 2;\n' +
      '  int ok = XML_Parse(parser, "<fixture/>", 10, XML_TRUE) == XML_STATUS_OK;\n' +
      '  XML_ParserFree(parser);\n  return ok ? 0 : 3;\n}\n'
  );
  run(
    'cc',
    ['-Wall', '-Wextra', '-Werror', 'xml.c', '-lexpat', '-o', 'xml-smoke'],
    {
      cwd: build,
    }
  );
  run(path.join(build, 'xml-smoke'), [], { cwd: build });
  assert.deepEqual(
    fs.readFileSync(path.join(build, 'smoke.o')).subarray(0, 4),
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    'C 编译器未生成 ELF 对象文件'
  );
  assert.equal(
    run('jq', ['-r', '.ok'], { input: '{"ok":"cloudforge"}' }).trim(),
    'cloudforge'
  );
}

async function main() {
  const failures = [];
  for (const [name, check] of [
    ['build tools', buildTools],
    ['npm dependency resolution', npmDependencies],
    ['npm offline install/ci/pack/workspaces/query/cache', npmFunctions],
    ['Python offline build/install/wheel/SQLite FTS5', pythonFunctions],
    ['Git LFS system filters/local transfer/checkout', gitLfsFunctions],
  ]) {
    console.log(`CHECK ${name}`);
    try {
      await check();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(
        `FAIL ${name}: ${error.status == null ? error.message : `命令退出码 ${error.status}`}`
      );
      for (const stream of ['stdout', 'stderr']) {
        if (error[stream]?.length)
          console.error(`${stream}: ${error[stream].toString().slice(-12000)}`);
      }
    }
  }
  if (failures.length) {
    console.error(
      `Runner smoke failed (${failures.length}): ${failures.join('; ')}`
    );
    process.exitCode = 1;
  } else {
    console.log(
      'PASS CloudForge runner smoke: all 5 checks passed (offline; fixtures only in /tmp)'
    );
  }
}

main().catch((error) => {
  console.error(`Runner smoke setup failed: ${error.stack || error}`);
  process.exitCode = 1;
});
