import {
  assertSameOrigin,
  errorResponse,
  RequestError,
  requireUser,
} from "../../../../../lib/auth";
import { canOperateTask } from "../../../../../lib/authorization";
import { binding } from "../../../../../lib/data";
import { ALLOWED_ACTIONS, canActivateCutting, nextStatus } from "../../../../../lib/domain";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request, "task:self");
    const db = binding();
    const { id } = await context.params;
    const taskId = Number(id);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) {
      return Response.json({ error: "任务编号无效" }, { status: 400 });
    }
    const payload = await request.json() as {
      action?: string;
      reason?: string;
      idempotencyKey?: string;
      rowVersion?: number;
    };
    const action = payload.action ?? "";
    const rawIdempotencyKey = payload.idempotencyKey?.trim();
    if (!rawIdempotencyKey || rawIdempotencyKey.length > 200) {
      return Response.json({ error: "缺少有效幂等键" }, { status: 400 });
    }
    const idempotencyKey = [
      "task-action-v1",
      user.orgId,
      user.id,
      taskId,
      encodeURIComponent(action),
      encodeURIComponent(rawIdempotencyKey),
    ].join(":");

    const duplicate = await db.prepare(
      "SELECT id FROM audit_logs WHERE org_id = ? AND idempotency_key = ?",
    ).bind(user.orgId, idempotencyKey).first();
    if (duplicate) return Response.json({ ok: true, duplicate: true });

    const task = await db.prepare(`SELECT
        t.id, t.org_id, t.style_id, t.process, t.status, t.row_version,
        t.assignee, t.assignee_user_id
      FROM process_tasks t
      JOIN styles s ON s.id = t.style_id AND s.org_id = t.org_id
      WHERE t.id = ? AND t.org_id = ?`)
      .bind(taskId, user.orgId)
      .first<{
        id: number;
        org_id: number;
        style_id: number;
        process: string;
        status: string;
        row_version: number;
        assignee: string;
        assignee_user_id: number | null;
      }>();
    if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (!canOperateTask(user.role, user, task)) {
      throw new RequestError("你只能操作分配给自己的任务", 403, "RESOURCE_FORBIDDEN");
    }
    if (!ALLOWED_ACTIONS[action]?.includes(task.status as never)) {
      return Response.json({ error: `当前状态“${task.status}”不能执行该操作` }, { status: 409 });
    }
    if (payload.rowVersion != null && payload.rowVersion !== task.row_version) {
      return Response.json({ error: "任务已被其他人更新，请刷新后重试" }, { status: 409 });
    }

    const target = nextStatus(action);
    const now = new Date().toISOString();
    const startTime = action === "start" ? now : null;
    const endTime = action === "complete" ? now : null;
    const result = await db.prepare(`UPDATE process_tasks SET
      status = ?,
      assignee_user_id = COALESCE(assignee_user_id, ?),
      actual_start = COALESCE(?, actual_start),
      actual_end = COALESCE(?, actual_end),
      pause_reason = CASE WHEN ? = 'pause' THEN ? WHEN ? = 'resume' THEN NULL ELSE pause_reason END,
      exception_note = CASE WHEN ? = 'exception' THEN ? ELSE exception_note END,
      row_version = row_version + 1
      WHERE id = ? AND org_id = ? AND row_version = ?`)
      .bind(
        target,
        task.assignee_user_id == null && user.role === "member" ? user.id : task.assignee_user_id,
        startTime,
        endTime,
        action,
        payload.reason?.trim() || null,
        action,
        action,
        payload.reason?.trim() || null,
        taskId,
        user.orgId,
        task.row_version,
      ).run();
    if ((result.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "任务状态发生冲突，请刷新后重试" }, { status: 409 });
    }
    await db.prepare(`INSERT INTO audit_logs
      (org_id, entity_type, entity_id, action, before_value, after_value, actor, actor_user_id, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        user.orgId,
        "工序任务",
        taskId,
        action,
        task.status,
        target,
        user.name,
        user.id,
        idempotencyKey,
      ).run();

    if (action === "complete") {
      const siblingRows = await db.prepare(`SELECT id, process, status, sequence, assignee
        FROM process_tasks WHERE style_id = ? AND org_id = ? ORDER BY sequence, id`)
        .bind(task.style_id, user.orgId)
        .all<{ id: number; process: string; status: string; sequence: number; assignee: string }>();
      if ((task.process === "备料" || task.process === "开版") && canActivateCutting(siblingRows.results)) {
        await db.prepare(`UPDATE process_tasks
          SET status = '待开始', row_version = row_version + 1
          WHERE org_id = ? AND style_id = ? AND process = '切割' AND status = '等待前置工序'`)
          .bind(user.orgId, task.style_id).run();
      } else if (!["备料", "开版", "成型"].includes(task.process)) {
        const nextSequence = task.process === "切割" ? 3 : task.process === "加工" ? 4 : 5;
        const next = siblingRows.results.find((row) => row.sequence === nextSequence);
        if (next) {
          await db.prepare(`UPDATE process_tasks
            SET status = '待开始', row_version = row_version + 1
            WHERE id = ? AND org_id = ? AND status = '等待前置工序'`)
            .bind(next.id, user.orgId).run();
        }
      }

      if (task.process === "成型") {
        await db.prepare(`UPDATE styles SET status = '已完成', current_process = '已完成'
          WHERE id = ? AND org_id = ?`)
          .bind(task.style_id, user.orgId).run();
        const styleRow = await db.prepare(
          "SELECT order_id FROM styles WHERE id = ? AND org_id = ?",
        ).bind(task.style_id, user.orgId).first<{ order_id: number }>();
        if (styleRow) {
          const incomplete = await db.prepare(`SELECT COUNT(*) AS count FROM styles
            WHERE order_id = ? AND org_id = ? AND status != '已完成'`)
            .bind(styleRow.order_id, user.orgId).first<{ count: number }>();
          if ((incomplete?.count ?? 1) === 0) {
            await db.prepare("UPDATE sample_orders SET status = '已完成' WHERE id = ? AND org_id = ?")
              .bind(styleRow.order_id, user.orgId).run();
          }
        }
      } else {
        const current = task.process === "备料" || task.process === "开版"
          ? "备料/开版"
          : task.process === "切割"
            ? "加工"
            : task.process === "加工"
              ? "针车"
              : "成型";
        await db.prepare("UPDATE styles SET current_process = ? WHERE id = ? AND org_id = ?")
          .bind(current, task.style_id, user.orgId).run();
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "任务操作失败");
  }
}
