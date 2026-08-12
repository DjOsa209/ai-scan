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
const assert = __importStar(require("assert"));
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const node_test_1 = require("node:test");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const gitChanges_1 = require("../gitChanges");
const autoIncrementalScan_1 = require("../autoIncrementalScan");
const sourceFilter_1 = require("../sourceFilter");
(0, node_test_1.test)('source upload includes code and security configuration but excludes unrelated content', () => {
    for (const candidate of ['src/app.ts', 'server/main.go', 'Dockerfile', 'config/application.yml', 'package-lock.json']) {
        assert.strictEqual((0, sourceFilter_1.isScannableSourcePath)(candidate), true, `${candidate} should be scanned`);
    }
    for (const candidate of ['README.md', 'docs/architecture.pdf', 'assets/logo.png', 'coverage/lcov.html', 'demo.mp4']) {
        assert.strictEqual((0, sourceFilter_1.isScannableSourcePath)(candidate), false, `${candidate} should be excluded`);
    }
});
(0, node_test_1.test)('workspace collection removes non-code files from status, diff and uploaded snapshot', async () => {
    const repositoryRoot = (0, fs_1.mkdtempSync)(path.join(os.tmpdir(), 'pi-source-filter-'));
    try {
        (0, child_process_1.execFileSync)('git', ['init'], { cwd: repositoryRoot });
        (0, child_process_1.execFileSync)('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot });
        (0, child_process_1.execFileSync)('git', ['config', 'user.name', 'Test'], { cwd: repositoryRoot });
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'app.ts'), 'export const version = 1;\n');
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'README.md'), '# Version 1\n');
        (0, child_process_1.execFileSync)('git', ['add', '.'], { cwd: repositoryRoot });
        (0, child_process_1.execFileSync)('git', ['commit', '-m', 'initial'], { cwd: repositoryRoot });
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'app.ts'), 'export const version = 2;\n');
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'README.md'), '# Version 2\n');
        const context = await (0, gitChanges_1.collectWorkspaceContext)(repositoryRoot, 100_000);
        const snapshot = await (0, gitChanges_1.collectSourceSnapshot)(repositoryRoot, context);
        assert.match(context.gitStatus, /app\.ts/);
        assert.doesNotMatch(context.gitStatus, /README/);
        assert.match(context.diff, /app\.ts/);
        assert.doesNotMatch(context.diff, /README/);
        assert.deepStrictEqual(snapshot.files.map(file => file.path), ['app.ts']);
    }
    finally {
        (0, fs_1.rmSync)(repositoryRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('incremental collection only includes paths changed after the workspace baseline', async () => {
    const repositoryRoot = (0, fs_1.mkdtempSync)(path.join(os.tmpdir(), 'pi-incremental-baseline-'));
    try {
        (0, child_process_1.execFileSync)('git', ['init'], { cwd: repositoryRoot });
        (0, child_process_1.execFileSync)('git', ['config', 'user.email', 'test@example.com'], { cwd: repositoryRoot });
        (0, child_process_1.execFileSync)('git', ['config', 'user.name', 'Test'], { cwd: repositoryRoot });
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'before.ts'), 'export const before = 1;\n');
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'after.ts'), 'export const after = 1;\n');
        (0, child_process_1.execFileSync)('git', ['add', '.'], { cwd: repositoryRoot });
        (0, child_process_1.execFileSync)('git', ['commit', '-m', 'initial'], { cwd: repositoryRoot });
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'before.ts'), 'export const before = 2;\n');
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'after.ts'), 'export const after = 2;\n');
        const context = await (0, gitChanges_1.collectWorkspaceContext)(repositoryRoot, 100_000, new Set(['after.ts']));
        assert.deepStrictEqual(context.files.filter(file => file.kind === 'changed').map(file => file.path), ['after.ts']);
        assert.match(context.gitStatus, /after\.ts/);
        assert.doesNotMatch(context.gitStatus, /before\.ts/);
        assert.match(context.diff, /after\.ts/);
        assert.doesNotMatch(context.diff, /before\.ts/);
    }
    finally {
        (0, fs_1.rmSync)(repositoryRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('workspace baseline ignores pre-existing changes and detects later edits', async () => {
    const repositoryRoot = (0, fs_1.mkdtempSync)(path.join(os.tmpdir(), 'pi-source-baseline-'));
    try {
        (0, child_process_1.execFileSync)('git', ['init'], { cwd: repositoryRoot });
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'app.ts'), 'export const version = 1;\n');
        const baseline = await autoIncrementalScan_1.WorkspaceSourceBaseline.capture(repositoryRoot);
        assert.strictEqual(await baseline.changedPath(path.join(repositoryRoot, 'app.ts')), undefined);
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'app.ts'), 'export const version = 2;\n');
        assert.strictEqual(await baseline.changedPath(path.join(repositoryRoot, 'app.ts')), 'app.ts');
        (0, fs_1.writeFileSync)(path.join(repositoryRoot, 'notes.md'), '# ignored\n');
        assert.strictEqual(await baseline.changedPath(path.join(repositoryRoot, 'notes.md')), undefined);
    }
    finally {
        (0, fs_1.rmSync)(repositoryRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('full workspace collection scans source files without a Git repository', async () => {
    const workspaceRoot = (0, fs_1.mkdtempSync)(path.join(os.tmpdir(), 'pi-full-source-'));
    const outsideRoot = (0, fs_1.mkdtempSync)(path.join(os.tmpdir(), 'pi-full-outside-'));
    try {
        (0, fs_1.mkdirSync)(path.join(workspaceRoot, 'src'));
        (0, fs_1.mkdirSync)(path.join(workspaceRoot, 'node_modules'));
        (0, fs_1.writeFileSync)(path.join(workspaceRoot, 'src', 'app.ts'), 'export const version = 1;\n');
        (0, fs_1.writeFileSync)(path.join(workspaceRoot, 'package.json'), '{"name":"fixture"}\n');
        (0, fs_1.writeFileSync)(path.join(workspaceRoot, 'README.md'), '# Fixture\n');
        (0, fs_1.writeFileSync)(path.join(workspaceRoot, 'node_modules', 'dependency.js'), 'throw new Error("excluded");\n');
        (0, fs_1.writeFileSync)(path.join(outsideRoot, 'secret.ts'), 'export const secret = true;\n');
        const context = await (0, gitChanges_1.collectFullWorkspaceContext)(workspaceRoot, 100_000);
        const snapshot = await (0, gitChanges_1.collectFullSourceSnapshot)(workspaceRoot, context, undefined, [
            path.relative(workspaceRoot, path.join(outsideRoot, 'secret.ts')),
        ]);
        assert.strictEqual(context.scanScope, 'full');
        assert.strictEqual(context.diff, '');
        assert.deepStrictEqual(context.files.map(file => file.path), ['package.json', 'src/app.ts']);
        assert.deepStrictEqual(snapshot.files.map(file => file.path), ['package.json', 'src/app.ts']);
        assert.doesNotMatch(context.gitStatus, /README|node_modules/);
    }
    finally {
        (0, fs_1.rmSync)(workspaceRoot, { recursive: true, force: true });
        (0, fs_1.rmSync)(outsideRoot, { recursive: true, force: true });
    }
});
//# sourceMappingURL=sourceFiltering.test.js.map