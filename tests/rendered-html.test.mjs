import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("build contains the sample room workflow product", async () => {
  const [page, app, layout, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/MesApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));

  assert.match(page, /<MesApp \/>/);
  assert.match(app, /样品流/);
  assert.match(app, /新建样品单/);
  assert.match(app, /我的任务/);
  assert.match(layout, /样品流 · 样品室流程管理/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "ATTACHMENTS"/);
  assert.doesNotMatch(`${page}${app}${layout}`, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});
