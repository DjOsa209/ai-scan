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
exports.activate = activate;
exports.deactivate = deactivate;
const promises_1 = require("fs/promises");
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const autoIncrementalScan_1 = require("./autoIncrementalScan");
const chatHistory_1 = require("./chatHistory");
const currentReport_1 = require("./currentReport");
const gitChanges_1 = require("./gitChanges");
const localSkill_1 = require("./localSkill");
const platformScan_1 = require("./platformScan");
const reportArtifact_1 = require("./reportArtifact");
const reportJson_1 = require("./reportJson");
const reportPanel_1 = require("./reportPanel");
const reviewService_1 = require("./reviewService");
const reviewWebview_1 = require("./reviewWebview");
const scanHistory_1 = require("./scanHistory");
const resultUri = vscode.Uri.parse('pi-sec-review:result.md');
const platformAccessKeySecret = 'piSecReview.platformAccessKey';
const legacyPlatformTokenSecret = 'piSecReview.platformToken';
async function getPlatformAccessKey(context) {
    const existing = await context.secrets.get(platformAccessKeySecret);
    if (existing) {
        return existing;
    }
    const key = await vscode.window.showInputBox({
        title: '首次扫描配置',
        prompt: '请输入扫描平台接入密钥。该密钥仅用于插件扫描接口，不使用网页登录鉴权。',
        placeHolder: '扫描接入密钥',
        password: true,
        ignoreFocusOut: true,
        validateInput: value => value.trim() ? undefined : '扫描接入密钥不能为空。',
    });
    if (key === undefined) {
        return undefined;
    }
    const normalized = key.trim();
    await context.secrets.store(platformAccessKeySecret, normalized);
    return normalized;
}
class ReviewResultProvider {
    changeEmitter = new vscode.EventEmitter();
    content = '# PI 安全审查报告\n\n尚未执行安全审查。\n';
    onDidChange = this.changeEmitter.event;
    dispose() {
        this.changeEmitter.dispose();
    }
    provideTextDocumentContent() {
        return this.content;
    }
    update(content) {
        this.content = content;
        this.changeEmitter.fire(resultUri);
    }
}
function waitForStageVisibility(token) {
    const delayMilliseconds = 1_000 + Math.floor(Math.random() * 2_001);
    return new Promise((resolve, reject) => {
        if (token.isCancellationRequested) {
            reject(new vscode.CancellationError());
            return;
        }
        let cancellation;
        const timer = setTimeout(() => {
            cancellation?.dispose();
            resolve();
        }, delayMilliseconds);
        cancellation = token.onCancellationRequested(() => {
            clearTimeout(timer);
            cancellation?.dispose();
            reject(new vscode.CancellationError());
        });
    });
}
async function executeReview(input) {
    const configuration = vscode.workspace.getConfiguration('piSecReview', input.folder.uri);
    const platformUrl = configuration.get('platformUrl', 'http://localhost:8081');
    const maxCharacters = configuration.get('maxContextCharacters', 120_000);
    const scanRoot = input.scanScope === 'full' ? input.reviewPath : await (0, gitChanges_1.findGitRoot)(input.reviewPath);
    const identity = input.scanScope === 'full'
        ? (0, gitChanges_1.getFullWorkspaceIdentity)(input.folder.name)
        : await (0, gitChanges_1.getRepositoryIdentity)(scanRoot, input.folder.name);
    const task = await (0, platformScan_1.createPlatformScan)(platformUrl, {
        projectName: input.folder.name,
        repositoryUrl: identity.repositoryUrl,
        gitRef: identity.gitRef,
    }, input.platformToken);
    let currentProgress = task.progress;
    const advance = async (stage) => {
        input.onStage(stage, task.id);
        await (0, platformScan_1.updatePlatformScan)(platformUrl, task.id, {
            status: stage.status,
            stage: stage.label,
            progress: stage.progress,
            statusMessage: stage.message,
        }, input.platformToken);
        currentProgress = stage.progress;
    };
    try {
        await advance({ status: 'indexing', label: '加载安全基线', progress: 10, message: '正在解析本地安全 Skill 与引用资料' });
        const skill = await (0, localSkill_1.readLocalSkill)(input.folder);
        await waitForStageVisibility(input.token);
        const collectionStage = input.scanScope === 'full'
            ? { status: 'indexing', label: '收集全量上下文', progress: 25, message: '正在收集工作区源码和项目配置' }
            : { status: 'indexing', label: '收集变更上下文', progress: 25, message: '正在收集 Git 变更、关联测试和项目配置' };
        await advance(collectionStage);
        const reviewContext = input.scanScope === 'full'
            ? await (0, gitChanges_1.collectFullWorkspaceContext)(scanRoot, maxCharacters)
            : await (0, gitChanges_1.collectWorkspaceContext)(scanRoot, maxCharacters, input.includedPaths);
        await waitForStageVisibility(input.token);
        await advance({ status: 'analyzing', label: '安全风险初筛', progress: 40, message: '正在识别高风险入口、敏感操作与信任边界' });
        await waitForStageVisibility(input.token);
        await advance({ status: 'analyzing', label: '深度安全审计', progress: 55, message: '正在验证跨文件调用链、数据流和漏洞可利用性' });
        const result = await input.reviewService.review(input.model, skill.content, reviewContext, scanRoot, input.token, input.onFragment, input.onAgentAction, input.userFocus);
        await advance({ status: 'normalizing', label: '漏洞去重与报告生成', progress: 88, message: '正在整理证据、过滤误报并生成中文报告' });
        (0, reportJson_1.validateReviewReportJson)(result.json);
        const report = (0, reportJson_1.parseReviewReportJson)(result.json);
        const evidencePaths = [...(0, reportJson_1.reportSourcePaths)(report), ...result.accessedFiles];
        const sourceSnapshot = input.scanScope === 'full'
            ? await (0, gitChanges_1.collectFullSourceSnapshot)(scanRoot, reviewContext, undefined, evidencePaths)
            : await (0, gitChanges_1.collectSourceSnapshot)(scanRoot, reviewContext, undefined, evidencePaths);
        const artifact = (0, reportArtifact_1.createLocalReportArtifact)({
            workspaceLabel: input.folder.name,
            skillPath: skill.source,
            reportJson: result.json,
        });
        await (0, platformScan_1.uploadPlatformScanReport)(platformUrl, task.id, artifact, sourceSnapshot, result.tokenUsage, input.platformToken);
        await advance({ status: 'completed', label: '扫描完成', progress: 100, message: '中文安全审查报告已在 VS Code 本地生成并匿名上传' });
        return { artifact, taskId: task.id };
    }
    catch (error) {
        try {
            await (0, platformScan_1.updatePlatformScan)(platformUrl, task.id, {
                status: 'failed', stage: '扫描失败', progress: currentProgress, statusMessage: errorMessage(error).slice(0, 500),
            }, input.platformToken);
        }
        catch {
            // Preserve the original review failure.
        }
        throw error;
    }
}
function resolveWorkspaceFolder(resource) {
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
function errorMessage(error) {
    if (error instanceof vscode.LanguageModelError) {
        return `Language model request failed: ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
}
async function revealReviewView() {
    await vscode.commands.executeCommand('piSecReview.view.focus');
}
async function revealResultsPanel() {
    await vscode.commands.executeCommand('piSecReview.resultsView.focus');
}
async function openFindingLocation(location) {
    // codex-security: allow SEC-DYNAMIC-EVAL-001 — RegExp.exec only parses a file:line string; it does not execute code.
    const match = /^(.+):(\d+)(?::(\d+))?$/.exec(location.trim().replace(/^`|`$/g, ''));
    const folder = resolveWorkspaceFolder();
    if (!folder || !match) {
        void vscode.window.showWarningMessage(`无法定位安全发现：${location}`);
        return;
    }
    try {
        const workspaceRoot = await (0, promises_1.realpath)(folder.uri.fsPath);
        const candidate = await (0, promises_1.realpath)(path.resolve(workspaceRoot, match[1]));
        const relation = path.relative(workspaceRoot, candidate);
        if (relation.startsWith('..') || path.isAbsolute(relation)) {
            void vscode.window.showWarningMessage('安全发现只能打开当前工作区内的文件。');
            return;
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(candidate));
        const line = Math.max(0, Number.parseInt(match[2], 10) - 1);
        const character = Math.max(0, Number.parseInt(match[3] ?? '1', 10) - 1);
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const targetLine = Math.min(line, Math.max(0, document.lineCount - 1));
        const position = new vscode.Position(targetLine, Math.min(character, document.lineAt(targetLine).text.length));
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
    catch {
        void vscode.window.showWarningMessage(`无法打开安全发现位置：${location}`);
    }
}
async function chooseLanguageModel() {
    const models = await vscode.lm.selectChatModels();
    if (!models.length) {
        throw new Error('No VS Code language model is available. Configure a model provider or sign in to GitHub Copilot.');
    }
    if (models.length === 1) {
        return models[0];
    }
    const selected = await vscode.window.showQuickPick(models.map(model => ({
        label: model.name,
        description: `${model.vendor} · ${model.family}`,
        model,
    })), { title: 'Select the VS Code model for this security review', placeHolder: 'Language model' });
    return selected?.model;
}
async function activate(context) {
    const output = vscode.window.createOutputChannel('PI Security Review');
    const reviewView = new reviewWebview_1.ReviewWebviewProvider();
    const reportPanel = new reportPanel_1.ReviewReportPanelProvider(reviewView);
    const resultProvider = new ReviewResultProvider();
    const reviewService = new reviewService_1.ReviewService(output);
    const scanHistory = new scanHistory_1.LocalScanHistoryStore(context.globalStorageUri);
    let lastArtifact;
    const showResult = async (folder, artifact, taskId, replacedPaths) => {
        let currentArtifact = artifact;
        let previousReport;
        let previousGeneratedAt = '';
        let storedLocally = false;
        let historyEntries = [];
        try {
            if (replacedPaths?.size) {
                const history = await scanHistory.load(folder.uri);
                const latest = history.scans[0];
                if (latest) {
                    const merged = (0, currentReport_1.mergeIncrementalReport)((0, reportJson_1.parseReviewReportJson)(latest.reportJson), (0, reportJson_1.parseReviewReportJson)(artifact.reportJson), replacedPaths);
                    currentArtifact = { ...artifact, reportJson: (0, currentReport_1.stringifyReviewReport)(merged) };
                }
            }
            const record = await scanHistory.record(folder.uri, currentArtifact, taskId);
            if (record.previous) {
                previousReport = (0, reportJson_1.parseReviewReportJson)(record.previous.reportJson);
                previousGeneratedAt = record.previous.generatedAt;
            }
            storedLocally = true;
            const history = await scanHistory.load(folder.uri);
            historyEntries = history.scans.map(scan => ({
                reportId: scan.reportId,
                generatedAt: scan.generatedAt,
                taskId: scan.taskId,
                counts: (0, reportJson_1.parseReviewReportJson)(scan.reportJson).counts,
            }));
            output.appendLine(`Local scan history saved: ${record.storageUri.fsPath}`);
        }
        catch (error) {
            output.appendLine(`Failed to save local scan history: ${errorMessage(error)}`);
            void vscode.window.showWarningMessage('扫描已完成，但本机扫描历史保存失败。可在 PI Security Review 输出中查看原因。');
        }
        lastArtifact = currentArtifact;
        resultProvider.update((0, reportArtifact_1.renderLocalReport)(currentArtifact));
        reviewView.setReport(currentArtifact, taskId, { previousReport, previousGeneratedAt, storedLocally, historyEntries });
    };
    context.subscriptions.push(output, reviewView, reportPanel, resultProvider, vscode.window.registerWebviewViewProvider('piSecReview.view', reviewView), vscode.window.registerWebviewViewProvider('piSecReview.resultsView', reportPanel), vscode.workspace.registerTextDocumentContentProvider('pi-sec-review', resultProvider));
    context.subscriptions.push(vscode.commands.registerCommand('pi-sec-review.openLastResult', async () => {
        const document = await vscode.workspace.openTextDocument(resultUri);
        await vscode.window.showTextDocument(document, { preview: false });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('pi-sec-review.exportLastResult', async () => {
        if (!lastArtifact) {
            void vscode.window.showInformationMessage('尚未生成可导出的安全扫描报告。');
            return;
        }
        const defaultDirectory = vscode.workspace.workspaceFolders?.[0]?.uri;
        const destination = await vscode.window.showSaveDialog({
            defaultUri: defaultDirectory ? vscode.Uri.joinPath(defaultDirectory, `pi-security-report-${lastArtifact.reportId}.md`) : undefined,
            filters: { Markdown: ['md'] },
            saveLabel: '导出安全报告',
            title: '导出本地安全扫描报告',
        });
        if (!destination) {
            return;
        }
        await vscode.workspace.fs.writeFile(destination, Buffer.from((0, reportArtifact_1.renderLocalReport)(lastArtifact), 'utf8'));
        void vscode.window.showInformationMessage(`安全报告已导出到 ${destination.fsPath}`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('pi-sec-review.openFinding', openFindingLocation));
    context.subscriptions.push(vscode.commands.registerCommand('pi-sec-review.openHistoryResult', async (reportId) => {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const history = await scanHistory.load(folder.uri);
            const selectedIndex = history.scans.findIndex(scan => scan.reportId === reportId);
            if (selectedIndex < 0) {
                continue;
            }
            const selected = history.scans[selectedIndex];
            const previous = history.scans[selectedIndex + 1];
            const artifact = (0, scanHistory_1.artifactFromSnapshot)(selected);
            lastArtifact = artifact;
            resultProvider.update((0, reportArtifact_1.renderLocalReport)(artifact));
            reviewView.setReport(artifact, selected.taskId, {
                previousReport: previous ? (0, reportJson_1.parseReviewReportJson)(previous.reportJson) : undefined,
                previousGeneratedAt: previous?.generatedAt,
                storedLocally: true,
                restored: true,
                historyEntries: history.scans.map(scan => ({
                    reportId: scan.reportId,
                    generatedAt: scan.generatedAt,
                    taskId: scan.taskId,
                    counts: (0, reportJson_1.parseReviewReportJson)(scan.reportJson).counts,
                })),
            });
            return;
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('pi-sec-review.setPlatformToken', async () => {
        const token = await vscode.window.showInputBox({ title: '配置扫描接入密钥', prompt: '密钥仅用于插件扫描接口，并保存在 VS Code SecretStorage 中', password: true, ignoreFocusOut: true });
        if (token !== undefined) {
            const normalized = token.trim();
            if (!normalized) {
                await context.secrets.delete(platformAccessKeySecret);
                await context.secrets.delete(legacyPlatformTokenSecret);
                void vscode.window.showInformationMessage('扫描接入密钥已清除。');
                return;
            }
            const resource = vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
            const platformUrl = vscode.workspace.getConfiguration('piSecReview', resource).get('platformUrl', 'http://localhost:8081');
            try {
                await (0, platformScan_1.validatePlatformAccessKey)(platformUrl, normalized);
            }
            catch (error) {
                void vscode.window.showErrorMessage(errorMessage(error));
                return;
            }
            await context.secrets.store(platformAccessKeySecret, normalized);
            await context.secrets.delete(legacyPlatformTokenSecret);
            void vscode.window.showInformationMessage(`扫描接入密钥已通过 ${new URL(platformUrl).origin} 验证并保存。`);
        }
    }));
    const chatParticipant = vscode.chat.createChatParticipant('pi-sec-review.chatParticipant', async (request, chatContext, stream, token) => {
        const folder = resolveWorkspaceFolder();
        if (!folder) {
            return;
        }
        try {
            const startsReview = request.command === 'review' || !chatContext.history.some(turn => turn instanceof vscode.ChatResponseTurn);
            if (!startsReview) {
                stream.progress('正在恢复审查上下文');
                const skill = await (0, localSkill_1.readLocalSkill)(folder);
                await reviewService.continueConversation(request.model, skill.content, (0, chatHistory_1.chatHistoryToMessages)(chatContext.history), request.prompt, folder.uri.fsPath, token, {
                    onFragment: fragment => stream.markdown(fragment),
                    onToolCall: () => stream.progress('正在补充跨文件安全证据'),
                });
                return { metadata: { kind: 'followup' } };
            }
            const platformToken = await getPlatformAccessKey(context);
            if (!platformToken) {
                stream.markdown('已取消扫描：首次扫描需要配置扫描平台接入密钥。');
                return;
            }
            await revealReviewView();
            reviewView.begin(folder.name);
            await revealResultsPanel();
            output.clear();
            output.appendLine(`Reviewing workspace from Chat: ${folder.uri.fsPath}`);
            const { artifact, taskId } = await executeReview({
                folder, reviewPath: folder.uri.fsPath, scanScope: 'incremental', model: request.model, token, reviewService, platformToken,
                onStage: stage => {
                    reviewView.setStage(stage, taskId);
                    stream.progress(`${stage.label} · ${stage.progress}% · ${stage.message}`);
                },
                onFragment: fragment => stream.markdown(fragment),
                onAgentAction: () => stream.progress('正在补充跨文件安全证据'),
                userFocus: request.prompt,
            });
            await showResult(folder, artifact, taskId);
            stream.markdown(`\n\n---\n平台任务：\`${taskId}\` · 已完成并生成中文报告。`);
            stream.button({ command: 'pi-sec-review.openLastResult', title: '打开本地报告' });
            return { metadata: { kind: 'review', taskId } };
        }
        catch (error) {
            if (error instanceof gitChanges_1.NoChangesError) {
                reviewView.setStatus('ready', '没有需要审查的 Git 变更');
                stream.markdown(error.message);
                return;
            }
            reviewView.setStatus('error', 'Agent 请求失败');
            throw error;
        }
    });
    chatParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'shield.svg');
    chatParticipant.followupProvider = {
        provideFollowups: result => result.metadata?.kind === 'review' ? [
            { prompt: '解释最高风险问题及其可利用前提', label: '解释最高风险' },
            { prompt: '复核报告中的证据并指出可能的误报', label: '复核误报' },
        ] : [],
    };
    context.subscriptions.push(chatParticipant);
    const runReviewCommand = async (scanScope, resource) => {
        const folder = resolveWorkspaceFolder(resource);
        if (!folder) {
            return;
        }
        const reviewPath = scanScope === 'full'
            ? folder.uri.fsPath
            : resource?.scheme === 'file' ? resource.fsPath : folder.uri.fsPath;
        const platformToken = await getPlatformAccessKey(context);
        if (!platformToken) {
            return;
        }
        await revealReviewView();
        reviewView.begin(folder.name);
        await revealResultsPanel();
        output.clear();
        output.appendLine(`Reviewing workspace (${scanScope}): ${reviewPath}`);
        try {
            const model = await chooseLanguageModel();
            if (!model) {
                reviewView.setStatus('ready', '已取消扫描');
                return;
            }
            const { artifact, taskId } = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `PI Security Review · ${scanScope === 'full' ? '全量扫描' : '增量扫描'}`,
                cancellable: true,
            }, async (progress, token) => {
                return executeReview({
                    folder, reviewPath, scanScope, model, token, reviewService, platformToken,
                    onStage: (stage, currentTaskId) => {
                        reviewView.setStage(stage, currentTaskId);
                        progress.report({ message: `${stage.label} · ${stage.progress}%` });
                    },
                });
            });
            await showResult(folder, artifact, taskId);
            await vscode.commands.executeCommand('pi-sec-review.openLastResult');
        }
        catch (error) {
            if (error instanceof gitChanges_1.NoChangesError) {
                reviewView.setStatus('ready', '没有需要审查的 Git 变更');
                void vscode.window.showInformationMessage(error.message);
                return;
            }
            const message = errorMessage(error);
            output.appendLine(message);
            reviewView.setStatus('error', message);
            void vscode.window.showErrorMessage(`PI Security Review: ${message}`, 'Show Output').then(selection => {
                if (selection === 'Show Output') {
                    output.show();
                }
            });
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand('pi-sec-review.runReview', (resource) => runReviewCommand('incremental', resource)), vscode.commands.registerCommand('pi-sec-review.runFullReview', (resource) => runReviewCommand('full', resource)), vscode.commands.registerCommand('pi-sec-review.runIncrementalReview', (resource) => runReviewCommand('incremental', resource)));
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const configuration = vscode.workspace.getConfiguration('piSecReview', folder.uri);
        if (!configuration.get('autoIncrementalScan.enabled', true)) {
            continue;
        }
        try {
            const baseline = await autoIncrementalScan_1.WorkspaceSourceBaseline.capture(folder.uri.fsPath);
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
            let pendingPaths = new Set();
            let debounceTimer;
            let running = false;
            const schedule = () => {
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }
                const seconds = configuration.get('autoIncrementalScan.debounceSeconds', 5);
                debounceTimer = setTimeout(() => void runAutomaticScan(), Math.max(1, seconds) * 1_000);
            };
            const runAutomaticScan = async () => {
                debounceTimer = undefined;
                if (running || pendingPaths.size === 0) {
                    return;
                }
                const includedPaths = pendingPaths;
                pendingPaths = new Set();
                running = true;
                const cancellation = new vscode.CancellationTokenSource();
                try {
                    const platformToken = await context.secrets.get(platformAccessKeySecret);
                    const models = await vscode.lm.selectChatModels();
                    if (!platformToken || !models.length) {
                        output.appendLine('Automatic incremental scan skipped: configure a platform access key and VS Code language model.');
                        return;
                    }
                    output.appendLine(`Automatic incremental scan: ${[...includedPaths].join(', ')}`);
                    reviewView.begin(folder.name);
                    const { artifact, taskId } = await executeReview({
                        folder,
                        reviewPath: baseline.gitRoot,
                        scanScope: 'incremental',
                        model: models[0],
                        token: cancellation.token,
                        reviewService,
                        platformToken,
                        includedPaths,
                        onStage: (stage, taskId) => reviewView.setStage(stage, taskId),
                    });
                    await showResult(folder, artifact, taskId, includedPaths);
                }
                catch (error) {
                    if (error instanceof gitChanges_1.NoChangesError) {
                        reviewView.setStatus('ready', '打开项目后没有新的代码变更');
                    }
                    else {
                        output.appendLine(`Automatic incremental scan failed: ${errorMessage(error)}`);
                        reviewView.setStatus('error', `自动增量扫描失败：${errorMessage(error)}`);
                    }
                }
                finally {
                    cancellation.dispose();
                    running = false;
                    if (pendingPaths.size > 0) {
                        schedule();
                    }
                }
            };
            const recordChange = async (uri) => {
                const changedPath = await baseline.changedPath(uri.fsPath);
                if (changedPath) {
                    pendingPaths.add(changedPath);
                    schedule();
                }
            };
            context.subscriptions.push(watcher, watcher.onDidCreate(uri => void recordChange(uri)), watcher.onDidChange(uri => void recordChange(uri)), watcher.onDidDelete(uri => void recordChange(uri)), new vscode.Disposable(() => debounceTimer && clearTimeout(debounceTimer)));
            output.appendLine(`Automatic incremental scan enabled for ${baseline.gitRoot}`);
        }
        catch (error) {
            output.appendLine(`Automatic incremental scan disabled for ${folder.uri.fsPath}: ${errorMessage(error)}`);
        }
    }
    const initialFolder = vscode.workspace.workspaceFolders?.[0];
    if (initialFolder) {
        const history = await scanHistory.load(initialFolder.uri);
        const latest = history.scans[0];
        if (latest) {
            const artifact = (0, scanHistory_1.artifactFromSnapshot)(latest);
            const previous = history.scans[1];
            lastArtifact = artifact;
            resultProvider.update((0, reportArtifact_1.renderLocalReport)(artifact));
            reviewView.setReport(artifact, latest.taskId, {
                previousReport: previous ? (0, reportJson_1.parseReviewReportJson)(previous.reportJson) : undefined,
                previousGeneratedAt: previous?.generatedAt,
                storedLocally: true,
                restored: true,
                historyEntries: history.scans.map(scan => ({
                    reportId: scan.reportId,
                    generatedAt: scan.generatedAt,
                    taskId: scan.taskId,
                    counts: (0, reportJson_1.parseReviewReportJson)(scan.reportJson).counts,
                })),
            });
        }
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map