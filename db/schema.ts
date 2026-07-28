import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sampleOrders = sqliteTable("sample_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderNo: text("order_no").notNull(),
  customer: text("customer").notNull(),
  merchandiser: text("merchandiser").notNull(),
  dueDate: text("due_date").notNull(),
  priority: text("priority").notNull().default("普通"),
  sampleType: text("sample_type").notNull().default("开发样"),
  status: text("status").notNull().default("待审单"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("sample_orders_order_no_idx").on(table.orderNo)]);

export const styles = sqliteTable("styles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => sampleOrders.id),
  styleNo: text("style_no").notNull(),
  color: text("color").notNull(),
  size: text("size"),
  quantity: integer("quantity").notNull().default(1),
  version: integer("version").notNull().default(1),
  mainImage: text("main_image").notNull(),
  status: text("status").notNull().default("待审单"),
  currentProcess: text("current_process").notNull().default("审单"),
});

export const processTasks = sqliteTable("process_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  styleId: integer("style_id").notNull().references(() => styles.id),
  process: text("process").notNull(),
  sequence: integer("sequence").notNull(),
  assignee: text("assignee").notNull(),
  status: text("status").notNull(),
  plannedStart: text("planned_start"),
  plannedEnd: text("planned_end"),
  actualStart: text("actual_start"),
  actualEnd: text("actual_end"),
  pauseReason: text("pause_reason"),
  exceptionNote: text("exception_note"),
  version: integer("version").notNull().default(1),
  rowVersion: integer("row_version").notNull().default(1),
});

export const changeRecords = sqliteTable("change_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  styleId: integer("style_id").notNull().references(() => styles.id),
  fromVersion: integer("from_version").notNull(),
  toVersion: integer("to_version").notNull(),
  reason: text("reason").notNull(),
  content: text("content").notNull(),
  applicant: text("applicant").notNull(),
  status: text("status").notNull().default("待主管处理"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipient: text("recipient").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  channel: text("channel").notNull().default("系统内"),
  status: text("status").notNull().default("待处理"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  actor: text("actor").notNull(),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("audit_logs_idempotency_idx").on(table.idempotencyKey)]);

export const attachments = sqliteTable("attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  styleId: integer("style_id").notNull().references(() => styles.id),
  version: integer("version").notNull(),
  objectKey: text("object_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
