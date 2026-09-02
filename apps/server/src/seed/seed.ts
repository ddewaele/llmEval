import {
  AppError,
  type JsonObject,
  type JsonValue,
  type NewItem,
  type ScorerSpec,
} from "@llmeval/shared";
import type { Services } from "@llmeval/core";
import type { ScriptedAnswer, SeedModelFactory } from "./seed-model.js";

export const SEED_TAG = "sample";
export const SEED_MODEL = "seed:deterministic-v1";

export interface SeedResult {
  datasets: Array<{ id: string; name: string; items: number; version: number }>;
  runs: Array<{ id: string; name: string; datasetId: string; status: string }>;
  jobs: string[];
}

interface SeedItem {
  input: JsonValue;
  expected?: JsonValue;
  /** substring of the rendered prompt that identifies this item */
  match: string;
  good: JsonValue;
  regressed: JsonValue;
  expectedSource?: "human" | "imported" | "generated";
  tags?: string[];
}

const EMAIL_SCHEMA: JsonObject = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
};

const emailItems: SeedItem[] = [
  {
    input: {
      subject: "You won a prize!!!",
      body: "Claim your $1000 gift card now by clicking this link.",
    },
    expected: "spam",
    match: "$1000 gift card",
    good: "spam",
    regressed: "spam",
  },
  {
    input: {
      subject: "Do you have the X200 in stock?",
      body: "Hi, I'm looking for the X200 router, ideally in black. Do you sell it and what does it cost?",
    },
    expected: "product_search",
    match: "X200 router",
    good: "product_search",
    regressed: "product_search",
  },
  {
    input: {
      subject: "Invoice 2024-118 overdue",
      body: "Please find attached invoice 2024-118. Payment was due last week.",
    },
    expected: "invoice",
    match: "invoice 2024-118",
    good: "invoice",
    regressed: "support",
  },
  {
    input: {
      subject: "App keeps crashing",
      body: "Since the last update the mobile app crashes when I open my orders. Can you help?",
    },
    expected: "support",
    match: "crashes when I open my orders",
    good: "support",
    regressed: "support",
  },
  {
    input: {
      subject: "Re: pricing for 50 units",
      body: "Could you quote 50 units of the K7 sensor with delivery to Ghent?",
    },
    expected: "product_search",
    match: "50 units of the K7",
    good: "product_search",
    regressed: "support",
  },
  {
    input: {
      subject: "Password reset not working",
      body: "The reset link says it has expired even though I just requested it.",
    },
    expected: "support",
    match: "reset link says it has expired",
    good: "support",
    regressed: "support",
  },
  {
    input: {
      subject: "Your account statement",
      body: "Attached is your statement for August. Amount due: EUR 240.00.",
    },
    expected: "invoice",
    match: "statement for August",
    good: "invoice",
    regressed: "spam",
  },
  {
    input: {
      subject: "Limited offer: crypto doubling",
      body: "Send 1 BTC and receive 2 BTC back. Guaranteed. Act now.",
    },
    expected: "spam",
    match: "receive 2 BTC",
    good: "product_search",
    regressed: "spam",
  },
];

const CODES_SCHEMA: JsonObject = {
  type: "object",
  properties: { productCodes: { type: "array", items: { type: "string" } } },
  required: ["productCodes"],
};

const codeItems: SeedItem[] = [
  {
    input: { subject: "Order", body: "Please send 5 units of ABC-123 and 2 of XYZ-9." },
    expected: { productCodes: ["ABC-123", "XYZ-9"] },
    match: "5 units of ABC-123",
    good: { productCodes: ["ABC-123", "XYZ-9"] },
    regressed: { productCodes: ["ABC-123"] },
  },
  {
    input: { subject: "Stock question", body: "Do you still stock part DEF-456?" },
    expected: { productCodes: ["DEF-456"] },
    match: "part DEF-456",
    good: { productCodes: ["DEF-456"] },
    regressed: { productCodes: ["DEF-456"] },
  },
  {
    input: { subject: "Quote", body: "Quote for 10x GHI-777 and 3x GHI-778 please." },
    expected: { productCodes: ["GHI-777", "GHI-778"] },
    match: "10x GHI-777",
    good: { productCodes: ["GHI-777"] },
    regressed: { productCodes: ["GHI-777"] },
  },
  {
    input: { subject: "Thanks", body: "Thanks for the quick delivery last week!" },
    expected: { productCodes: [] },
    match: "quick delivery last week",
    good: { productCodes: [] },
    regressed: { productCodes: ["DELIVERY-1"] },
  },
  {
    input: {
      subject: "Replacement",
      body: "The JKL-001 we received is damaged; we need a replacement JKL-001 and the matching bracket JKL-001-B.",
    },
    expected: { productCodes: ["JKL-001", "JKL-001-B"] },
    match: "JKL-001 we received",
    good: { productCodes: ["JKL-001", "JKL-001-B", "JKL-1"] },
    regressed: { productCodes: ["JKL-001"] },
  },
  {
    input: { subject: "Reorder", body: "Same as last time: 20 x MNO-555." },
    expected: { productCodes: ["MNO-555"] },
    match: "20 x MNO-555",
    good: { productCodes: ["MNO-555"] },
    regressed: { productCodes: ["MNO-555"] },
  },
];

