/**
 * Build the `history` array sent with a chat request from the on-screen transcript.
 *
 * Rules:
 *  - Only complete exchanges are included (a user message followed by its non-empty
 *    assistant reply), so a failed or unanswered prompt never leaks into later requests.
 *  - The most recent exchanges are kept, newest last, until either limit is reached.
 *    Exchanges are never split, so the model never sees a reply without its question.
 *  - Only `role` and `content` are forwarded.
 *
 * @param {Array<{ role: string, content?: string }>} messages the transcript, oldest first
 * @param {{ maxMessages: number, maxChars: number }} limits
 * @returns {Array<{ role: 'user'|'assistant', content: string }>}
 */
export function buildHistory(messages, { maxMessages, maxChars }) {
  const exchanges = [];
  for (let i = 0; i < messages.length - 1; i += 1) {
    const question = messages[i];
    const answer = messages[i + 1];
    if (
      question.role === "user" &&
      answer.role === "assistant" &&
      question.content &&
      answer.content
    ) {
      exchanges.push([
        { role: "user", content: question.content },
        { role: "assistant", content: answer.content },
      ]);
      i += 1; // the reply is consumed with its question
    }
  }

  const history = [];
  let chars = 0;
  for (let index = exchanges.length - 1; index >= 0; index -= 1) {
    const [question, answer] = exchanges[index];
    const size = question.content.length + answer.content.length;
    if (history.length + 2 > maxMessages || chars + size > maxChars) {
      break;
    }
    history.unshift(question, answer);
    chars += size;
  }
  return history;
}

export default { buildHistory };
