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
exports.collectTypeScriptCodeGraph = collectTypeScriptCodeGraph;
const path = __importStar(require("path"));
const ts = __importStar(require("typescript"));
const maxProgramFiles = 1_000;
const maxCallEdges = 200;
function normalizePath(value) {
    return value.split(path.sep).join('/');
}
function workspaceLocation(rootPath, node, symbol) {
    const sourceFile = node.getSourceFile();
    const relativePath = path.relative(rootPath, sourceFile.fileName);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || relativePath.includes('node_modules')) {
        return undefined;
    }
    return {
        path: normalizePath(relativePath),
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        symbol,
    };
}
function enclosingSymbol(node) {
    for (let current = node; current; current = current.parent) {
        if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isFunctionExpression(current) || ts.isClassDeclaration(current)) && current.name) {
            return current.name.getText();
        }
        if (ts.isArrowFunction(current) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
            return current.parent.name.text;
        }
    }
    return '<module>';
}
function resolvedDeclaration(checker, call) {
    const signatureDeclaration = checker.getResolvedSignature(call)?.declaration;
    if (signatureDeclaration) {
        return signatureDeclaration;
    }
    const symbol = checker.getSymbolAtLocation(call.expression);
    const resolvedSymbol = symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
    return resolvedSymbol?.declarations?.[0];
}
function collectTypeScriptCodeGraph(rootPath, repositoryPaths, changedPaths, maxCharacters) {
    const sourcePaths = repositoryPaths
        .filter(filePath => /\.(?:[cm]?[jt]sx?)$/.test(filePath) && !filePath.endsWith('.d.ts'))
        .slice(0, maxProgramFiles);
    const changedSourcePaths = sourcePaths.filter(filePath => changedPaths.has(filePath));
    if (!changedSourcePaths.length) {
        return undefined;
    }
    const program = ts.createProgram(sourcePaths.map(filePath => path.join(rootPath, filePath)), {
        allowJs: true,
        checkJs: false,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
    });
    const checker = program.getTypeChecker();
    const callEdges = [];
    const seen = new Set();
    let callEdgeCharacters = 0;
    for (const relativePath of changedSourcePaths) {
        const sourceFile = program.getSourceFile(path.join(rootPath, relativePath));
        if (!sourceFile) {
            continue;
        }
        const visit = (node) => {
            if (callEdges.length >= maxCallEdges || callEdgeCharacters >= maxCharacters) {
                return;
            }
            if (ts.isCallExpression(node)) {
                const declaration = resolvedDeclaration(checker, node);
                const caller = workspaceLocation(rootPath, node, enclosingSymbol(node));
                const callee = declaration && workspaceLocation(rootPath, declaration, node.expression.getText(sourceFile));
                if (caller && callee) {
                    const edge = { caller, callee, expression: node.getText(sourceFile).slice(0, 500) };
                    const key = JSON.stringify(edge);
                    if (!seen.has(key) && callEdgeCharacters + key.length <= maxCharacters) {
                        seen.add(key);
                        callEdges.push(edge);
                        callEdgeCharacters += key.length;
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    return {
        method: 'typescript-compiler-api',
        analyzedFiles: sourcePaths.length,
        changedFiles: changedSourcePaths,
        callEdges,
        limitations: [
            '调用图仅表示 TypeScript 可解析的静态调用关系，不执行值流或污点传播。',
            '动态调用、反射、运行时依赖注入和超过采集上限的文件可能缺失。',
        ],
    };
}
//# sourceMappingURL=codeGraph.js.map