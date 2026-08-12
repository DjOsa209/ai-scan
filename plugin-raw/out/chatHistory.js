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
exports.chatHistoryToMessages = chatHistoryToMessages;
const vscode = __importStar(require("vscode"));
const maxHistoryCharacters = 80_000;
const maxHistoryTurns = 12;
function truncateHistoryText(value, limit) {
    if (value.length <= limit) {
        return value;
    }
    const marker = '\n\n[较早的会话内容已截断]\n\n';
    const available = Math.max(0, limit - marker.length);
    const headLength = Math.ceil(available * 0.6);
    return `${value.slice(0, headLength)}${marker}${value.slice(value.length - (available - headLength))}`;
}
function chatHistoryToMessages(history) {
    const turns = history.slice(-maxHistoryTurns);
    const messages = [];
    let remainingCharacters = maxHistoryCharacters;
    for (let index = turns.length - 1; index >= 0 && remainingCharacters > 0; index -= 1) {
        const turn = turns[index];
        let text = '';
        let role;
        if (turn instanceof vscode.ChatRequestTurn) {
            text = turn.prompt;
            role = vscode.LanguageModelChatMessageRole.User;
        }
        else {
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
//# sourceMappingURL=chatHistory.js.map