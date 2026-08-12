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
exports.maxPlatformSkillCharacters = void 0;
exports.platformSkillEndpoint = platformSkillEndpoint;
exports.validatePlatformSkill = validatePlatformSkill;
exports.fetchPlatformSkill = fetchPlatformSkill;
const crypto_1 = require("crypto");
const http = __importStar(require("http"));
const https = __importStar(require("https"));
exports.maxPlatformSkillCharacters = 100_000;
const requestTimeoutMilliseconds = 15_000;
function platformSkillEndpoint(baseUrl) {
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
function validatePlatformSkill(value) {
    if (!value || typeof value !== 'object') {
        throw new Error('The Skill platform returned an invalid response.');
    }
    const skill = value;
    if (typeof skill.skillId !== 'number' || !Number.isSafeInteger(skill.skillId) || skill.skillId <= 0
        || typeof skill.name !== 'string' || !skill.name.trim()
        || typeof skill.version !== 'string' || !skill.version.trim()
        || typeof skill.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(skill.sha256)
        || typeof skill.content !== 'string' || !skill.content.trim()
        || typeof skill.expiresAt !== 'string' || Number.isNaN(Date.parse(skill.expiresAt))) {
        throw new Error('The Skill platform returned incomplete Skill metadata.');
    }
    if (skill.content.length > exports.maxPlatformSkillCharacters) {
        throw new Error(`The platform Skill exceeds ${exports.maxPlatformSkillCharacters} characters.`);
    }
    const actualHash = (0, crypto_1.createHash)('sha256').update(skill.content).digest('hex');
    if (actualHash !== skill.sha256.toLowerCase()) {
        throw new Error('The platform Skill failed SHA-256 verification.');
    }
    return skill;
}
function fetchPlatformSkill(baseUrl, etag) {
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
            response.on('data', (chunk) => {
                body += chunk;
                if (body.length > exports.maxPlatformSkillCharacters * 2) {
                    response.destroy(new Error('The Skill platform response is too large.'));
                }
            });
            response.on('end', () => {
                try {
                    resolve({ status: 'resolved', etag: responseETag, skill: validatePlatformSkill(JSON.parse(body)) });
                }
                catch (error) {
                    reject(error);
                }
            });
            response.on('error', reject);
        });
        request.setTimeout(requestTimeoutMilliseconds, () => request.destroy(new Error('Skill platform request timed out.')));
        request.on('error', reject);
    });
}
//# sourceMappingURL=platformSkill.js.map