const SENTIMENT_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
    score: { type: "number", minimum: 0, maximum: 1, description: "Confidence in the label" },
  },
  required: ["sentiment", "score"],
};

const sentimentItems: SeedItem[] = [
  {
    input: "Absolutely love this keyboard, the keys feel great and it was easy to set up.",
    expected: { sentiment: "positive", score: 0.95 },
    match: "love this keyboard",
    good: { sentiment: "positive", score: 0.9 },
    regressed: { sentiment: "positive", score: 0.6 },
  },
  {
    input: "Stopped working after two weeks. Support never answered.",
    expected: { sentiment: "negative", score: 0.9 },
    match: "Stopped working after two weeks",
    good: { sentiment: "negative", score: 0.85 },
    regressed: { sentiment: "neutral", score: 0.5 },
  },
  {
    input: "It does what it says. Nothing special.",
    expected: { sentiment: "neutral", score: 0.7 },
    match: "Nothing special",
    good: { sentiment: "neutral", score: 0.75 },
    regressed: { sentiment: "positive", score: 0.55 },
  },
  {
    input: "Delivery was late but the product itself is fine.",
    expected: { sentiment: "neutral", score: 0.6 },
    match: "Delivery was late",
    good: { sentiment: "negative", score: 0.6 },
    regressed: { sentiment: "negative", score: 0.8 },
  },
  {
    input: "Best purchase this year, would buy again.",
    expected: { sentiment: "positive", score: 0.98 },
    match: "Best purchase this year",
    good: { sentiment: "positive", score: 0.97 },
    regressed: { sentiment: "positive", score: 0.97 },
    expectedSource: "generated",
  },
  {
    input: "Packaging was damaged and one part was missing.",
    match: "one part was missing",
    good: { sentiment: "negative", score: 0.9 },
    regressed: { sentiment: "negative", score: 0.9 },
  },
];

function toNewItems(items: SeedItem[]): NewItem[] {
  return items.map((i) => ({
    input: i.input,
    ...(i.expected !== undefined
      ? { expected: i.expected, expectedSource: i.expectedSource ?? "imported" }
      : {}),
    ...(i.expectedSource === "generated"
      ? { expectedRationale: "Drafted by the sample generator; review before publishing." }
      : {}),
    metadata: { source: "imported", tags: [SEED_TAG, ...(i.tags ?? [])] },
  }));
}

const toScript = (items: SeedItem[]): ScriptedAnswer[] =>
  items.map((i) => ({ match: i.match, good: i.good, regressed: i.regressed }));

/**
 * Insert three sample datasets with ground truths, published versions, completed runs (scored),
 * a re-scoring job and unreviewed / missing ground truths to exercise every screen. Requires
 * services built with a SeedModelFactory and ALLOW_UNLISTED_MODELS (the seed model is not a real
 * provider).
 */
