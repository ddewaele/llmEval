import { describe, expect, it } from "vitest";
import { buildMessages } from "./messages.js";
import { renderTemplate } from "./template.js";

describe("renderTemplate", () => {
  it("renders dot paths, json helper, string input and reports missing", () => {
    const r = renderTemplate("Hi {{customer.name}}: {{json codes}} {{missing}}", {
      customer: { name: "Ann" },
      codes: ["A", "B"],
    });
    expect(r.text).toBe('Hi Ann: ["A","B"] ');
    expect(r.missing).toEqual(["missing"]);
    expect(renderTemplate("Q: {{input}}", "what?").text).toBe("Q: what?");
    expect(renderTemplate("{{items.1}}", { items: ["a", "b"] }).text).toBe("b");
  });
});

describe("buildMessages", () => {
  const cfg = { systemPrompt: "You extract codes for {{tenant}}.", userTemplate: "Mail: {{body}}" };

  it("renders object input with system and user templates", () => {
    const { messages, warnings } = buildMessages(cfg, { tenant: "ACME", body: "5x ABC" });
    expect(messages).toEqual([
      { role: "system", content: "You extract codes for ACME." },
      { role: "user", content: "Mail: 5x ABC" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("stringifies objects without a template and passes strings through", () => {
    expect(buildMessages({ systemPrompt: null, userTemplate: null }, "hello").messages).toEqual([
      { role: "user", content: "hello" },
    ]);
    const { messages } = buildMessages({ systemPrompt: null, userTemplate: null }, { a: 1 });
    expect(messages[0]!.content).toBe('{\n  "a": 1\n}');
  });

  it("uses chat-message arrays as-is, prepending the system prompt and warning about templates", () => {
    const { messages, warnings } = buildMessages({ systemPrompt: "S", userTemplate: "T" }, [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "human", content: "second" },
    ]);
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(warnings).toEqual(["userTemplate ignored for chat-message input"]);
    expect(
      buildMessages(
        { systemPrompt: "S", userTemplate: null },
        {
          tenant: "x",
        },
      ).warnings,
    ).toEqual([]);
  });
});
