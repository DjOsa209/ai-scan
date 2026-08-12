import * as path from 'path';

const sourceExtensions = new Set([
	'.aspx', '.bash', '.c', '.cc', '.cfg', '.cjs', '.clj', '.cljs', '.conf', '.cpp', '.cs', '.cshtml',
	'.css', '.cxx', '.dart', '.env', '.erl', '.ex', '.exs', '.fs', '.fsx', '.go', '.gql', '.gradle',
	'.graphql', '.groovy', '.h', '.hcl', '.hh', '.hpp', '.hrl', '.htm', '.html', '.ini', '.java', '.js',
	'.json', '.jsp', '.jsx', '.kt', '.kts', '.less', '.lock', '.lua', '.mjs', '.php', '.properties', '.proto',
	'.ps1', '.py', '.rb', '.rs', '.scala', '.scss', '.sh', '.sol', '.sql', '.svelte', '.swift', '.tf',
	'.tfvars', '.toml', '.ts', '.tsx', '.vue', '.xml', '.yaml', '.yml', '.zsh',
]);

const excludedDirectories = new Set([
	'.git', '.idea', '.next', '.nuxt', '.svn', '.vscode', 'build', 'coverage', 'dist', 'generated',
	'node_modules', 'out', 'target', 'vendor',
]);

const sourceFileNames = new Set([
	'cargo.lock', 'cargo.toml', 'composer.json', 'composer.lock', 'dockerfile', 'gemfile', 'go.mod', 'go.sum',
	'jenkinsfile', 'makefile', 'package-lock.json', 'package.json', 'pnpm-lock.yaml', 'pom.xml', 'pyproject.toml',
	'rakefile', 'tsconfig.json', 'yarn.lock',
]);

export function isExcludedSourceDirectory(name: string): boolean {
	return excludedDirectories.has(name.toLowerCase());
}

function normalizedSegments(candidate: string): string[] {
	return candidate.replaceAll('\\', '/').replace(/^\.\//, '').split('/').filter(Boolean);
}

export function isScannableSourcePath(candidate: string): boolean {
	const segments = normalizedSegments(candidate);
	if (!segments.length || segments.some(segment => excludedDirectories.has(segment.toLowerCase()))) {
		return false;
	}
	const basename = segments.at(-1)?.toLowerCase() ?? '';
	if (sourceFileNames.has(basename)
		|| basename.startsWith('dockerfile')
		|| basename.startsWith('.env')
		|| /^requirements.*\.txt$/.test(basename)
		|| /^tsconfig.*\.json$/.test(basename)) {
		return true;
	}
	return sourceExtensions.has(path.posix.extname(basename));
}
