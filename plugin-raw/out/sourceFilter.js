"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExcludedSourceDirectory = isExcludedSourceDirectory;
exports.isScannableSourcePath = isScannableSourcePath;
const path = __importStar(require("path"));
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
function isExcludedSourceDirectory(name) {
    return excludedDirectories.has(name.toLowerCase());
}
function normalizedSegments(candidate) {
    return candidate.replaceAll('\\', '/').replace(/^\.\//, '').split('/').filter(Boolean);
}
function isScannableSourcePath(candidate) {
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
//# sourceMappingURL=sourceFilter.js.map