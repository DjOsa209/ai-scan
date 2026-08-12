import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { findGitRoot } from './gitChanges';
import { isScannableSourcePath } from './sourceFilter';

const execFileAsync = promisify(execFile);

function normalizePath(value: string): string {
	return value.split(path.sep).join('/');
}

async function fingerprint(filePath: string): Promise<string | undefined> {
	try {
		const contents = await fs.readFile(filePath);
		return createHash('sha256').update(contents).digest('hex');
	} catch {
		return undefined;
	}
}

async function canonicalPath(filePath: string): Promise<string> {
	try {
		return await fs.realpath(filePath);
	} catch {
		return path.join(await fs.realpath(path.dirname(filePath)), path.basename(filePath));
	}
}

export class WorkspaceSourceBaseline {
	private constructor(
		readonly gitRoot: string,
		private readonly fingerprints: ReadonlyMap<string, string>,
	) {}

	static async capture(startPath: string): Promise<WorkspaceSourceBaseline> {
		const gitRoot = await findGitRoot(startPath);
		const { stdout } = await execFileAsync('git', ['-C', gitRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
			encoding: 'utf8',
			maxBuffer: 5 * 1024 * 1024,
		});
		const sourcePaths = stdout.split('\0').filter(isScannableSourcePath);
		const entries = await Promise.all(sourcePaths.map(async sourcePath => [
			normalizePath(sourcePath),
			await fingerprint(path.join(gitRoot, sourcePath)),
		] as const));
		return new WorkspaceSourceBaseline(gitRoot, new Map(entries.filter((entry): entry is readonly [string, string] => entry[1] !== undefined)));
	}

	async changedPath(filePath: string): Promise<string | undefined> {
		const relativePath = path.relative(this.gitRoot, await canonicalPath(filePath));
		if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			return undefined;
		}
		const normalized = normalizePath(relativePath);
		if (!isScannableSourcePath(normalized)) {
			return undefined;
		}
		const current = await fingerprint(filePath);
		const initial = this.fingerprints.get(normalized);
		return current !== initial && (current !== undefined || initial !== undefined) ? normalized : undefined;
	}
}