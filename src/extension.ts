import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { collectWorkspaceChanges, NoChangesError } from './gitChanges';
import { createLocalReportArtifact, renderLocalReport } from './reportArtifact';
import { downloadRemoteSkill, normalizeRemoteSkillUrl } from './remoteSkill';
import { ReviewService } from './reviewService';

const resultUri = vscode.Uri.parse('pi-sec-review:result.md');
const maxSkillCharacters = 100_000;
const maxSkillBundleCharacters = 250_000;

type ReviewStatus = 'ready' | 'running' | 'complete' | 'error';

class ReviewTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	private status: ReviewStatus = 'ready';
	private statusDetail = 'Ready to review workspace changes';
	private hasResult = false;

	readonly onDidChangeTreeData = this.changeEmitter.event;

	dispose(): void {
		this.changeEmitter.dispose();
	}

	refresh(): void {
		this.changeEmitter.fire();
	}

	setStatus(status: ReviewStatus, detail: string): void {
		this.status = status;
		this.statusDetail = detail;
		this.refresh();
	}

	setHasResult(hasResult: boolean): void {
		this.hasResult = hasResult;
		this.refresh();
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(): vscode.TreeItem[] {
		const runItem = new vscode.TreeItem('Run workspace review');
		runItem.iconPath = new vscode.ThemeIcon('play');
		runItem.command = { command: 'pi-sec-review.runReview', title: 'Run Workspace Review' };

		const configuredPath = vscode.workspace.getConfiguration('piSecReview').get<string>('skillPath', '');
		const remoteUrl = vscode.workspace.getConfiguration('piSecReview').get<string>('remoteSkillUrl', '');
		const skillItem = new vscode.TreeItem(remoteUrl
			? 'Skill: remote'
			: configuredPath ? `Skill: ${path.basename(path.dirname(configuredPath))}` : 'Skill: not configured');
		skillItem.description = remoteUrl || configuredPath || 'Select a SKILL.md';
		skillItem.tooltip = remoteUrl || configuredPath || 'Select local or remote review instructions';
		skillItem.iconPath = new vscode.ThemeIcon(remoteUrl || configuredPath ? 'book' : 'warning');
		skillItem.command = remoteUrl
			? { command: 'pi-sec-review.selectRemoteSkill', title: 'Select Remote Skill' }
			: { command: 'pi-sec-review.selectSkill', title: 'Select Local Skill' };

		const statusItem = new vscode.TreeItem(this.statusDetail);
		statusItem.description = this.status;
		statusItem.iconPath = new vscode.ThemeIcon({
			ready: 'circle-outline',
			running: 'loading~spin',
			complete: 'pass-filled',
			error: 'error',
		}[this.status]);

		const items = [runItem, skillItem, statusItem];
		if (this.hasResult) {
			const resultItem = new vscode.TreeItem('Open last review');
			resultItem.iconPath = new vscode.ThemeIcon('preview');
			resultItem.command = { command: 'pi-sec-review.openLastResult', title: 'Open Last Review Result' };
			items.push(resultItem);
		}

		return items;
	}
}

class ReviewResultProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
	private content = '# PI Security Review\n\nNo review has been run yet.\n';

	readonly onDidChange = this.changeEmitter.event;

	dispose(): void {
		this.changeEmitter.dispose();
	}

	provideTextDocumentContent(): string {
		return this.content;
	}

	update(content: string): void {
		this.content = content;
		this.changeEmitter.fire(resultUri);
	}
}

function resolveWorkspaceFolder(resource?: vscode.Uri): vscode.WorkspaceFolder | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders?.length) {
		void vscode.window.showErrorMessage('Open a Git workspace before running a security review.');
		return undefined;
	}

	const contextResource = resource?.scheme === 'file'
		? resource
		: vscode.window.activeTextEditor?.document.uri;
	if (contextResource) {
		const folder = vscode.workspace.getWorkspaceFolder(contextResource);
		if (folder) {
			return folder;
		}
	}

	return folders[0];
}

function expandSkillPath(configuredPath: string, folder: vscode.WorkspaceFolder): vscode.Uri {
	const expandedPath = configuredPath.startsWith('~/')
		? path.join(os.homedir(), configuredPath.slice(2))
		: configuredPath;
	return vscode.Uri.file(path.isAbsolute(expandedPath) ? expandedPath : path.join(folder.uri.fsPath, expandedPath));
}

export function extractMarkdownReferences(content: string): string[] {
	const references = new Set<string>();
	const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;
	for (const match of content.matchAll(markdownLink)) {
		const target = match[1].trim().split('#', 1)[0];
		if (target && target.toLowerCase().endsWith('.md') && !path.isAbsolute(target) && !target.includes('://')) {
			references.add(target);
		}
	}
	return [...references];
}

