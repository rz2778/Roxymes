import { errorResponse, requireUser } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return Response.json({ user }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "当前登录状态读取失败");
  }
}
