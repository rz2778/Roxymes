import {
  assertSameOrigin,
  createDingTalkSession,
  errorResponse,
} from "../../../../lib/auth";
import { exchangeAuthCode } from "../../../../lib/dingtalk";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const payload = await request.json() as { code?: string };
    if (!payload.code?.trim()) {
      return Response.json(
        { error: "缺少钉钉免登授权码", code: "AUTH_CODE_REQUIRED" },
        { status: 400 },
      );
    }
    const profile = await exchangeAuthCode(payload.code);
    const session = await createDingTalkSession(request, profile);
    return Response.json(
      { user: session.user },
      {
        headers: {
          "set-cookie": session.cookie,
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return errorResponse(error, "钉钉免登失败");
  }
}
