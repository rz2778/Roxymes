import { binding, ensureDatabase } from "../../../lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabase();
    const db = binding();
    const [orders, styles, tasks, changes, notifications, audits, attachments] = await Promise.all([
      db.prepare(`SELECT o.*, COUNT(s.id) AS style_count,
        SUM(CASE WHEN s.status = '已完成' THEN 1 ELSE 0 END) AS completed_styles
        FROM sample_orders o LEFT JOIN styles s ON s.order_id = o.id
        GROUP BY o.id ORDER BY o.due_date ASC`).all(),
      db.prepare("SELECT * FROM styles ORDER BY id").all(),
      db.prepare(`SELECT t.*, s.style_no, s.color, s.main_image, s.current_process,
        o.order_no, o.customer, o.due_date, o.priority
        FROM process_tasks t JOIN styles s ON s.id = t.style_id
        JOIN sample_orders o ON o.id = s.order_id
        ORDER BY o.due_date, t.sequence, t.id`).all(),
      db.prepare(`SELECT c.*, s.style_no, s.color, o.order_no
        FROM change_records c JOIN styles s ON s.id = c.style_id
        JOIN sample_orders o ON o.id = s.order_id ORDER BY c.created_at DESC`).all(),
      db.prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20").all(),
      db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 30").all(),
      db.prepare("SELECT * FROM attachments ORDER BY created_at DESC").all(),
    ]);
    return Response.json({
      orders: orders.results,
      styles: styles.results,
      tasks: tasks.results,
      changes: changes.results,
      notifications: notifications.results,
      audits: audits.results,
      attachments: attachments.results,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "数据加载失败" }, { status: 500 });
  }
}
