const internalNames: Array<[RegExp, string]> = [
  [/AI Security Agent/gi, '安全分析引擎'],
  [/AI Agent/gi, '安全分析引擎'],
  [/Fortify(?:\s+SCA)?/gi, '安全扫描引擎'],
  [/SonarQube/gi, '安全扫描引擎'],
  [/SecAgent(?:-[A-Za-z0-9]+)?/gi, '安全分析引擎'],
  [/\bSAST\b/gi, '代码安全检查'],
  [/\bSCA\b/gi, '依赖安全检查'],
];

export function sanitizeUserVisibleText(value: string): string {
  return internalNames.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function userVisibleStage(stage: string): string {
  const normalized = sanitizeUserVisibleText(stage).replace(/AI\s*深度审计/gi, '深度安全分析');
  return normalized || '等待处理';
}

export function isValidTimestamp(value?: string): value is string {
  return Boolean(value && !Number.isNaN(new Date(value).getTime()));
}
