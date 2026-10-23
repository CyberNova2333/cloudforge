// commit-msg hook (husky: .husky/commit-msg): checks the message being committed against scripts/githooks/rules.mjs.
// Any failure of the check itself lets the commit through with a note: a bug here must never lock the repository.
import { readFileSync } from 'node:fs';
import { problems, RULES_SOURCE, SKIP } from './rules.mjs';

function main() {
  const raw = readFileSync(process.argv[2], 'utf8');
  const found = problems(raw, true);
  if (!found.length) return 0;
  process.stderr.write(
    `\n✘ 提交被 commit-msg 钩子拦下（${found.length} 项）：\n\n`
  );
  found.forEach((p, i) => process.stderr.write(`  ${i + 1}. ${p}\n\n`));
  process.stderr.write(`  规则出处: ${RULES_SOURCE}\n`);
  process.stderr.write(
    `  确需跳过: 在提交信息里**顶格独占一行**写 ${SKIP}\n\n`
  );
  return 1;
}

try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write(
    `\n⚠ commit-msg: 检查自身出错，本次放行。请把下面这段贴给维护者：\n${e?.stack ?? e}\n`
  );
  process.exitCode = 0;
}
