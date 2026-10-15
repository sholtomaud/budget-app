/** Ask the chat panel a question from a screen: it opens and answers (ADR 0023). */
export const CHAT_ASK = 'app:chat-ask';

export function askChat(question: string): void {
  window.dispatchEvent(new CustomEvent(CHAT_ASK, { detail: question }));
}
