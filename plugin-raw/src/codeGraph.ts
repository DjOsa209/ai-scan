import * as path from 'path';
import * as ts from 'typescript';

const maxProgramFiles = 1_000;
const maxCallEdges = 200;

export interface CodeGraphLocation {
	readonly path: string;
	readonly line: number;
	readonly symbol: string;
}

export interface CodeGraphCallEdge {
	readonly caller: CodeGraphLocation;
	readonly callee: CodeGraphLocation;
	readonly expression: string;
}

export interface TypeScriptCodeGraph {
	readonly method: 'typescript-compiler-api';
	readonly analyzedFiles: number;
	readonly changedFiles: readonly string[];
	readonly callEdges: readonly CodeGraphCallEdge[];
	readonly limitations: readonly string[];
}

function normalizePath(value: string): string {
	return value.split(path.sep).join('/');
}

function workspaceLocation(rootPath: string, node: ts.Node, symbol: string): CodeGraphLocation | undefined {
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

function enclosingSymbol(node: ts.Node): string {
	for (let current: ts.Node | undefined = node; current; current = current.parent) {
		if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isFunctionExpression(current) || ts.isClassDeclaration(current)) && current.name) {
			return current.name.getText();
		}
		if (ts.isArrowFunction(current) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
			return current.parent.name.text;
		}
	}
	return '<module>';
}

function resolvedDeclaration(checker: ts.TypeChecker, call: ts.CallExpression): ts.Declaration | undefined {
	const signatureDeclaration = checker.getResolvedSignature(call)?.declaration;
	if (signatureDeclaration) {
		return signatureDeclaration;
	}
	const symbol = checker.getSymbolAtLocation(call.expression);
	const resolvedSymbol = symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
	return resolvedSymbol?.declarations?.[0];
}

export function collectTypeScriptCodeGraph(rootPath: string, repositoryPaths: readonly string[], changedPaths: ReadonlySet<string>, maxCharacters: number): TypeScriptCodeGraph | undefined {
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
	const callEdges: CodeGraphCallEdge[] = [];
	const seen = new Set<string>();
	let callEdgeCharacters = 0;

	for (const relativePath of changedSourcePaths) {
		const sourceFile = program.getSourceFile(path.join(rootPath, relativePath));
		if (!sourceFile) {
			continue;
		}
		const visit = (node: ts.Node): void => {
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