function isInsideWorkspace(candidatePath: string, folder: vscode.WorkspaceFolder): boolean {
	const relativePath = path.relative(folder.uri.fsPath, candidatePath);
	return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

async function bundleSkillReferences(
	content: string,
	skillUri: vscode.Uri,
	folder: vscode.WorkspaceFolder,
): Promise<string> {
	const sections = [content];
	let totalCharacters = content.length;

	for (const reference of extractMarkdownReferences(content)) {
		const referencePath = path.resolve(path.dirname(skillUri.fsPath), reference);
		if (!isInsideWorkspace(referencePath, folder)) {
			throw new Error(`Skill reference must stay inside the workspace: ${reference}`);
		}

		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(referencePath));
		const referenceContent = Buffer.from(bytes).toString('utf8');
		totalCharacters += referenceContent.length;
		if (totalCharacters > maxSkillBundleCharacters) {
			throw new Error(`Skill and references exceed ${maxSkillBundleCharacters} characters.`);
		}

		const displayPath = path.relative(folder.uri.fsPath, referencePath);
		sections.push(`\n\n<skill_reference path="${displayPath}">\n${referenceContent}\n</skill_reference>`);
	}

	return sections.join('');
}

async function chooseSkill(folder: vscode.WorkspaceFolder): Promise<vscode.Uri | undefined> {
	const selected = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectFolders: false,
		canSelectMany: false,
		defaultUri: folder.uri,
		filters: { 'Skill files': ['md'] },
		openLabel: 'Use this skill',
		title: 'Select a local SKILL.md',
	});
	const skillUri = selected?.[0];
	if (!skillUri) {
		return undefined;
	}

	const relativePath = path.relative(folder.uri.fsPath, skillUri.fsPath);
	const storedPath = !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
		? relativePath
		: skillUri.fsPath;
	await vscode.workspace.getConfiguration('piSecReview', folder.uri).update(
		'skillPath',
		storedPath,
		vscode.ConfigurationTarget.WorkspaceFolder,
	);
	await vscode.workspace.getConfiguration('piSecReview', folder.uri).update(
		'remoteSkillUrl',
		'',
		vscode.ConfigurationTarget.WorkspaceFolder,
	);
	return skillUri;
}

function remoteSkillCacheUri(context: vscode.ExtensionContext, sourceUrl: string): vscode.Uri {
	const cacheKey = createHash('sha256').update(sourceUrl).digest('hex');
	return vscode.Uri.joinPath(context.globalStorageUri, 'remote-skills', `${cacheKey}.md`);
}

async function cacheRemoteSkill(
	context: vscode.ExtensionContext,
	sourceUrl: string,
	content: string,
): Promise<vscode.Uri> {
	const cacheUri = remoteSkillCacheUri(context, sourceUrl);
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(context.globalStorageUri, 'remote-skills'));
	await vscode.workspace.fs.writeFile(cacheUri, Buffer.from(content, 'utf8'));
	return cacheUri;
}

async function refreshRemoteSkill(
	context: vscode.ExtensionContext,
	sourceUrl: string,
	output: vscode.OutputChannel,
): Promise<{ uri: vscode.Uri; content: string }> {
	const normalizedUrl = normalizeRemoteSkillUrl(sourceUrl).toString();
	const cacheUri = remoteSkillCacheUri(context, normalizedUrl);
	try {
		const downloaded = await downloadRemoteSkill(normalizedUrl);
		return {
			uri: await cacheRemoteSkill(context, downloaded.sourceUrl, downloaded.content),
			content: downloaded.content,
		};
	} catch (downloadError) {
		try {
			const cached = await vscode.workspace.fs.readFile(cacheUri);
			output.appendLine(`Remote skill refresh failed; using cached copy: ${errorMessage(downloadError)}`);
			return { uri: cacheUri, content: Buffer.from(cached).toString('utf8') };
		} catch {
			throw downloadError;
		}
	}
}

async function chooseRemoteSkill(
	context: vscode.ExtensionContext,
	folder: vscode.WorkspaceFolder,
	output: vscode.OutputChannel,
): Promise<boolean> {
	const currentUrl = vscode.workspace.getConfiguration('piSecReview', folder.uri).get<string>('remoteSkillUrl', '');
	const sourceUrl = await vscode.window.showInputBox({
		title: 'Select a remote SKILL.md',
		prompt: 'Enter an HTTPS URL. GitHub blob URLs are converted to raw content automatically.',
		placeHolder: 'https://example.com/SKILL.md',
		value: currentUrl,
		ignoreFocusOut: true,
		validateInput: value => {
			try {
				normalizeRemoteSkillUrl(value);
				return undefined;
			} catch (error) {
				return errorMessage(error);
			}
		},
	});
	if (!sourceUrl) {
		return false;
	}

	const downloaded = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Downloading remote skill',
		},
		() => downloadRemoteSkill(sourceUrl),
	);
	await cacheRemoteSkill(context, downloaded.sourceUrl, downloaded.content);
	await vscode.workspace.getConfiguration('piSecReview', folder.uri).update(
		'remoteSkillUrl',
		downloaded.sourceUrl,
		vscode.ConfigurationTarget.WorkspaceFolder,
	);
	output.appendLine(`Remote skill cached: ${downloaded.sourceUrl}`);
	return true;
}

