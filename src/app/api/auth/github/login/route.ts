import { type NextRequest, NextResponse } from "next/server";

import { AUTH_AND_BILLING_STALE } from "@/config/app-config";
import { getAppUrl } from "@/lib/env";
import { getGitHubAppConfig } from "@/lib/server/deps";

import { createOAuthState } from "../oauth-state";

/** Start "Sign in with GitHub" (the GitHub App's user authorization flow). */
export async function GET(request: NextRequest) {
  if (AUTH_AND_BILLING_STALE) return NextResponse.redirect(new URL("/auth/v1/login", request.url));
  const config = await getGitHubAppConfig();
  if (!config) return NextResponse.redirect(new URL("/auth/v1/login?error=github_not_configured", getAppUrl()));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.GITHUB_APP_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${getAppUrl()}/api/auth/github/callback`);
  url.searchParams.set("state", await createOAuthState());
  return NextResponse.redirect(url);
}
