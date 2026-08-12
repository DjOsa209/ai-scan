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
exports.extractMarkdownReferences = extractMarkdownReferences;
exports.unpackPlatformSkill = unpackPlatformSkill;
exports.readLocalSkill = readLocalSkill;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const platformSkill_1 = require("./platformSkill");
const maxSkillCharacters = 100_000;
const maxSkillBundleCharacters = 250_000;
function extractMarkdownReferences(content) {
    const references = new Set();
    const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of content.matchAll(markdownLink)) {
        const target = match[1].trim().split('#', 1)[0];
        if (target && target.toLowerCase().endsWith('.md') && !path.isAbsolute(target) && !target.includes('://')) {
            references.add(target);
        }
    }
    return [...references];
}
function unpackPlatformSkill(content) {
    const references = [];
    const embeddedReference = /\n*<skill_reference path="([^"]+)">\n([\s\S]*?)\n<\/skill_reference>/g;
    const skill = content.replace(embeddedReference, (_match, referencePath, referenceContent) => {
        references.push({ path: referencePath, content: referenceContent });
        return '';
    }).trimEnd() + '\n';
    return { skill, references };
}
function isInsideWorkspace(candidatePath, folder) {
    const relativePath = path.relative(folder.uri.fsPath, candidatePath);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}
function isInsideDirectory(candidatePath, directory) {
    const relativePath = path.relative(directory, candidatePath);
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}
function isFileNotFound(error) {
    return typeof error === 'object' && error !== null
        && 'code' in error
        && (error.code === 'FileNotFound' || error.code === 'ENOENT');
}
async function downloadPlatformSkill(folder, skillPath) {
    const platformUrl = vscode.workspace.getConfiguration('piSecReview', folder.uri)
        .get('platformUrl', 'http://localhost:8081');
    let response;
    try {
        response = await (0, platformSkill_1.fetchPlatformSkill)(platformUrl);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Local Skill was not found and the platform download failed: ${message}`);
    }
    if (response.status !== 'resolved') {
        throw new Error('Local Skill was not found and the Skill platform returned no content.');
    }
    const bundle = unpackPlatformSkill(response.skill.content);
    const skillDirectory = path.dirname(skillPath);
    const referencePaths = new Set();
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
async function readLocalSkill(folder) {
    const configuredPath = vscode.workspace.getConfiguration('piSecReview', folder.uri)
        .get('skillPath', '.github/skills/security-baseline-review/SKILL.md');
    const skillPath = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(folder.uri.fsPath, configuredPath);
    if (!isInsideWorkspace(skillPath, folder)) {
        throw new Error('The local Skill must stay inside the workspace.');
    }
    const skillUri = vscode.Uri.file(skillPath);
    let content;
    try {
        content = Buffer.from(await vscode.workspace.fs.readFile(skillUri)).toString('utf8');
    }
    catch (error) {
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
//# sourceMappingURL=localSkill.js.map