import { z } from "zod";
import type { JsonValue, RenderedMessage, TaskConfig } from "@llmeval/shared";
import { renderTemplate } from "./template.js";

const ChatMessagesSchema = z
  .array(
    z.object({
      role: z.enum(["system", "user", "assistant", "human", "ai"]),
      content: z.union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())]),
    }),
  )
  .min(1);

/**
 * Turn an item input plus task config into the message list sent to the model.
 * Rules (see docs/PLAN.md § 2.4):
 *  1. chat-message array → used as-is; systemPrompt prepended when none present; template ignored
 *  2. string → `{{input}}` in the template, or the string itself
 *  3. object → template rendered with dot paths; without template the object is JSON-stringified
 */
export function buildMessages(
  config: Pick<TaskConfig, "systemPrompt" | "userTemplate">,
  input: JsonValue,
): { messages: RenderedMessage[]; warnings: string[] } {
  const warnings: string[] = [];
  const messages: RenderedMessage[] = [];
  const system = config.systemPrompt ? renderTemplate(config.systemPrompt, input) : null;
  if (system?.missing.length) warnings.push(`systemPrompt: missing ${system.missing.join(", ")}`);

  const chat = Array.isArray(input) ? ChatMessagesSchema.safeParse(input) : null;
  if (chat?.success) {
    if (config.userTemplate) warnings.push("userTemplate ignored for chat-message input");
    const hasSystem = chat.data.some((m) => m.role === "system");
    if (system && !hasSystem) messages.push({ role: "system", content: system.text });
    for (const m of chat.data) {
      const role = m.role === "human" ? "user" : m.role === "ai" ? "assistant" : m.role;
      messages.push({ role, content: m.content as JsonValue });
    }
    return { messages, warnings };
  }

  if (system) messages.push({ role: "system", content: system.text });
  let user: string;
  if (config.userTemplate) {
    const rendered = renderTemplate(config.userTemplate, input);
    if (rendered.missing.length)
      warnings.push(`userTemplate: missing ${rendered.missing.join(", ")}`);
    user = rendered.text;
  } else {
    user = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  }
  messages.push({ role: "user", content: user });
  return { messages, warnings };
}
