import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createApp, normalizeCorsOrigins } from "../src/app";
import { newToken } from "../src/core/security";
import { createServerSecurity } from "../src/core/server-security";

describe("CORS origin normalization and preflight handling", () => {
  it("normalizes trailing slashes, bare hostnames, and duplicates", () => {
    expect(
      normalizeCorsOrigins([
        "selfdev.ppkxb.space",
        "https://portalthepos.ppkxb.space/",
        "https://portalthepos.ppkxb.space///",
        "http://localhost:4173/",
        " ",
      ]),
    ).toEqual([
      "https://selfdev.ppkxb.space",
      "https://portalthepos.ppkxb.space",
      "http://localhost:4173",
    ]);
  });

  it("matches browser Origin headers even when configured with trailing slashes or bare hostnames", async () => {
    const { security } = createServerSecurity({
      signingSecret: newToken(),
      connectKey: "connect-key-1234",
    });
    const app = createApp({} as PrismaClient, {
      jwtSecret: newToken(),
      serverSecurity: security,
      corsOrigins: ["selfdev.ppkxb.space", "https://portalthepos.ppkxb.space/"],
    });

    const preflight = await app.request("/api/v1/setup/verify-connection", {
      method: "OPTIONS",
      headers: {
        origin: "https://portalthepos.ppkxb.space",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-server-token",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://portalthepos.ppkxb.space");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");

    const verify = await app.request("/api/v1/setup/verify-connection", {
      method: "POST",
      headers: {
        origin: "https://selfdev.ppkxb.space",
        "content-type": "application/json",
      },
      body: JSON.stringify({ serverKey: "connect-key-1234" }),
    });
    expect(verify.status).toBe(200);
    expect(verify.headers.get("access-control-allow-origin")).toBe("https://selfdev.ppkxb.space");
  });
});
