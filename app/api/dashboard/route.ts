import { errorResponse, requireUser } from "../../../lib/auth";
import { isSupervisor } from "../../../lib/authorization";
import { binding } from "../../../lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request, "dashboard:read");
    const db = binding();

    if (!isSupervisor(user.role)) {
      const [orders, styles, tasks, attachments] = await Promise.all([
        db.prepare(`SELECT o.*, COUNT(s.id) AS style_count,
          SUM(CASE WHEN s.status = '已完成' THEN 1 ELSE 0 END) AS completed_styles
          FROM sample_orders o
          JOIN styles s ON s.order_id = o.id AND s.org_id = o.org_id
          WHERE o.org_id = ? AND EXISTS (
            SELECT 1 FROM process_tasks own
            WHERE own.org_id = o.org_id
              AND own.style_id = s.id
              AND own.assignee_user_id = ?
          )
          GROUP BY o.id ORDER BY o.due_date ASC`)
          .bind(user.orgId, user.id).all(),
        db.prepare(`SELECT s.* FROM styles s
          WHERE s.org_id = ? AND EXISTS (
            SELECT 1 FROM process_tasks own
            WHERE own.org_id = s.org_id
              AND own.style_id = s.id
              AND own.assignee_user_id = ?
          )
          ORDER BY s.id`)
          .bind(user.orgId, user.id).all(),
        db.prepare(`SELECT t.*, s.style_no, s.color, s.main_image, s.current_process,
          o.order_no, o.customer, o.due_date, o.priority
          FROM process_tasks t
          JOIN styles s ON s.id = t.style_id AND s.org_id = t.org_id
          JOIN sample_orders o ON o.id = s.order_id AND o.org_id = t.org_id
          WHERE t.org_id = ? AND t.assignee_user_id = ?
          ORDER BY o.due_date, t.sequence, t.id`)
          .bind(user.orgId, user.id).all(),
        db.prepare(`SELECT a.* FROM attachments a
          WHERE a.org_id = ? AND EXISTS (
            SELECT 1 FROM process_tasks own
            WHERE own.org_id = a.org_id
              AND own.style_id = a.style_id
              AND own.assignee_user_id = ?
          )
          ORDER BY a.created_at DESC`)
          .bind(user.orgId, user.id).all(),
      ]);
      return dashboardResponse(user, {
        orders: orders.results,
        styles: styles.results,
        tasks: tasks.results,
        attachments: attachments.results,
        changes: [],
        notifications: [],
        audits: [],
        members: [],
      });
    }

    const [orders, styles, tasks, changes, notifications, audits, attachments, members] = await Promise.all([
      db.prepare(`SELECT o.*, COUNT(s.id) AS style_count,
        SUM(CASE WHEN s.status = '已完成' THEN 1 ELSE 0 END) AS completed_styles
        FROM sample_orders o
        LEFT JOIN styles s ON s.order_id = o.id AND s.org_id = o.org_id
        WHERE o.org_id = ?
        GROUP BY o.id ORDER BY o.due_date ASC`).bind(user.orgId).all(),
      db.prepare("SELECT * FROM styles WHERE org_id = ? ORDER BY id")
        .bind(user.orgId).all(),
      db.prepare(`SELECT t.*, s.style_no, s.color, s.main_image, s.current_process,
        o.order_no, o.customer, o.due_date, o.priority
        FROM process_tasks t
        JOIN styles s ON s.id = t.style_id AND s.org_id = t.org_id
        JOIN sample_orders o ON o.id = s.order_id AND o.org_id = t.org_id
        WHERE t.org_id = ?
        ORDER BY o.due_date, t.sequence, t.id`).bind(user.orgId).all(),
      db.prepare(`SELECT c.*, s.style_no, s.color, o.order_no
        FROM change_records c
        JOIN styles s ON s.id = c.style_id AND s.org_id = c.org_id
        JOIN sample_orders o ON o.id = s.order_id AND o.org_id = c.org_id
        WHERE c.org_id = ?
        ORDER BY c.created_at DESC`).bind(user.orgId).all(),
      db.prepare("SELECT * FROM notifications WHERE org_id = ? ORDER BY created_at DESC LIMIT 20")
        .bind(user.orgId).all(),
      db.prepare("SELECT * FROM audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT 30")
        .bind(user.orgId).all(),
      db.prepare("SELECT * FROM attachments WHERE org_id = ? ORDER BY created_at DESC")
        .bind(user.orgId).all(),
      db.prepare(`SELECT id, name, avatar, role, dingtalk_user_id
        FROM users WHERE org_id = ? AND active = 1
        ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'supervisor' THEN 2 ELSE 3 END, name`)
        .bind(user.orgId).all(),
    ]);
    return dashboardResponse(user, {
      orders: orders.results,
      styles: styles.results,
      tasks: tasks.results,
      changes: changes.results,
      notifications: notifications.results,
      audits: audits.results,
      attachments: attachments.results,
      members: members.results,
    });
  } catch (error) {
    return errorResponse(error, "数据加载失败");
  }
}

function dashboardResponse(
  viewer: Awaited<ReturnType<typeof requireUser>>,
  data: {
    orders: unknown[];
    styles: unknown[];
    tasks: unknown[];
    changes: unknown[];
    notifications: unknown[];
    audits: unknown[];
    attachments: unknown[];
    members: unknown[];
  },
) {
  return Response.json(
    { viewer, ...data },
    { headers: { "cache-control": "no-store" } },
  );
}
