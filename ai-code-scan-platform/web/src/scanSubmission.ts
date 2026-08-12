import type { CreatePlatformScanInput } from './api';
import type { NewScanForm, ScanLevel } from './types';

type ScanSubmissionForm = Pick<NewScanForm,
  'project' | 'repositoryUrl' | 'repositoryToken' | 'branch' | 'commitId' | 'estimatedLines' | 'scanLevel' | 'priority'
  | 'excludes' | 'excludePatterns' | 'scanDirectories' | 'vulnerabilityTypes'> & Partial<Pick<NewScanForm, 'product'>>;

const levelExecution: Record<ScanLevel, Pick<CreatePlatformScanInput, 'mode' | 'scanLevel' | 'aiEnabled' | 'premiumModel'>> = {
  轻量体验: { mode: 'standard', scanLevel: 'lite', aiEnabled: false, premiumModel: false },
  标准检查: { mode: 'standard', scanLevel: 'standard', aiEnabled: true, premiumModel: false },
  发布审计: { mode: 'deep', scanLevel: 'release', aiEnabled: true, premiumModel: true },
};

function normalizeRules(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')).filter(Boolean))];
}

export function parseScanDirectories(value: string): string[] {
  return normalizeRules(value.split(/[,，\n]/));
}

export function buildPlatformScanInput(form: ScanSubmissionForm, product?: { id: number; name: string }): CreatePlatformScanInput {
  const execution = levelExecution[form.scanLevel];
  const repositoryToken = form.repositoryToken.trim();
  const productName = (product?.name ?? form.product ?? '').trim();
  return {
    projectName: form.project,
	...(product ? { productId: String(product.id) } : {}),
    ...(productName ? { productName } : {}),
    repositoryUrl: form.repositoryUrl,
    ...(repositoryToken ? { repositoryToken } : {}),
    gitRef: form.branch || form.commitId || 'main',
    estimatedLines: form.estimatedLines ?? 0,
    priority: form.priority === '加急' ? 'urgent' : 'normal',
    ...execution,
    excludeDirectories: normalizeRules(form.excludes),
    excludePatterns: normalizeRules(form.excludePatterns),
    scanDirectories: parseScanDirectories(form.scanDirectories),
    vulnerabilityTypes: normalizeRules(form.vulnerabilityTypes),
  };
}
