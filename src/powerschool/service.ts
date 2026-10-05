export interface GetPowerSchoolAccessTokenCommand {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface PowerSchoolAccessToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export class PowerSchoolError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_REQUEST" | "PROVIDER_ERROR",
  ) {
    super(message);
    this.name = "PowerSchoolError";
  }
}

type Fetch = typeof globalThis.fetch;

export class PowerSchoolService {
  constructor(private readonly fetch: Fetch = globalThis.fetch) {}

  async getAccessToken(
    command: GetPowerSchoolAccessTokenCommand,
  ): Promise<PowerSchoolAccessToken> {
    const tokenUrl = createTokenUrl(command.baseUrl);
    const credentials = Buffer.from(
      `${command.clientId}:${command.clientSecret}`,
      "utf8",
    ).toString("base64");

    let response: Response;
    try {
      response = await this.fetch(tokenUrl, {
        method: "POST",
        headers: {
          authorization: `Basic ${credentials}`,
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new PowerSchoolError(
        "PowerSchool could not be reached.",
        "PROVIDER_ERROR",
      );
    }

    if (!response.ok) {
      throw new PowerSchoolError(
        `PowerSchool rejected the token request with status ${response.status}.`,
        "PROVIDER_ERROR",
      );
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (!isAccessTokenResponse(payload)) {
      throw new PowerSchoolError(
        "PowerSchool returned an invalid token response.",
        "PROVIDER_ERROR",
      );
    }
    const expiresIn = parseExpiresIn(payload.expires_in);
    if (expiresIn === undefined) {
      throw new PowerSchoolError(
        "PowerSchool returned an invalid token response.",
        "PROVIDER_ERROR",
      );
    }

    return {
      accessToken: payload.access_token,
      tokenType: payload.token_type,
      expiresIn,
    };
  }
}

function createTokenUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new PowerSchoolError(
      "baseUrl must be a valid HTTP or HTTPS URL.",
      "INVALID_REQUEST",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PowerSchoolError(
      "baseUrl must be a valid HTTP or HTTPS URL.",
      "INVALID_REQUEST",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new PowerSchoolError(
      "baseUrl must not contain credentials.",
      "INVALID_REQUEST",
    );
  }

  return new URL("/oauth/access_token/", url.origin);
}

function isAccessTokenResponse(value: unknown): value is {
  access_token: string;
  token_type: string;
  expires_in: unknown;
} {
  return typeof value === "object"
    && value !== null
    && "access_token" in value
    && typeof value.access_token === "string"
    && value.access_token.length > 0
    && "token_type" in value
    && typeof value.token_type === "string"
    && value.token_type.length > 0
    && "expires_in" in value;
}

function parseExpiresIn(value: unknown): number | undefined {
  const expiresIn = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  return typeof expiresIn === "number"
      && Number.isSafeInteger(expiresIn)
      && expiresIn > 0
    ? expiresIn
    : undefined;
}