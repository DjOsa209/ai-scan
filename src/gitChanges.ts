import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const gitBufferLimit = 5 * 1024 * 1024;
const untrackedFileLimit = 30_000;

export class NoChangesError extends Error {
	constructor() {
		super('The workspace has no uncommitted changes to review.');
		this.name = 'NoChangesError';
	}
}

async function runGit(rootPath: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', ['-C', rootPath, ...args], {
		encoding: 'utf8',
		maxBuffer: gitBufferLimit,
	});
	return stdout;
}

export async function findGitRoot(startPath: string): Promise<string> {
	let workingDirectory = startPath;
	try {
		if (!(await fs.stat(startPath)).isDirectory()) {
			workingDirectory = path.dirname(startPath);
		}
	} catch {
		workingDirectory = path.dirname(startPath);
	}

	return (await runGit(workingDirectory, ['rev-parse', '--show-toplevel'])).trim();
}

async function readUntrackedFiles(rootPath: string, names: string[]): Promise<string> {
	const sections: string[] = [];

	for (const name of names) {
		const fullPath = path.resolve(rootPath, name);
		const relativePath = path.relative(rootPath, fullPath);
		if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			continue;
		}

		try {
			const contents = await fs.readFile(fullPath);
			if (contents.includes(0)) {
				sections.push(`--- untracked: ${name}\n[binary file omitted]`);
				continue;
			}

			const text = contents.toString('utf8');
			const suffix = text.length > untrackedFileLimit
				? `\n[truncated ${text.length - untrackedFileLimit} characters]`
				: '';
			sections.push(`--- untracked: ${name}\n${text.slice(0, untrackedFileLimit)}${suffix}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			sections.push(`--- untracked: ${name}\n[unable to read: ${message}]`);
		}
	}

	return sections.join('\n\n');
}

export function truncateReviewInput(input: string, maxCharacters: number): string {
	if (input.length <= maxCharacters) {
		return input;
	}

	const omitted = input.length - maxCharacters;
	return `${input.slice(0, maxCharacters)}\n\n[review input truncated; ${omitted} characters omitted]`;
}

export async function collectWorkspaceChanges(rootPath: string, maxCharacters: number): Promise<string> {
	const gitRoot = await findGitRoot(rootPath);

	const [status, staged, unstaged, untrackedOutput] = await Promise.all([
		runGit(gitRoot, ['status', '--short']),
		runGit(gitRoot, ['diff', '--cached', '--no-ext-diff', '--no-color', '--unified=40', '--']),
		runGit(gitRoot, ['diff', '--no-ext-diff', '--no-color', '--unified=40', '--']),
		runGit(gitRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
	]);

	if (!status.trim()) {
		throw new NoChangesError();
	}

	const untrackedNames = untrackedOutput.split('\0').filter(Boolean);
	const untracked = await readUntrackedFiles(gitRoot, untrackedNames);
	const input = [
		`# Git status\n${status.trim()}`,
		staged.trim() ? `# Staged changes\n${staged.trim()}` : '',
		unstaged.trim() ? `# Unstaged changes\n${unstaged.trim()}` : '',
		untracked ? `# Untracked files\n${untracked}` : '',
	].filter(Boolean).join('\n\n');

	return truncateReviewInput(input, maxCharacters);
}