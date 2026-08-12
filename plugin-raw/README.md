# PI Security Review

PI Security Review is a VS Code extension that reviews uncommitted Git workspace changes with a local security Skill and a language model provided by VS Code.

## Features

- Activity Bar scan console with live progress, execution timeline, risk summary, findings navigation, and report preview.
- Native bottom Panel dashboard backed by the same live scan state, with severity counts, clickable findings, and the 20 most recent local reports.
- Automatic incremental scans for source changes written after a Git workspace opens, including edits produced by Agent tools.
- Local workspace Skill loading, including referenced Markdown files. If the configured file is missing, the default Skill and its bundled resources are downloaded from the platform.
- VS Code model selection for Activity Bar reviews.
- `@pi-security /review` support in the Chat/Agent window, using the model selected in that window and opening the extension view when scanning starts.
- Multi-turn follow-up analysis over the latest report, with bounded chat history and read-only Agent tools.
- Live Chinese stage updates for baseline loading, context collection, risk triage, deep AI review, deduplication, and report generation.
- A platform task record created when each review starts and updated through completion or failure.
- Review coverage for staged, unstaged, and untracked files, plus changed-file content, related tests, and root configuration.
- Binary-file omission and configurable input truncation.
- Versioned, confidential Chinese Markdown review results with severity, location, impact, remediation, and coverage.
- Automatic Git repository detection from the invoked resource and cancellable platform requests.
- Confidential review reports that remain local to VS Code.

## Requirements

- VS Code 1.125.0 or later.
- Git available on `PATH`.
- A language model provider available and authorized in VS Code, such as GitHub Copilot.

The extension runs a bounded, read-only Agent loop. A review may use multiple model/tool rounds, and later participant messages continue the current Chat session without starting another platform scan.

## Usage

1. Open a Git workspace with uncommitted changes.
2. Open **PI Security Review** from the Activity Bar.
3. Select **Run Security Review**. On the first scan, enter the scan access key configured as the platform's `PLUGIN_TOKEN`.
4. Choose one of the language models available in VS Code and review the generated Markdown document.

You can also open VS Code Chat, choose a model, and enter `@pi-security /review`. The participant uses that request's selected model and the configured local Skill, opens the PI Security Review view, and exposes auditable progress while the Agent works. Continue sending messages to explain findings, trace evidence, or challenge possible false positives.

You can also right-click a file or folder in Explorer and select **PI Security Review > 全量安全扫描** or **增量安全扫描**. Full scans work without Git; incremental scans require a Git repository.

For Git workspaces, automatic incremental scanning is enabled by default. The extension captures source fingerprints when the workspace opens, waits five seconds after the latest file change, and scans only paths whose contents differ from that opening baseline. A configured scan access key and an available VS Code language model are required; automatic scans never open credential or model prompts.

The context bundle contains source code and is sent only to the model selected in VS Code. The platform receives task metadata, stage, progress, and status messages; source code, diffs, prompts, and generated reports remain local to VS Code.

The scan access key is stored in VS Code SecretStorage and sent only as the Bearer credential for `/api/v1/plugin/*`; plugin scans do not use the platform's browser login session. Run **PI Security Review: 配置扫描接入密钥** from the Command Palette to replace or clear it. The access key is not a model-provider API key.

## Settings

- `piSecReview.skillPath`: Local Skill path relative to the workspace. Defaults to `.github/skills/security-baseline-review/SKILL.md`.
- `piSecReview.platformUrl`: Platform used for missing Skill downloads and scan task lifecycle records. Defaults to `http://localhost:8081`; non-local addresses must use HTTPS.
- `piSecReview.maxContextCharacters`: Maximum local context characters sent to the selected VS Code model. Defaults to `120000`.
- `piSecReview.autoIncrementalScan.enabled`: Enable automatic incremental scanning for Git workspaces. Defaults to `true`; reload the window after changing it.
- `piSecReview.autoIncrementalScan.debounceSeconds`: Delay after the latest source change before an automatic scan starts. Defaults to `5` seconds.

## Development

Run `npm run compile` for type checking, linting, and bundling. Run `npm test` for the Extension Host tests. Press `F5` to launch an Extension Development Host.
