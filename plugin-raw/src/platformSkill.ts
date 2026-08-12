import { createHash } from 'crypto';
import * as http from 'http';
import * as https from 'https';

export const maxPlatformSkillCharacters = 100_000;
const requestTimeoutMilliseconds = 15_000;

export interface PlatformSkill {
	readonly skillId: number;
	readonly name: string;
	readonly version: string;
	readonly sha256: string;
	readonly content: string;
	readonly expiresAt: string;
}

export type PlatformSkillResponse =
	| { readonly status: 'not-modified'; readonly etag?: string }
	| { readonly status: 'resolved'; readonly etag?: string; readonly skill: PlatformSkill };

export function platformSkillEndpoint(baseUrl: string): URL {
	const url = new URL('/api/v1/plugin/skills/resolve', baseUrl.trim());
	const isLocalDevelopment = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
	if (url.protocol !== 'https:' && !isLocalDevelopment) {
		throw new Error('The Skill platform must use HTTPS outside local development.');
	}
	if (url.username || url.password) {
		throw new Error('The Skill platform URL must not contain credentials.');
	}
	return url;
}

export function validatePlatformSkill(value: unknown): PlatformSkill {
	if (!value || typeof value !== 'object') {
		throw new Error('The Skill platform returned an invalid response.');
	}
	const skill = value as Record<string, unknown>;
	if (typeof skill.skillId !== 'number' || !Number.isSafeInteger(skill.skillId) || skill.skillId <= 0
		|| typeof skill.name !== 'string' || !skill.name.trim()
		|| typeof skill.version !== 'string' || !skill.version.trim()
		|| typeof skill.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(skill.sha256)
		|| typeof skill.content !== 'string' || !skill.content.trim()
		|| typeof skill.expiresAt !== 'string' || Number.isNaN(Date.parse(skill.expiresAt))) {
		throw new Error('The Skill platform returned incomplete Skill metadata.');
	}
	if (skill.content.length > maxPlatformSkillCharacters) {
		throw new Error(`The platform Skill exceeds ${maxPlatformSkillCharacters} characters.`);
	}
	const actualHash = createHash('sha256').update(skill.content).digest('hex');
	if (actualHash !== skill.sha256.toLowerCase()) {
		throw new Error('The platform Skill failed SHA-256 verification.');
	}
	return skill as unknown as PlatformSkill;
}

export function fetchPlatformSkill(baseUrl: string, etag?: string): Promise<PlatformSkillResponse> {
	const endpoint = platformSkillEndpoint(baseUrl);
	const transport = endpoint.protocol === 'https:' ? https : http;
	return new Promise((resolve, reject) => {
		const request = transport.get(endpoint, {
			headers: {
				Accept: 'application/json',
				...(etag ? { 'If-None-Match': etag } : {}),
				'User-Agent': 'pi-sec-review-vscode',
			},
		}, response => {
			const responseETag = typeof response.headers.etag === 'string' ? response.headers.etag : undefined;
			if (response.statusCode === 304) {
				response.resume();
				resolve({ status: 'not-modified', etag: responseETag ?? etag });
				return;
			}
			if (response.statusCode !== 200) {
				response.resume();
				reject(new Error(`Skill platform request failed with HTTP ${response.statusCode ?? 'unknown'}.`));
				return;
			}

			response.setEncoding('utf8');
			let body = '';
			response.on('data', (chunk: string) => {
				body += chunk;
				if (body.length > maxPlatformSkillCharacters * 2) {
					response.destroy(new Error('The Skill platform response is too large.'));
				}
			});
			response.on('end', () => {
				try {
					resolve({ status: 'resolved', etag: responseETag, skill: validatePlatformSkill(JSON.parse(body)) });
				} catch (error) {
					reject(error);
				}
			});
			response.on('error', reject);
		});
		request.setTimeout(requestTimeoutMilliseconds, () => request.destroy(new Error('Skill platform request timed out.')));
		request.on('error', reject);
	});
}
