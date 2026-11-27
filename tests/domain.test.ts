import test from "node:test";
import assert from "node:assert/strict";
import {
  remainingPercent,
  resetText,
  parseStoredChats,
  makePreview,
} from "../src/domain.ts";
test("missing and invalid usage remain unknown; real percentages are clamped", () => {
  assert.equal(remainingPercent(null), null);
  assert.equal(remainingPercent(NaN), null);
  assert.equal(remainingPercent(28), 72);
  assert.equal(remainingPercent(120), 0);
  assert.equal(remainingPercent(-10), 100);
});
test("expired usage is not silently replenished", () => {
  assert.equal(resetText(0, 1), "초기화 확인 필요");
  assert.equal(resetText(null, 1), "초기화 시각 확인 안 됨");
  assert.equal(resetText(90 * 60000, 0), "1시간 30분 후 초기화");
});
test("local preview says nothing was sent and no tokens were used", () => {
  assert.ok(makePreview("light").includes("토큰도 쓰지 않았습니다"));
});
test("corrupt saved data is discarded instead of crashing the app", () => {
  assert.deepEqual(parseStoredChats("{broken"), []);
  assert.deepEqual(
    parseStoredChats(
      JSON.stringify([
        { id: "1", title: "bad", messages: [null], tier: "light" },
      ]),
    ),
    [],
  );
  const chat = { id: "1", title: "valid", messages: [], tier: "light" };
  assert.deepEqual(parseStoredChats(JSON.stringify([chat])), [chat]);
});

import {
  activeContext,
  emptyWorkspace,
  organize,
  propose,
  restoreWorkspace,
} from "../src/domain.ts";
import type { Bundle } from "../src/domain.ts";
const bundle: Bundle = {
  id: "work",
  title: "코드 작업",
  status: "active",
  tier: "standard",
  messages: [{ id: "u", role: "user", text: "코드 버그를 수정해 줘" }],
};
test("topic change proposes cleanup but never mutates stored work", () => {
  const list = [structuredClone(bundle)];
  assert.equal(propose(list, "여행 일정을 추천해 줘")?.bundleId, "work");
  assert.equal(propose(list, "코드 테스트도 작성해 줘"), null);
  assert.ok(propose(list, "고마워 여기까지"));
  assert.equal(list[0].status, "active");
});
test("group/archive/trash remove prior context without deleting messages; restore is possible", () => {
  for (const action of ["grouped", "archived", "trashed"] as const) {
    const changed = organize([bundle], "work", action);
    assert.equal(activeContext(changed).length, 0);
    assert.deepEqual(changed[0].messages, bundle.messages);
    assert.equal(bundle.status, "active");
    assert.equal(
      organize(changed, "work", "grouped")[0].messages[0].text,
      bundle.messages[0].text,
    );
  }
});
test("v1 multi-session data migrates to legacy without flattening or deleting it", () => {
  const old = JSON.stringify([
    { id: "old", title: "기존", messages: [], tier: "light" },
  ]);
  const restored = restoreWorkspace(null, old);
  assert.equal(restored.mode, "legacy");
  assert.equal(restored.legacyChats[0].id, "old");
  assert.deepEqual(restored.bundles, []);
  const both = {
    ...emptyWorkspace(),
    save: true,
    bundles: [bundle],
    legacyChats: restored.legacyChats,
  };
  assert.deepEqual(restoreWorkspace(JSON.stringify(both), null), both);
  assert.deepEqual(restoreWorkspace("{broken", null), emptyWorkspace());
});
