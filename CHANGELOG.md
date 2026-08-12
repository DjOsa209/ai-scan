# Change Log

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