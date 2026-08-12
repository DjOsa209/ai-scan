# Change Log

## 0.0.20

- Normalize singleton `coverage.checked`, `coverage.notChecked`, and `coverage.tools` values from model reports to prevent automatic incremental scan failures.

## 0.0.19

- Merge automatic incremental scan results into a live current report, replacing findings for rescanned files so fixed issues disappear.
- Mark the newest local report as the current result and label older reports as historical snapshots.
- Warn that findings in a historical snapshot may already be fixed by later code changes.

## 0.0.18

- Automatically run debounced incremental scans for source changes created after a Git workspace is opened, including changes written by Agent tools.
- Queue one follow-up scan when files change during an active automatic scan.
- Show up to 20 local reports in the Security Scan panel and allow switching between historical results.

## 0.0.17

- Add separate full and incremental security scan actions to Explorer context menus.
- Allow full scans to collect workspace source files without requiring a Git repository.
- Keep incremental scans Git-based and reject source snapshot paths outside the workspace.

## 0.0.16

- Persist up to 20 local scan snapshots per workspace and restore the latest result after VS Code restarts.
- Replace risk scoring with current/previous issue counts and per-severity trends in the Security Scan panel.
- Add local report export and hide internal scan-engine details from user-facing views.

## 0.0.15

- Track files whose contents are returned to the review Agent during cross-file analysis.
- Upload finding locations and Source-to-Sink data-flow files as prioritized evidence source snapshots.
- Preserve the 23 MiB snapshot limit and workspace path containment checks.

## 0.0.14

- Prompt for the independent scan access key before the first platform scan.
- Store the access key in VS Code SecretStorage and provide an explicit reconfiguration command.
- Explain invalid access keys on HTTP 401 without requiring a platform web login.

## 0.0.13

- Use the model selected in VS Code for Activity Bar and `@pi-security /review` scans.
- Show live Chinese review stages and generate confidential Chinese Markdown reports.
- Create and update platform scan task records without uploading source code, diffs, prompts, or reports.
- Store the optional remote platform token in VS Code SecretStorage.

## 0.0.10

- Run reviews through the AI code scan platform's bounded, stateless model gateway instead of the VS Code Language Model API.
- Build a local context bundle containing Git changes, changed files, related tests, and root configuration files.
- Remove Copilot model selection and add `piSecReview.maxContextCharacters` for the local context budget.

## 0.0.9

- Add the `piSecReview.modelFamily` setting for selecting a specific Copilot model family.
- Log the selected model's maximum input token capacity and report unavailable configured models clearly.

## 0.0.8

- Resolve review instructions directly from the AI code scan platform without local Skill selection.
- Keep only the last verified platform response as an offline fallback; remove the packaged Skill fallback.
- Rename the review action to **Run Security Review**.

## 0.0.7

- Add approval-free automatic JSON report uploads to a configurable HTTPS endpoint.
- Store optional upload Bearer Tokens in VS Code SecretStorage.
- Preserve local reports and surface a failed status when an upload cannot complete.

## 0.0.6

- Use the security baseline Skill packaged with the extension when no local or remote override is configured.
- Load the built-in Skill's Markdown references from the extension package, so new workspaces require no Skill files.

## 0.0.5

- Add remote Skill selection from arbitrary HTTPS and GitHub blob URLs.
- Refresh remote Skills before each review and fall back to the last local cache when refresh fails.
- Enforce HTTPS, redirect, timeout, credential, empty-content, and size safeguards for downloads.

## 0.0.4

- Review the Git repository containing the invoked Explorer resource without prompting for a workspace folder.
- Resolve nested folders and files to their canonical Git repository root.

## 0.0.3

- Replace filtered context commands with an unconditional PI Security Review submenu.
- Add skill selection to the Explorer and editor context menus.

## 0.0.2

- Show the workspace review command in Explorer and editor context menus.

## 0.0.1

- Add a workspace security-review sidebar.
- Load review instructions from a configurable local skill.
- Review staged, unstaged, and untracked Git changes with the VS Code Language Model API.
- Render review findings in a Markdown document.
