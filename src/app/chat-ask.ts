/** Ask the chat panel a question from a screen or a schedule: it opens and answers (ADR 0023). */
export const CHAT_ASK = 'app:chat-ask';

export interface ChatAsk {
  question: string;
  /** Shown instead of "you" on the question: a schedule's name. */
  label?: string;
  /** A reminder: shown as a note, nothing is asked. */
  note?: boolean;
  /** Run with standing consent for AI calls (a schedule allowed to call the AI). */
  standing?: boolean;
  /** Told whether the chat took it (false when it was busy answering). */
  accepted?: (ok: boolean) => void;
}

export function askChat(question: string | ChatAsk): void {
  window.dispatchEvent(
    new CustomEvent<ChatAsk>(CHAT_ASK, {
      detail: typeof question === 'string' ? { question } : question,
    })
  );
}
