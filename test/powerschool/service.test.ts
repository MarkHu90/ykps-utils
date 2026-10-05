import { describe, expect, it, vi } from "vitest";

import {
  PowerSchoolError,
  PowerSchoolService,
} from "../../src/powerschool/service.js";

describe("PowerSchoolService", () => {
  it("requests an access token with the client credentials grant", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        access_token: "119628ce-1734-45c8-9ac1-cf91e51f85e2",
        token_type: "Bearer",
        expires_in: "2592000",
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const service = new PowerSchoolService(fetch);

    const result = await service.getAccessToken({
      baseUrl: "https://school.example.com/admin/home.html",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    expect(result).toEqual({
      accessToken: "119628ce-1734-45c8-9ac1-cf91e51f85e2",
      tokenType: "Bearer",
      expiresIn: 2592000,
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url.toString()).toBe("https://school.example.com/oauth/access_token/");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
    });
    expect(init?.body?.toString()).toBe("grant_type=client_credentials");
  });

  it("rejects invalid base URLs without making a request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const service = new PowerSchoolService(fetch);

    await expect(service.getAccessToken({
      baseUrl: "not-a-url",
      clientId: "client-id",
      clientSecret: "client-secret",
    })).rejects.toEqual(expect.objectContaining<Partial<PowerSchoolError>>({
      code: "INVALID_REQUEST",
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not expose an upstream response body in provider errors", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("client-secret is invalid", { status: 401 }),
    );
    const service = new PowerSchoolService(fetch);

    await expect(service.getAccessToken({
      baseUrl: "https://school.example.com",
      clientId: "client-id",
      clientSecret: "client-secret",
    })).rejects.toThrow("PowerSchool rejected the token request with status 401.");
  });
});