import {
  assertSameOrigin,
  errorResponse,
  requireUser,
} from "../../../../../lib/auth";
import { binding } from "../../../../../lib/data";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireUser(request, "task:any");
    const { id } = await context.params;
    const taskId = Number(id);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) {
      return Response.json({ error: "任务编号无效" }, { status: 400 });
    }

    const payload = await request.json() as { userId?: number; rowVersion?: number };
    const targetUserId = Number(payload.userId);
    const expectedVersion = Number(payload.rowVersion);
    if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
      return Response.json({ error: "请选择有效的组织成员" }, { status: 400 });
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
      return Response.json({ error: "任务版本无效，请刷新后重试" }, { status: 400 });
    }

    const db = binding();
    const target = await db.prepare(`SELECT id, name
      FROM users WHERE id = ? AND org_id = ? AND active = 1`)
      .bind(targetUserId, actor.orgId)
      .first<{ id: number; name: string }>();
    if (!target) {
      return Response.json({ error: "目标成员不存在或已停用" }, { status: 404 });
    }

    const task = await db.prepare(`SELECT id, assignee, assignee_user_id, row_version
      FROM process_tasks WHERE id = ? AND org_id = ?`)
      .bind(taskId, actor.orgId)
      .first<{
        id: number;
        assignee: string;
        assignee_user_id: number | null;
        row_version: number;
      }>();
    if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (task.row_version !== expectedVersion) {
      return Response.json({ error: "任务已被其他人更新，请刷新后重试" }, { status: 409 });
    }

    const result = await db.prepare(`UPDATE process_tasks
      SET assignee_user_id = ?, assignee = ?, row_version = row_version + 1
      WHERE id = ? AND org_id = ? AND row_version = ?`)
      .bind(target.id, target.name, taskId, actor.orgId, expectedVersion)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "任务分配发生冲突，请刷新后重试" }, { status: 409 });
    }

    await db.prepare(`INSERT INTO audit_logs
      (org_id, entity_type, entity_id, action, before_value, after_value, actor, actor_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        actor.orgId,
        "工序任务",
        taskId,
        "分配任务",
        task.assignee_user_id == null ? `未绑定（${task.assignee}）` : `${task.assignee} #${task.assignee_user_id}`,
        `${target.name} #${target.id}`,
        actor.name,
        actor.id,
      ).run();

    return Response.json({
      ok: true,
      assignee: {
        id: target.id,
        name: target.name,
      },
      rowVersion: expectedVersion + 1,
    });
  } catch (error) {
    return errorResponse(error, "任务分配失败");
  }
}
