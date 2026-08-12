# AI 代码扫描项目

本仓库由两个子项目组成，共同服务于 AI 代码扫描能力：

- `plugin-raw/`：VS Code 插件源码、插件技能资源、测试和构建配置。
- `AI代码扫描平台/`：AI 代码扫描平台代码。

## 插件开发

在仓库根目录打开 VS Code 后，可以直接使用 `plugin: compile`、`plugin: watch` 任务，并通过 `Run Extension` 调试配置启动插件开发宿主。

也可以在终端中运行：

```bash
cd plugin-raw
npm run compile
npm test
```

平台代码的技术栈确定后，应在 `AI代码扫描平台/` 内维护独立的依赖、构建和运行配置，避免与插件依赖混用。# PI Security Review

PI Security Review is a VS Code extension that reviews uncommitted Git workspace changes using instructions from a configurable local or remote `SKILL.md` file and a GitHub Copilot language model.

## Features

- Activity Bar view for starting a workspace review and tracking its status.
- Configurable local or HTTPS code-review skill with local caching.
- Default workspace security-baseline skill with linked Markdown reference loading.
- Review coverage for staged, unstaged, and untracked files.
- Binary-file omission and configurable input truncation.
- Versioned, confidential Markdown review results with severity, location, impact, remediation, and coverage.
- Automatic Git repository detection from the invoked resource and cancellable model requests.

## Requirements

- VS Code 1.125.0 or later.
- Git available on `PATH`.
- GitHub Copilot Chat installed, signed in, and allowed to provide language model access.
- The bundled security baseline at `.github/skills/security-baseline-review/references/sec-baseline.md`, or another local Markdown skill containing the review instructions.

The stable VS Code API does not expose a command that directly executes a Copilot custom skill. This extension reads the selected skill and its linked workspace Markdown references, then supplies them as model context. References outside the workspace are rejected. Skill steps that depend on agent tools, subagents, or shell execution are not run automatically.

## Usage

1. Open a Git workspace with uncommitted changes.
2. Open **PI Security Review** from the Activity Bar.
3. Select **Run workspace review** to use `.github/skills/security-baseline-review/SKILL.md`.
4. Review the generated Markdown document.

Select the displayed Skill entry when you need to use a different local `SKILL.md`. Use **Select Remote Skill** from the view toolbar, Command Palette, or context submenu to enter an HTTPS URL. GitHub `blob` URLs are converted to Raw URLs automatically.

Remote Skills are downloaded into extension storage and refreshed before each review. If a refresh fails, the last cached copy is used. The initial download must succeed, downloads are limited to 100,000 characters, and remote Skills must be self-contained Markdown because linked files are not downloaded recursively.

You can also right-click a file or folder in Explorer and select **PI Security Review > Run Workspace Review**. The extension automatically reviews the Git repository containing that resource without asking you to select a workspace folder.

VS Code may request consent before the first language model call. Workspace changes are sent to the selected Copilot model for review.

## Report Upload Boundary

Reports currently remain local and are marked `CONFIDENTIAL`, `remoteUploadAllowed: false`, and `uploadStatus: not-configured`. The extension does not make report-upload network requests.

The versioned report contract is defined in `.github/skills/security-baseline-review/assets/report-artifact.schema.json`. A future uploader must require an explicit authorization reference, use credentials from VS Code SecretStorage, validate an allowlisted destination, and upload only the sanitized final report. Source code, raw diffs, prompts, and raw model responses must not be uploaded.

## Settings

- `piSecReview.skillPath`: Absolute path, home-relative path beginning with `~/`, or workspace-relative path to `SKILL.md`. Defaults to `.github/skills/security-baseline-review/SKILL.md`.
- `piSecReview.remoteSkillUrl`: HTTPS URL of a remote `SKILL.md`. When set, it takes precedence over `skillPath` and is cached locally.
- `piSecReview.maxDiffCharacters`: Maximum workspace-change characters sent to the model. Defaults to `120000`.

## Development

Run `npm run compile` for type checking, linting, and bundling. Run `npm test` for the Extension Host tests. Press `F5` to launch an Extension Development Host and exercise the sidebar with a signed-in Copilot account.
