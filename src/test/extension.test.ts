import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { extractMarkdownReferences } from '../extension';
import { findGitRoot, truncateReviewInput } from '../gitChanges';
import { maxRemoteSkillCharacters, normalizeRemoteSkillUrl, validateRemoteSkillContent } from '../remoteSkill';
import { createLocalReportArtifact, renderLocalReport } from '../reportArtifact';

suite('Extension Test Suite', () => {
	test('preserves review input within the configured limit', () => {
		assert.strictEqual(truncateReviewInput('security change', 20), 'security change');
	});

	test('marks review input that exceeds the configured limit', () => {
		assert.strictEqual(
			truncateReviewInput('0123456789', 5),
			'01234\n\n[review input truncated; 5 characters omitted]',
		);
	});

	test('normalizes secure remote skill URLs', () => {
		assert.strictEqual(
			normalizeRemoteSkillUrl('https://github.com/example/security/blob/main/SKILL.md').toString(),
			'https://raw.githubusercontent.com/example/security/main/SKILL.md',
		);
		assert.throws(() => normalizeRemoteSkillUrl('http://example.com/SKILL.md'), /must use HTTPS/);
	});

	test('rejects empty and oversized remote skills', () => {
		assert.throws(() => validateRemoteSkillContent('  '), /empty/);
		assert.throws(
			() => validateRemoteSkillContent('x'.repeat(maxRemoteSkillCharacters + 1)),
			/exceeds/,
		);
	});

	test('extracts unique local Markdown references from a skill', () => {
		assert.deepStrictEqual(
			extractMarkdownReferences([
				'[baseline](./references/sec-baseline.md)',
				'[section](./references/sec-baseline.md#access-control)',
				'[web](https://example.com/security.md)',
				'[schema](./assets/report-schema.json)',
			].join('\n')),
			['./references/sec-baseline.md'],
		);
	});

	test('creates a confidential local report that cannot be uploaded', () => {
		const artifact = createLocalReportArtifact({
			workspaceLabel: 'security-plugin',
			skillPath: '.github/skills/security-baseline-review/SKILL.md',
			reportMarkdown: 'No findings.',
			now: new Date('2026-08-07T00:00:00.000Z'),
		});

		assert.strictEqual(artifact.schemaVersion, '1.0');
		assert.strictEqual(artifact.dataClassification, 'CONFIDENTIAL');
		assert.strictEqual(artifact.remoteUploadAllowed, false);
		assert.strictEqual(artifact.uploadStatus, 'not-configured');
		assert.ok(renderLocalReport(artifact).includes('- Upload: not-configured'));
	});

	test('resolves the Git root from nested folders and files', async () => {
		const repositoryRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pi-sec-review-')));
		const nestedFolder = path.join(repositoryRoot, 'src');
		const nestedFile = path.join(nestedFolder, 'extension.ts');
		try {
			execFileSync('git', ['init', repositoryRoot]);
			mkdirSync(nestedFolder);
			writeFileSync(nestedFile, 'export {};\n');

			assert.strictEqual(await findGitRoot(nestedFolder), repositoryRoot);
			assert.strictEqual(await findGitRoot(nestedFile), repositoryRoot);
		} finally {
			rmSync(repositoryRoot, { recursive: true, force: true });
		}
	});

	test('registers the public review commands', async () => {
		const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'pi-sec-review');
		assert.ok(extension, 'Development extension was not loaded');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('pi-sec-review.runReview'));
		assert.ok(commands.includes('pi-sec-review.selectSkill'));
		assert.ok(commands.includes('pi-sec-review.selectRemoteSkill'));
		assert.ok(commands.includes('pi-sec-review.openLastResult'));
	});

	test('contributes an unconditional review submenu to resource context menus', () => {
		const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
		const submenu = manifest.contributes.submenus?.find((entry: { id: string }) => entry.id === 'piSecReview.context');
		assert.ok(submenu, 'PI Security Review submenu is missing');

		for (const menuId of ['explorer/context', 'editor/context']) {
			const entry = manifest.contributes.menus[menuId]
				.find((item: { submenu?: string }) => item.submenu === 'piSecReview.context');
			assert.ok(entry, `${menuId} does not contain the review submenu`);
			assert.strictEqual(entry.when, undefined, `${menuId} review submenu must be unconditional`);
		}
	});

	test('uses the workspace security baseline skill by default', () => {
		const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
		assert.strictEqual(
			manifest.contributes.configuration.properties['piSecReview.skillPath'].default,
			'.github/skills/security-baseline-review/SKILL.md',
		);
	});
});
