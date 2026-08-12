import * as path from 'path';
import * as vscode from 'vscode';
import { fetchPlatformSkill } from './platformSkill';

const maxSkillCharacters = 100_000;
const maxSkillBundleCharacters = 250_000;

export interface LocalSkill {
	readonly source: string;
	readonly content: string;
}

export interface PlatformSkillBundle {
	readonly skill: string;
	readonly references: ReadonlyArray<{ readonly path: string; readonly content: string }>;
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

export function unpackPlatformSkill(content: string): PlatformSkillBundle {
	const references: Array<{ path: string; content: string }> = [];
	const embeddedReference = /\n*<skill_reference path="([^"]+)">\n([\s\S]*?)\n<\/skill_reference>/g;
	const skill = content.replace(embeddedReference, (_match, referencePath: string, referenceContent: string) => {
		references.push({ path: referencePath, content: referenceContent });
		return '';
	}).trimEnd() + '\n';
	return { skill, references };
}

function isInsideWorkspace(candidatePath: string, folder: vscode.WorkspaceFolder): boolean {
	const relativePath = path.relative(folder.uri.fsPath, candidatePath);
	return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isInsideDirectory(candidatePath: string, directory: string): boolean {
	const relativePath = path.relative(directory, candidatePath);
	return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isFileNotFound(error: unknown): boolean {
	return typeof error === 'object' && error !== null
		&& 'code' in error
		&& (error.code === 'FileNotFound' || error.code === 'ENOENT');
}

async function downloadPlatformSkill(
	folder: vscode.WorkspaceFolder,
	skillPath: string,
): Promise<void> {
	const platformUrl = vscode.workspace.getConfiguration('piSecReview', folder.uri)
		.get<string>('platformUrl', 'http://localhost:8081');
	let response;
	try {
		response = await fetchPlatformSkill(platformUrl);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Local Skill was not found and the platform download failed: ${message}`);
	}
	if (response.status !== 'resolved') {
		throw new Error('Local Skill was not found and the Skill platform returned no content.');
	}

	const bundle = unpackPlatformSkill(response.skill.content);
	const skillDirectory = path.dirname(skillPath);
	const referencePaths = new Set<string>();
	const references = bundle.references.map(reference => {
		const referencePath = path.resolve(skillDirectory, reference.path);
		if (!isInsideDirectory(referencePath, skillDirectory) || referencePaths.has(referencePath)) {
			throw new Error(`Downloaded Skill reference has an invalid path: ${reference.path}`);
		}
		referencePaths.add(referencePath);
		return { ...reference, resolvedPath: referencePath };
	});
	await vscode.workspace.fs.createDirectory(vscode.Uri.file(skillDirectory));
	await vscode.workspace.fs.writeFile(vscode.Uri.file(skillPath), Buffer.from(bundle.skill, 'utf8'));
	for (const reference of references) {
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(reference.resolvedPath)));
		await vscode.workspace.fs.writeFile(vscode.Uri.file(reference.resolvedPath), Buffer.from(reference.content, 'utf8'));
	}
}

export async function readLocalSkill(folder: vscode.WorkspaceFolder): Promise<LocalSkill> {
	const configuredPath = vscode.workspace.getConfiguration('piSecReview', folder.uri)
		.get<string>('skillPath', '.github/skills/security-baseline-review/SKILL.md');
	const skillPath = path.isAbsolute(configuredPath)
		? configuredPath
		: path.resolve(folder.uri.fsPath, configuredPath);
	if (!isInsideWorkspace(skillPath, folder)) {
		throw new Error('The local Skill must stay inside the workspace.');
	}

	const skillUri = vscode.Uri.file(skillPath);
	let content: string;
	try {
		content = Buffer.from(await vscode.workspace.fs.readFile(skillUri)).toString('utf8');
	} catch (error) {
		if (!isFileNotFound(error)) {
			throw error;
		}
		await downloadPlatformSkill(folder, skillPath);
		content = Buffer.from(await vscode.workspace.fs.readFile(skillUri)).toString('utf8');
	}
	if (!content.trim()) {
		throw new Error('The local Skill is empty.');
	}
	if (content.length > maxSkillCharacters) {
		throw new Error(`The local Skill exceeds ${maxSkillCharacters} characters.`);
	}

	const sections = [content];
	let totalCharacters = content.length;
	for (const reference of extractMarkdownReferences(content)) {
		const referencePath = path.resolve(path.dirname(skillPath), reference);
		if (!isInsideWorkspace(referencePath, folder)) {
			throw new Error(`Skill reference must stay inside the workspace: ${reference}`);
		}
		const referenceContent = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(referencePath))).toString('utf8');
		totalCharacters += referenceContent.length;
		if (totalCharacters > maxSkillBundleCharacters) {
			throw new Error(`Skill and references exceed ${maxSkillBundleCharacters} characters.`);
		}
		sections.push(`\n\n<skill_reference path="${path.relative(folder.uri.fsPath, referencePath)}">\n${referenceContent}\n</skill_reference>`);
	}

	return {
		source: path.relative(folder.uri.fsPath, skillPath),
		content: sections.join(''),
	};
}