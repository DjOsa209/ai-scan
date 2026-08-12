import * as https from 'https';

export const maxRemoteSkillCharacters = 100_000;
const maxRedirects = 5;
const requestTimeoutMilliseconds = 15_000;

export function normalizeRemoteSkillUrl(input: string): URL {
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

export function validateRemoteSkillContent(content: string): string {
	if (!content.trim()) {
		throw new Error('The downloaded skill is empty.');
	}
	if (content.length > maxRemoteSkillCharacters) {
		throw new Error(`The downloaded skill exceeds ${maxRemoteSkillCharacters} characters.`);
	}
	return content;
}

function download(url: URL, redirectsRemaining: number): Promise<string> {
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

				let redirectUrl: URL;
				try {
					redirectUrl = normalizeRemoteSkillUrl(new URL(location, url).toString());
				} catch (error) {
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
			response.on('data', (chunk: string) => {
				content += chunk;
				if (content.length > maxRemoteSkillCharacters) {
					response.destroy(new Error(`The downloaded skill exceeds ${maxRemoteSkillCharacters} characters.`));
				}
			});
			response.on('end', () => {
				try {
					resolve(validateRemoteSkillContent(content));
				} catch (error) {
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

export async function downloadRemoteSkill(input: string): Promise<{ sourceUrl: string; content: string }> {
	const url = normalizeRemoteSkillUrl(input);
	return {
		sourceUrl: url.toString(),
		content: await download(url, maxRedirects),
	};
}