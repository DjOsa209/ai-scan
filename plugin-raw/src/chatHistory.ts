import * as vscode from 'vscode';

const maxHistoryCharacters = 80_000;
const maxHistoryTurns = 12;

function truncateHistoryText(value: string, limit: number): string {
	if (value.length <= limit) {
		return value;
	}
	const marker = '\n\n[较早的会话内容已截断]\n\n';
	const available = Math.max(0, limit - marker.length);
	const headLength = Math.ceil(available * 0.6);
	return `${value.slice(0, headLength)}${marker}${value.slice(value.length - (available - headLength))}`;
}

export function chatHistoryToMessages(history: vscode.ChatContext['history']): vscode.LanguageModelChatMessage[] {
	const turns = history.slice(-maxHistoryTurns);
	const messages: vscode.LanguageModelChatMessage[] = [];
	let remainingCharacters = maxHistoryCharacters;

	for (let index = turns.length - 1; index >= 0 && remainingCharacters > 0; index -= 1) {
		const turn = turns[index];
		let text = '';
		let role: vscode.LanguageModelChatMessageRole;
		if (turn instanceof vscode.ChatRequestTurn) {
			text = turn.prompt;
			role = vscode.LanguageModelChatMessageRole.User;
		} else {
			text = turn.response
				.filter(part => part instanceof vscode.ChatResponseMarkdownPart)
				.map(part => part.value.value)
				.join('');
			role = vscode.LanguageModelChatMessageRole.Assistant;
		}

		if (!text.trim()) {
			continue;
		}
		text = truncateHistoryText(text, remainingCharacters);
		remainingCharacters -= text.length;
		messages.unshift(role === vscode.LanguageModelChatMessageRole.User
			? vscode.LanguageModelChatMessage.User(text)
			: vscode.LanguageModelChatMessage.Assistant(text));
	}

	return messages;
}