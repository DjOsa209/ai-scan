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
exports.maxRemoteSkillCharacters = void 0;
exports.normalizeRemoteSkillUrl = normalizeRemoteSkillUrl;
exports.validateRemoteSkillContent = validateRemoteSkillContent;
exports.downloadRemoteSkill = downloadRemoteSkill;
const https = __importStar(require("https"));
exports.maxRemoteSkillCharacters = 100_000;
const maxRedirects = 5;
const requestTimeoutMilliseconds = 15_000;
function normalizeRemoteSkillUrl(input) {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:') {
        throw new Error('Remote skill URL must use HTTPS.');
    }
    if (url.username || url.password) {
        throw new Error('Remote skill URL must not contain credentials.');
    }
    const githubBlob = url.hostname === 'github.com'
        ? url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
        : undefined;
    if (githubBlob) {
        const [, owner, repository, revision, filePath] = githubBlob;
        return new URL(`https://raw.githubusercontent.com/${owner}/${repository}/${revision}/${filePath}`);
    }
    return url;
}
function validateRemoteSkillContent(content) {
    if (!content.trim()) {
        throw new Error('The downloaded skill is empty.');
    }
    if (content.length > exports.maxRemoteSkillCharacters) {
        throw new Error(`The downloaded skill exceeds ${exports.maxRemoteSkillCharacters} characters.`);
    }
    return content;
}
function download(url, redirectsRemaining) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: {
                Accept: 'text/markdown,text/plain;q=0.9,*/*;q=0.1',
                'User-Agent': 'pi-sec-review-vscode',
            },
        }, response => {
            const location = response.headers.location;
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
                response.resume();
                if (redirectsRemaining === 0) {
                    reject(new Error('Remote skill download exceeded the redirect limit.'));
                    return;
                }
                let redirectUrl;
                try {
                    redirectUrl = normalizeRemoteSkillUrl(new URL(location, url).toString());
                }
                catch (error) {
                    reject(error);
                    return;
                }
                void download(redirectUrl, redirectsRemaining - 1).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Remote skill download failed with HTTP ${response.statusCode ?? 'unknown'}.`));
                return;
            }
            response.setEncoding('utf8');
            let content = '';
            response.on('data', (chunk) => {
                content += chunk;
                if (content.length > exports.maxRemoteSkillCharacters) {
                    response.destroy(new Error(`The downloaded skill exceeds ${exports.maxRemoteSkillCharacters} characters.`));
                }
            });
            response.on('end', () => {
                try {
                    resolve(validateRemoteSkillContent(content));
                }
                catch (error) {
                    reject(error);
                }
            });
            response.on('error', reject);
        });
        request.setTimeout(requestTimeoutMilliseconds, () => {
            request.destroy(new Error('Remote skill download timed out.'));
        });
        request.on('error', reject);
    });
}
async function downloadRemoteSkill(input) {
    const url = normalizeRemoteSkillUrl(input);
    return {
        sourceUrl: url.toString(),
        content: await download(url, maxRedirects),
    };
}
//# sourceMappingURL=remoteSkill.js.map