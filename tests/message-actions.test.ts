import test from "node:test";
import assert from "node:assert/strict";
import { conversationMarkdown } from "../src/message-actions";

test("conversationMarkdown formats title and messages correctly", () => {
  const result = conversationMarkdown("T", [
    { role: "user", text: "q" },
    { role: "assistant", text: " a " },
    { role: "assistant", text: "  " },
  ]);
  assert.equal(
    result,
    "# T\n\n**나**\n\nq\n\n**Pumasi Agent**\n\na\n",
  );
});