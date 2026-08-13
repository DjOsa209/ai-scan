import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { test } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { collectFullSourceSnapshot, collectFullWorkspaceContext, collectSourceSnapshot, collectWorkspaceContext } from '../gitChanges';
import { WorkspaceSourceBaseline } from '../autoIncrementalScan';
import { isScannableSourcePath } from '../sourceFilter';

test('automatic incremental scanning activates when VS Code finishes starting', () => {
	const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
		activationEvents?: string[];
	};

	assert.ok(manifest.activationEvents?.includes('onStartupFinished'));
});

test('source upload includes code and security configuration but excludes unrelated content', () => {
	for (const candidate of ['src/app.ts', 'server/main.go', 'Dockerfile', 'config/application.yml', 'package-lock.json']) {
		assert.strictEqual(isScannableSourcePath(candidate), true, `${candidate} should be scanned`);
	}
	for (const candidate of ['README.md', 'docs/architecture.pdf', 'assets/logo.png', 'coverage/lcov.html', 'demo.mp4']) {
		assert.strictEqual(isScannableSourcePath(candidate), false, `${candidate} should be excluded`);
	}
});

test('workspace collection removes non-code files from status, diff and uploaded snapshot', async () => {
	const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-source-filter-'));
	try {
		execFileSync('git', ['init'], { cwd: repositoryRoot });
		execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot });
		execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repositoryRoot });
		writeFileSync(path.join(repositoryRoot, 'app.ts'), 'export const version = 1;\n');
		writeFileSync(path.join(repositoryRoot, 'README.md'), '# Version 1\n');
		execFileSync('git', ['add', '.'], { cwd: repositoryRoot });
		execFileSync('git', ['commit', '-m', 'initial'], { cwd: repositoryRoot });
		writeFileSync(path.join(repositoryRoot, 'app.ts'), 'export const version = 2;\n');
		writeFileSync(path.join(repositoryRoot, 'README.md'), '# Version 2\n');

		const context = await collectWorkspaceContext(repositoryRoot, 100_000);
		const snapshot = await collectSourceSnapshot(repositoryRoot, context);

		assert.match(context.gitStatus, /app\.ts/);
		assert.doesNotMatch(context.gitStatus, /README/);
		assert.match(context.diff, /app\.ts/);
		assert.doesNotMatch(context.diff, /README/);
		assert.deepStrictEqual(snapshot.files.map(file => file.path), ['app.ts']);
	} finally {
		rmSync(repositoryRoot, { recursive: true, force: true });
	}
});

test('incremental collection only includes paths changed after the workspace baseline', async () => {
	const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-incremental-baseline-'));
	try {
		execFileSync('git', ['init'], { cwd: repositoryRoot });
		execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot });
		execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repositoryRoot });
		writeFileSync(path.join(repositoryRoot, 'before.ts'), 'export const before = 1;\n');
		writeFileSync(path.join(repositoryRoot, 'after.ts'), 'export const after = 1;\n');
		execFileSync('git', ['add', '.'], { cwd: repositoryRoot });
		execFileSync('git', ['commit', '-m', 'initial'], { cwd: repositoryRoot });
		writeFileSync(path.join(repositoryRoot, 'before.ts'), 'export const before = 2;\n');
		writeFileSync(path.join(repositoryRoot, 'after.ts'), 'export const after = 2;\n');

		const context = await collectWorkspaceContext(repositoryRoot, 100_000, new Set(['after.ts']));

		assert.deepStrictEqual(context.files.filter(file => file.kind === 'changed').map(file => file.path), ['after.ts']);
		assert.match(context.gitStatus, /after\.ts/);
		assert.doesNotMatch(context.gitStatus, /before\.ts/);
		assert.match(context.diff, /after\.ts/);
		assert.doesNotMatch(context.diff, /before\.ts/);
	} finally {
		rmSync(repositoryRoot, { recursive: true, force: true });
	}
});

test('workspace baseline ignores pre-existing changes and detects later edits', async () => {
	const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-source-baseline-'));
	try {
		execFileSync('git', ['init'], { cwd: repositoryRoot });
		writeFileSync(path.join(repositoryRoot, 'app.ts'), 'export const version = 1;\n');
		const baseline = await WorkspaceSourceBaseline.capture(repositoryRoot);

		assert.strictEqual(await baseline.changedPath(path.join(repositoryRoot, 'app.ts')), undefined);
		writeFileSync(path.join(repositoryRoot, 'app.ts'), 'export const version = 2;\n');
		assert.strictEqual(await baseline.changedPath(path.join(repositoryRoot, 'app.ts')), 'app.ts');
		writeFileSync(path.join(repositoryRoot, 'created.ts'), 'export const created = true;\n');
		assert.strictEqual(await baseline.changedPath(path.join(repositoryRoot, 'created.ts')), 'created.ts');
		writeFileSync(path.join(repositoryRoot, 'notes.md'), '# ignored\n');
		assert.strictEqual(await baseline.changedPath(path.join(repositoryRoot, 'notes.md')), undefined);
	} finally {
		rmSync(repositoryRoot, { recursive: true, force: true });
	}
});

test('full workspace collection scans source files without a Git repository', async () => {
	const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-full-source-'));
	const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-full-outside-'));
	try {
		mkdirSync(path.join(workspaceRoot, 'src'));
		mkdirSync(path.join(workspaceRoot, 'node_modules'));
		writeFileSync(path.join(workspaceRoot, 'src', 'app.ts'), 'export const version = 1;\n');
		writeFileSync(path.join(workspaceRoot, 'package.json'), '{"name":"fixture"}\n');
		writeFileSync(path.join(workspaceRoot, 'README.md'), '# Fixture\n');
		writeFileSync(path.join(workspaceRoot, 'node_modules', 'dependency.js'), 'throw new Error("excluded");\n');
		writeFileSync(path.join(outsideRoot, 'secret.ts'), 'export const secret = true;\n');

		const context = await collectFullWorkspaceContext(workspaceRoot, 100_000);
		const snapshot = await collectFullSourceSnapshot(workspaceRoot, context, undefined, [
			path.relative(workspaceRoot, path.join(outsideRoot, 'secret.ts')),
		]);

		assert.strictEqual(context.scanScope, 'full');
		assert.strictEqual(context.diff, '');
		assert.deepStrictEqual(context.files.map(file => file.path), ['package.json', 'src/app.ts']);
		assert.deepStrictEqual(snapshot.files.map(file => file.path), ['package.json', 'src/app.ts']);
		assert.doesNotMatch(context.gitStatus, /README|node_modules/);
	} finally {
		rmSync(workspaceRoot, { recursive: true, force: true });
		rmSync(outsideRoot, { recursive: true, force: true });
	}
});
