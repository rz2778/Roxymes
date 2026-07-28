import { errorResponse } from "../../../../lib/auth";
import { getPublicDingTalkConfig } from "../../../../lib/dingtalk";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(getPublicDingTalkConfig(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "钉钉应用配置读取失败");
  }
}