async function readSkill(
	context: vscode.ExtensionContext,
	folder: vscode.WorkspaceFolder,
	output: vscode.OutputChannel,
): Promise<{ uri: vscode.Uri; source: string; content: string } | undefined> {
	const configuration = vscode.workspace.getConfiguration('piSecReview', folder.uri);
	const remoteUrl = configuration.get<string>('remoteSkillUrl', '');
	if (remoteUrl) {
		const remote = await refreshRemoteSkill(context, remoteUrl, output);
		return { ...remote, source: remoteUrl };
	}

	const configuredPath = configuration.get<string>('skillPath', '');
	const skillUri = configuredPath ? expandSkillPath(configuredPath, folder) : await chooseSkill(folder);
	if (!skillUri) {
		return undefined;
	}

	const bytes = await vscode.workspace.fs.readFile(skillUri);
	const content = Buffer.from(bytes).toString('utf8');
	if (!content.trim()) {
		throw new Error('The selected skill file is empty.');
	}
	if (content.length > maxSkillCharacters) {
		throw new Error(`The selected skill exceeds ${maxSkillCharacters} characters.`);
	}

	return {
		uri: skillUri,
		source: path.relative(folder.uri.fsPath, skillUri.fsPath),
		content: await bundleSkillReferences(content, skillUri, folder),
	};
}

function errorMessage(error: unknown): string {
	if (error instanceof vscode.LanguageModelError) {
		return `Language model request failed: ${error.message}`;
	}
	return error instanceof Error ? error.message : String(error);
}

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('PI Security Review');
	const treeProvider = new ReviewTreeProvider();
	const resultProvider = new ReviewResultProvider();
	const reviewService = new ReviewService(output);

	context.subscriptions.push(
		output,
		treeProvider,
		resultProvider,
		vscode.window.createTreeView('piSecReview.view', { treeDataProvider: treeProvider }),
		vscode.workspace.registerTextDocumentContentProvider('pi-sec-review', resultProvider),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('piSecReview.skillPath')
				|| event.affectsConfiguration('piSecReview.remoteSkillUrl')) {
				treeProvider.refresh();
			}
		}),
	);

	context.subscriptions.push(vscode.commands.registerCommand('pi-sec-review.selectSkill', async (resource?: vscode.Uri) => {
		const folder = resolveWorkspaceFolder(resource);
		if (folder && await chooseSkill(folder)) {
			treeProvider.refresh();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('pi-sec-review.selectRemoteSkill', async (resource?: vscode.Uri) => {
		const folder = resolveWorkspaceFolder(resource);
		if (!folder) {
			return;
		}

		try {
			if (await chooseRemoteSkill(context, folder, output)) {
				treeProvider.refresh();
			}
		} catch (error) {
			void vscode.window.showErrorMessage(`PI Security Review: ${errorMessage(error)}`);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('pi-sec-review.openLastResult', async () => {
		const document = await vscode.workspace.openTextDocument(resultUri);
		await vscode.window.showTextDocument(document, { preview: false });
	}));

	context.subscriptions.push(vscode.commands.registerCommand('pi-sec-review.runReview', async (resource?: vscode.Uri) => {
		const folder = resolveWorkspaceFolder(resource);
		if (!folder) {
			return;
		}
		const reviewPath = resource?.scheme === 'file' ? resource.fsPath : folder.uri.fsPath;

		treeProvider.setStatus('running', 'Review in progress');
		output.clear();
		output.appendLine(`Reviewing workspace: ${reviewPath}`);

		try {
			const skill = await readSkill(context, folder, output);
			if (!skill) {
				treeProvider.setStatus('ready', 'Review cancelled');
				return;
			}

			const maxCharacters = vscode.workspace.getConfiguration('piSecReview', folder.uri)
				.get<number>('maxDiffCharacters', 120_000);
			const result = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'PI Security Review',
					cancellable: true,
				},
				async (progress, token) => {
					progress.report({ message: 'Collecting Git changes' });
					const changes = await collectWorkspaceChanges(reviewPath, maxCharacters);
					progress.report({ message: 'Running local review skill' });
					return reviewService.review(skill.content, changes, token);
				},
			);

			const artifact = createLocalReportArtifact({
				workspaceLabel: folder.name,
				skillPath: skill.source,
				reportMarkdown: result,
			});
			resultProvider.update(renderLocalReport(artifact));
			treeProvider.setHasResult(true);
			treeProvider.setStatus('complete', 'Review complete');
			await vscode.commands.executeCommand('pi-sec-review.openLastResult');
		} catch (error) {
			if (error instanceof NoChangesError) {
				treeProvider.setStatus('ready', 'No changes to review');
				void vscode.window.showInformationMessage(error.message);
				return;
			}

			const message = errorMessage(error);
			output.appendLine(message);
			treeProvider.setStatus('error', 'Review failed');
			void vscode.window.showErrorMessage(`PI Security Review: ${message}`, 'Show Output').then(selection => {
				if (selection === 'Show Output') {
					output.show();
				}
			});
		}
	}));
}

export function deactivate(): void {}
