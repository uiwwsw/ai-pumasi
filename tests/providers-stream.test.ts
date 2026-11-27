import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { request } = require("../electron/providers.cjs");

const basePayload = {
  action: "execute",
  text: "hi",
  context: [],
  maxOutputTokens: 128,
};

// Helper to create a fake fetch Response with a ReadableStream body
function createStreamResponse(chunks: string[]) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
  };
}

function createJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

test("OpenAI-compatible chat stream (gemini)", async () => {
  // One event is split in the middle of a line to prove partial chunks are buffered.
  const chunks = [
    'data: {"model":"m","choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choi',
    'ces":[{"delta":{"content":"lo"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
    'data: [DONE]\n\n',
  ];
  let seenBody: any;
  const deltas: string[] = [];
  const result = await request(
    { ...basePayload, model: "gemini-flash-latest" },
    {
      env: { GEMINI_API_KEY: "k", AURORA_OLLAMA: "0" },
      fetchImpl: async (_url: string, opts: any) => {
        seenBody = JSON.parse(opts.body);
        return createStreamResponse(chunks);
      },
      onDelta: (text: string) => deltas.push(text),
    },
  );
  // onDelta gets the whole answer so far, not just the new piece.
  assert.deepEqual(deltas, ["Hel", "Hello"]);
  assert.equal(seenBody.stream, true);
  assert.deepEqual(seenBody.stream_options, { include_usage: true });
  assert.equal(result.text, "Hello");
  assert.equal(result.inputTokens, 3);
  assert.equal(result.outputTokens, 2);
  assert.equal(result.incomplete, false);
});

test("OpenAI-compatible chat stream with finish_reason length -> incomplete true", async () => {
  const chunks = [
    'data: {"model":"m","choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
    'data: [DONE]\n\n',
  ];
  const result = await request(
    { ...basePayload, model: "gemini-flash-latest" },
    {
      env: { GEMINI_API_KEY: "k", AURORA_OLLAMA: "0" },
      fetchImpl: async () => createStreamResponse(chunks),
      onDelta: () => {},
    },
  );
  assert.equal(result.text, "Hello");
  assert.equal(result.incomplete, true);
});

test("OpenAI Responses stream (gpt-6.1-sol)", async () => {
  const chunks = [
    'data: {"type":"response.output_text.delta","delta":"A"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"B"}\n\n',
    'data: {"type":"response.completed","response":{"model":"gpt","status":"completed","usage":{"input_tokens":4,"output_tokens":5}}}\n\n',
    'data: [DONE]\n\n',
  ];
  let seenBody: any;
  const result = await request(
    { ...basePayload, model: "gpt-6.1-sol" },
    {
      env: { OPENAI_API_KEY: "k" },
      fetchImpl: async (_url: string, opts: any) => {
        seenBody = JSON.parse(opts.body);
        return createStreamResponse(chunks);
      },
      onDelta: () => {},
    },
  );
  assert.equal(seenBody.stream, true);
  assert.equal(seenBody.stream_options, undefined);
  assert.equal(result.text, "AB");
  assert.equal(result.inputTokens, 4);
  assert.equal(result.outputTokens, 5);
  assert.equal(result.incomplete, false);
});

test("Anthropic stream (claude-sonnet-5-5)", async () => {
  const chunks = [
    'data: {"type":"message_start","message":{"model":"claude","usage":{"input_tokens":7}}}\n\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"안"}}\n\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"녕"}}\n\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":9}}\n\n',
    'data: [DONE]\n\n',
  ];
  const result = await request(
    { ...basePayload, model: "claude-sonnet-5-5" },
    {
      env: { ANTHROPIC_API_KEY: "k" },
      fetchImpl: async () => createStreamResponse(chunks),
      onDelta: () => {},
    },
  );
  assert.equal(result.text, "안녕");
  assert.equal(result.inputTokens, 7);
  assert.equal(result.outputTokens, 9);
  assert.equal(result.incomplete, true);
});

test("Non-execute actions never stream (action plan)", async () => {
  let seenBody: any;
  let onDeltaCalled = false;
  const response = createJsonResponse({
    choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  await request(
    { ...basePayload, action: "plan", model: "gemini-flash-latest" },
    {
      env: { GEMINI_API_KEY: "k", AURORA_OLLAMA: "0" },
      fetchImpl: async (_url: string, opts: any) => {
        seenBody = JSON.parse(opts.body);
        return response;
      },
      onDelta: () => {
        onDeltaCalled = true;
      },
    },
  );
  assert.equal(seenBody.stream, undefined);
  assert.equal(onDeltaCalled, false);
});

test("Malformed event line is skipped", async () => {
  const chunks = [
    'data: {"model":"m","choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {not json\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
    'data: [DONE]\n\n',
  ];
  const result = await request(
    { ...basePayload, model: "gemini-flash-latest" },
    {
      env: { GEMINI_API_KEY: "k", AURORA_OLLAMA: "0" },
      fetchImpl: async () => createStreamResponse(chunks),
      onDelta: () => {},
    },
  );
  assert.equal(result.text, "Hello");
  assert.equal(result.inputTokens, 3);
  assert.equal(result.outputTokens, 2);
});
test("a stream that goes silent is dropped as stalled, and Auto moves to the next model", async () => {
  const silentAfterOne = () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"생각 중"}}]}\n\n'));
        // ...and then nothing, never closing.
      },
    }),
  });
  await assert.rejects(
    request(
      { ...basePayload, model: "gemini-flash-latest" },
      { env: { GEMINI_API_KEY: "k", AURORA_OLLAMA: "0" }, fetchImpl: async () => silentAfterOne(), stream: true, idleMs: 50 },
    ),
    (e: any) => e.stalled === true && e.transient === true,
  );
  // Auto: the first free model stalls, the next one answers.
  const seen: string[] = [];
  const r = await request(
    { ...basePayload, model: "auto-free" },
    {
      env: { NVIDIA_API_KEY: "k", AURORA_OLLAMA: "0" },
      idleMs: 50,
      onDelta: () => {},
      fetchImpl: async (_url: string, init: any) => {
        const model = JSON.parse(init.body).model;
        seen.push(model);
        if (seen.length === 1) return silentAfterOne();
        return createStreamResponse([
          'data: {"choices":[{"delta":{"content":"답"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
        ]);
      },
    },
  );
  assert.equal(r.text, "답");
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1]);
});

test("asking to stream without onDelta still gives the whole answer (team calls)", async () => {
  let body: any;
  const r = await request(
    { ...basePayload, action: "plan", model: "gemini-flash-latest" },
    {
      env: { GEMINI_API_KEY: "k", AURORA_OLLAMA: "0" },
      stream: true,
      fetchImpl: async (_u: string, init: any) => {
        body = JSON.parse(init.body);
        return createStreamResponse([
          'data: {"choices":[{"delta":{"content":"{\\"goal\\":"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"\\"g\\"}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n',
        ]);
      },
    },
  );
  assert.equal(body.stream, true);
  assert.equal(r.text, '{"goal":"g"}');
});