export async function seedSampleData(
  services: Services,
  factory: SeedModelFactory,
  opts: { reset?: boolean } = {},
): Promise<SeedResult> {
  const existing = (await services.datasets.list({ includeArchived: true })).filter((d) =>
    d.tags.includes(SEED_TAG),
  );
  if (existing.length > 0) {
    if (!opts.reset) {
      throw new AppError(
        "CONFLICT",
        `Sample data already present (${existing.map((d) => d.name).join(", ")}); run with --reset to replace it`,
      );
    }
    for (const d of existing) await services.datasets.delete(d.id, { force: true });
  }
  factory.script([...toScript(emailItems), ...toScript(codeItems), ...toScript(sentimentItems)]);
  const result: SeedResult = { datasets: [], runs: [], jobs: [] };

  // ---- 1. Email classification: two prompt variants to compare ------------------------------
  const email = await services.datasets.create({
    name: "Email classification (sample)",
    description: "Route incoming customer emails to the right queue.",
    tags: [SEED_TAG, "classification"],
    inputSchema: EMAIL_SCHEMA,
    generationBrief:
      "Short, realistic customer emails (subject + body) that must be classified as exactly one of: spam, product_search, support, invoice. Include ambiguous cases such as invoices that ask a question, and marketing emails that look like product questions.",
  });
  await services.items.add(email.id, toNewItems(emailItems));
  const emailV1 = await services.versions.publish(email.id, {
    label: "customer sample",
    notes: "8 hand-labelled emails from the support inbox export",
  });
  const emailScorers: ScorerSpec[] = [
    { key: "exact", type: "exact_match", config: { caseInsensitive: true } },
    {
      key: "judge",
      type: "llm_judge",
      config: {
        rubric:
          "The label must be one of spam, product_search, support, invoice and must match the expected label exactly.",
        passThreshold: 0.7,
      },
    },
  ];
  factory.variant = "good";
  const emailA = await services.runs.start({
    datasetId: email.id,
    name: "baseline prompt",
    model: SEED_MODEL,
    systemPrompt:
      "You classify customer emails. Answer with exactly one label: spam, product_search, support or invoice. No explanation.",
    userTemplate: "Subject: {{subject}}\n\n{{body}}",
    scorers: emailScorers,
    triggeredBy: "api",
  });
  await services.runs.wait(emailA.id);
  factory.variant = "regressed";
  const emailB = await services.runs.start({
    datasetId: email.id,
    name: "terse prompt",
    model: SEED_MODEL,
    systemPrompt: "Label the email.",
    userTemplate: "{{body}}",
    scorers: emailScorers,
    triggeredBy: "api",
  });
  await services.runs.wait(emailB.id);
  factory.variant = "good";
  // A correction in the draft after publishing, so the Versions tab has a pending diff
  const emailDraft = await services.items.list(email.id, { filter: "all", limit: 50 });
  const lastEmail = emailDraft.items[emailDraft.items.length - 1]!;
  await services.items.update(lastEmail.id, {
    metadata: { notes: "Reviewed with the customer: definitely spam." },
  });
  result.datasets.push({
    id: email.id,
    name: email.name,
    items: emailItems.length,
    version: emailV1.version.number,
  });
  result.runs.push(
    ...[emailA, emailB].map((r) => ({
      id: r.id,
      name: r.name ?? "",
      datasetId: email.id,
      status: "completed",
    })),
  );

  // ---- 2. SAP product codes: structured output, set_overlap + json_equal + judge ---------------
  const codes = await services.datasets.create({
    name: "SAP product codes (sample)",
    description: "Extract the SAP product codes mentioned in customer emails.",
    tags: [SEED_TAG, "extraction"],
    inputSchema: EMAIL_SCHEMA,
    generationBrief:
      "Customer emails mentioning zero, one or several SAP product codes of the form ABC-123 (three letters, dash, digits; variants like JKL-001-B exist). Include emails with no codes, codes repeated in different casing, and near-miss strings that are not codes.",
  });
  await services.items.add(codes.id, toNewItems(codeItems));
  const codesV1 = await services.versions.publish(codes.id, { label: "customer sheet v1" });
  const codesRun = await services.runs.start({
    datasetId: codes.id,
    name: "structured extraction",
    model: SEED_MODEL,
    systemPrompt:
      "Extract every SAP product code mentioned in the email. Return only codes that appear verbatim.",
    userTemplate: "Subject: {{subject}}\nBody: {{body}}",
    outputSchema: CODES_SCHEMA,
    scorers: [
      { key: "codes", type: "set_overlap", config: { path: "productCodes", passThreshold: 1 } },
      { key: "strict", type: "json_equal", config: {} },
      {
        key: "judge",
        type: "llm_judge",
        config: {
          rubric:
            "All expected product codes must be present and no code may be invented or altered.",
        },
      },
    ],
    triggeredBy: "api",
  });
  await services.runs.wait(codesRun.id);
  result.datasets.push({
    id: codes.id,
    name: codes.name,
    items: codeItems.length,
    version: codesV1.version.number,
  });
  result.runs.push({
    id: codesRun.id,
    name: codesRun.name ?? "",
    datasetId: codes.id,
    status: "completed",
  });

  // ---- 3. Sentiment: numeric_tolerance + regex + json_equal(path), unreviewed and missing truths
  const sentiment = await services.datasets.create({
    name: "Review sentiment (sample)",
    description:
      "Classify product reviews as positive, negative or neutral with a confidence score.",
    tags: [SEED_TAG, "sentiment"],
    generationBrief:
      "One- or two-sentence product reviews with clear positive, clear negative and genuinely mixed/neutral cases. The expected answer is {sentiment, score} where score is the confidence in the label.",
  });
  await services.items.add(sentiment.id, toNewItems(sentimentItems));
  const sentimentV1 = await services.versions.publish(sentiment.id, { label: "initial" });
  const sentimentRun = await services.runs.start({
    datasetId: sentiment.id,
    name: "sentiment json",
    model: SEED_MODEL,
    systemPrompt: "Classify the sentiment of the review and give a confidence between 0 and 1.",
    userTemplate: "Review: {{input}}",
    outputSchema: SENTIMENT_SCHEMA,
    scorers: [
      { key: "label", type: "json_equal", config: { path: "sentiment" } },
      { key: "confidence", type: "numeric_tolerance", config: { path: "score", abs: 0.2 } },
    ],
    triggeredBy: "api",
  });
  await services.runs.wait(sentimentRun.id);
  const rescore = await services.scoring.scoreRun(sentimentRun.id, {
    key: "format",
    type: "regex",
    config: { path: "sentiment", pattern: "^(positive|negative|neutral)$" },
  });
  await services.jobs$.wait(rescore.id);
  result.jobs.push(rescore.id);
  result.datasets.push({
    id: sentiment.id,
    name: sentiment.name,
    items: sentimentItems.length,
    version: sentimentV1.version.number,
  });
  result.runs.push({
    id: sentimentRun.id,
    name: sentimentRun.name ?? "",
    datasetId: sentiment.id,
    status: "completed",
  });
  return result;
}
