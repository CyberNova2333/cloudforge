# AGENTS.md

Instructions for coding agents (Codex and others) working in this repository.

- The project rules are in [`CLAUDE.md`](CLAUDE.md): architecture, configuration files, git workflow, database,
  testing and the definition of done. Read it before changing anything; they apply to every agent alike.
- Commit messages follow [`CONTRIBUTING.md`「提交信息」](CONTRIBUTING.md): Chinese, subject「type(scope): 中文描述」
  (type: feat fix refactor docs test chore ci perf build), a `文档:` line in the body, `git commit -s`, and your own
  full `Co-authored-by: Name <email>` trailer at the end (Codex: `Co-authored-by: Codex <noreply@openai.com>`). The
  commit-msg and pre-push hooks in `scripts/githooks/` refuse anything else.
- Never deploy, run production migrations or push without a person saying so in the conversation.
