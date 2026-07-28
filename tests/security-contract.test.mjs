import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const mutationRoutes = [
  "app/api/orders/route.ts",
  "app/api/changes/route.ts",
  "app/api/attachments/route.ts",
  "app/api/tasks/[id]/action/route.ts",
];
const protectedRoutes = [
  "app/api/dashboard/route.ts",
  ...mutationRoutes,
];

test("every business API is deny-by-default", async () => {
  for (const path of protectedRoutes) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.match(source, /requireUser\(request/u, `${path} must require a session`);
    assert.match(source, /org_id/u, `${path} must scope database access by organization`);
  }
});

test("every business mutation validates its browser origin", async () => {
  for (const path of mutationRoutes) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.match(source, /assertSameOrigin\(request\)/u, `${path} must validate origin`);
  }
});

test("identity-bearing audit fields come from the server session", async () => {
  const [orders, changes, attachments, tasks] = await Promise.all(
    mutationRoutes.map((path) => readFile(new URL(path, root), "utf8")),
  );
  assert.doesNotMatch(orders, /payload\.actor|payload\.merchandiser/u);
  assert.doesNotMatch(changes, /payload\.applicant/u);
  assert.doesNotMatch(tasks, /payload\.actor/u);
  assert.match(attachments, /uploaded_by_user_id/u);
  assert.match(`${orders}${changes}${tasks}`, /actor_user_id/u);
});

test("DingTalk boot cannot wait forever", async () => {
  const source = await readFile(new URL("app/MesApp.tsx", root), "utf8");
  assert.match(source, /钉钉组件加载超时/u);
  assert.match(source, /钉钉授权响应超时/u);
  assert.match(source, /10_000/u);
  assert.match(source, /removeEventListener/u);
  assert.match(source, /existing\?\.remove\(\)/u);
  assert.match(source, /script\.remove\(\)/u);
});

test("member dashboard is an immutable-user resource closure", async () => {
  const source = await readFile(new URL("app/api/dashboard/route.ts", root), "utf8");
  assert.match(source, /if \(!isSupervisor\(user\.role\)\)/u);
  assert.match(source, /own\.assignee_user_id = \?/u);
  assert.match(source, /t\.assignee_user_id = \?/u);
  assert.match(source, /changes: \[\]/u);
  assert.match(source, /notifications: \[\]/u);
  assert.match(source, /audits: \[\]/u);
  assert.doesNotMatch(source, /assignee\s*=\s*\?/u);
});

test("attachment and client task access never fall back to display names", async () => {
  const [attachments, client] = await Promise.all([
    readFile(new URL("app/api/attachments/route.ts", root), "utf8"),
    readFile(new URL("app/MesApp.tsx", root), "utf8"),
  ]);
  assert.match(attachments, /AND assignee_user_id = \?/u);
  assert.doesNotMatch(attachments, /normalizeName|assignee\s*=\s*\?/u);
  assert.match(client, /task\.assignee_user_id === viewer\.id/u);
  assert.doesNotMatch(client, /task\.assignee\.normalize/u);
});

test("task idempotency keys are server-scoped composites", async () => {
  const source = await readFile(
    new URL("app/api/tasks/[id]/action/route.ts", root),
    "utf8",
  );
  assert.match(source, /task-action-v1/u);
  assert.match(source, /user\.orgId/u);
  assert.match(source, /user\.id/u);
  assert.match(source, /taskId/u);
  assert.match(source, /encodeURIComponent\(action\)/u);
  assert.match(source, /encodeURIComponent\(rawIdempotencyKey\)/u);
});

test("DingTalk login carries the same-origin request marker", async () => {
  const source = await readFile(new URL("app/MesApp.tsx", root), "utf8");
  assert.match(
    source,
    /apiFetch\("\/api\/auth\/dingtalk"/u,
    "the login POST must use the protected same-origin fetch wrapper",
  );
});

test("unknown server errors are not returned to clients verbatim", async () => {
  const source = await readFile(new URL("lib/auth.ts", root), "utf8");
  assert.match(source, /code:\s*"INTERNAL_ERROR"/u);
  assert.match(source, /console\.error\(fallback,\s*error\)/u);
});

test("task assignment is supervisor-only, same-origin, tenant-scoped and CAS protected", async () => {
  const source = await readFile(
    new URL("app/api/tasks/[id]/assign/route.ts", root),
    "utf8",
  );
  assert.match(source, /assertSameOrigin\(request\)/u);
  assert.match(source, /requireUser\(request,\s*"task:any"\)/u);
  assert.match(source, /FROM users WHERE id = \? AND org_id = \? AND active = 1/u);
  assert.match(source, /FROM process_tasks WHERE id = \? AND org_id = \?/u);
  assert.match(source, /SET assignee_user_id = \?, assignee = \?, row_version = row_version \+ 1/u);
  assert.match(source, /WHERE id = \? AND org_id = \? AND row_version = \?/u);
  assert.match(source, /actor_user_id/u);
});

test("member dashboards never receive the organization member directory", async () => {
  const [dashboard, client] = await Promise.all([
    readFile(new URL("app/api/dashboard/route.ts", root), "utf8"),
    readFile(new URL("app/MesApp.tsx", root), "utf8"),
  ]);
  assert.match(dashboard, /members: \[\]/u);
  assert.match(dashboard, /SELECT id, name, avatar, role, dingtalk_user_id/u);
  assert.match(dashboard, /FROM users WHERE org_id = \? AND active = 1/u);
  assert.match(client, /apiFetch\(`\/api\/tasks\/\$\{task\.id\}\/assign`/u);
  assert.match(client, /成员需先打开一次应用|先让组织成员从钉钉工作台进入一次应用/u);
});

test("app navigation survives refresh and client back navigation", async () => {
  const source = await readFile(new URL("app/MesApp.tsx", root), "utf8");
  assert.match(source, /window\.location\.hash/u);
  assert.match(source, /addEventListener\("hashchange"/u);
  assert.match(source, /navigateTo\(item\.key\)/u);
});
