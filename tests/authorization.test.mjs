import assert from "node:assert/strict";
import test from "node:test";
import {
  canOperateTask,
  hasCapability,
} from "../lib/authorization.ts";

test("members cannot gain supervisor capabilities", () => {
  assert.equal(hasCapability("member", "dashboard:read"), true);
  assert.equal(hasCapability("member", "task:self"), true);
  assert.equal(hasCapability("member", "task:any"), false);
  assert.equal(hasCapability("member", "order:create"), false);
  assert.equal(hasCapability("member", "change:create"), false);
  assert.equal(hasCapability("supervisor", "order:create"), true);
  assert.equal(hasCapability("admin", "organization:admin"), true);
});

test("task authorization prefers immutable user ids", () => {
  const member = { id: 18, name: "王师傅" };
  assert.equal(
    canOperateTask("member", member, {
      assignee_user_id: 18,
      assignee: "其他显示名",
    }),
    true,
  );
  assert.equal(
    canOperateTask("member", member, {
      assignee_user_id: 99,
      assignee: "王师傅",
    }),
    false,
  );
  assert.equal(
    canOperateTask("supervisor", member, {
      assignee_user_id: 99,
      assignee: "其他人",
    }),
    true,
  );
});

test("same names never authorize a different immutable user id", () => {
  assert.equal(
    canOperateTask(
      "member",
      { id: 18, name: "同名成员" },
      { assignee_user_id: 19, assignee: "同名成员" },
    ),
    false,
  );
});

test("unbound legacy tasks are supervisor-only", () => {
  assert.equal(
    canOperateTask(
      "member",
      { id: 18, name: "王师傅" },
      { assignee_user_id: null, assignee: "王师傅" },
    ),
    false,
  );
  assert.equal(
    canOperateTask(
      "supervisor",
      { id: 18, name: "王师傅" },
      { assignee_user_id: null, assignee: "任意旧姓名" },
    ),
    true,
  );
});
