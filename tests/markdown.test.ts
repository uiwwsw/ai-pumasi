import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, markBreaks } from "../src/markdown";

const html = (text: string) => renderToStaticMarkup(React.createElement(Markdown, { text }));

test("an answer's Markdown is drawn: headings, bold, lists, tables and code", () => {
  const out = html("## 제목\n\n**굵게** 그리고 `코드`\n\n- 하나\n- 둘\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```");
  assert.match(out, /<h2>제목<\/h2>/);
  assert.match(out, /<strong>굵게<\/strong>/);
  assert.match(out, /<li>하나<\/li>/);
  assert.match(out, /<table>[\s\S]*<td>1<\/td>/);
  assert.match(out, /<pre><code class="language-js">const x = 1;/);
});

test("<br> becomes a line break, in a table cell too; inside code it stays as written", () => {
  const out = html("첫 줄<br>둘째 줄\n\n| 항목 | 설명 |\n| --- | --- |\n| A | 하나<br/>둘 |\n\n`a<br>b`");
  assert.match(out, /첫 줄<br\/>둘째 줄/);
  assert.match(out, /<td>하나<br\/>둘<\/td>/);
  assert.match(out, /<code>a&lt;br&gt;b<\/code>/);
  assert.equal(markBreaks("```\n<br>\n```"), "```\n<br>\n```");
});

test("other HTML in an answer is shown as text and never run; images are not fetched", () => {
  const out = html('<script>alert(1)</script> <img src="https://x.test/a.png">\n\n![그림](https://x.test/b.png) [링크](https://x.test)');
  assert.doesNotMatch(out, /<script|<img/);
  assert.match(out, /<a href="https:\/\/x\.test\/b\.png" target="_blank" rel="noreferrer noopener">그림<\/a>/);
  assert.match(out, /<a href="https:\/\/x\.test" target="_blank"/);
});
