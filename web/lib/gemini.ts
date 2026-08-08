// Streaming Gemini client on VERTEX AI (service-account JSON auth).
// Reuses the SAME env vars as the parser, so nothing extra to configure:
//   MEDPRICE_GCP_SA_JSON   = path to the service-account JSON
//   MEDPRICE_GCP_LOCATION  = region (e.g. us-central1)
//   MEDPRICE_FLASH_MODEL   = model (e.g. gemini-2.5-flash)
//   MEDPRICE_GCP_PROJECT   = optional (else taken from the JSON's project_id)
// Zero deps: mints an OAuth token from the SA via a signed JWT (node:crypto),
// then calls Vertex :streamGenerateContent (SSE). Node.js runtime only.

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const MODEL =
  process.env.MEDPRICE_FLASH_MODEL ||
  process.env.GEMINI_MODEL ||
  "gemini-2.5-flash";
const LOCATION =
  process.env.MEDPRICE_GCP_LOCATION ||
  process.env.GOOGLE_CLOUD_LOCATION ||
  "us-central1";
const OAUTH_URL = "https://oauth2.googleapis.com/token";

export type ChatTurn = { role: "user" | "assistant"; content: string };

type SA = {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
};

let _sa: SA | null | undefined; // undefined = not tried, null = unavailable

function loadSA(): SA | null {
  if (_sa !== undefined) return _sa;
  try {
    const inline = process.env.GCP_SA_KEY || process.env.VERTEX_SA_JSON || "";
    const path =
      process.env.MEDPRICE_GCP_SA_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      "";
    const raw = inline ? inline : path ? readFileSync(path, "utf8") : "";
    if (!raw) {
      _sa = null;
      return null;
    }
    const j = JSON.parse(raw) as SA;
    _sa = j.client_email && j.private_key ? j : null;
  } catch {
    _sa = null;
  }
  return _sa;
}

function project(sa: SA): string {
  return (
    process.env.MEDPRICE_GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    sa.project_id ||
    ""
  );
}

export function geminiConfigured(): boolean {
  const sa = loadSA();
  return !!sa && !!project(sa);
}

// ── OAuth access token (cached ~1h) ─────────────────────────────
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let _token: { value: string; exp: number } | null = null;

async function getAccessToken(sa: SA): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_token && _token.exp - 60 > now) return _token.value;

  const tokenUri = sa.token_uri || OAUTH_URL;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(header + "." + claim);
  const sig = b64url(signer.sign(sa.private_key));
  const jwt = header + "." + claim + "." + sig;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  _token = { value: data.access_token, exp: now + (data.expires_in || 3600) };
  return _token.value;
}

function endpoint(sa: SA): string {
  const proj = project(sa);
  const host =
    LOCATION === "global"
      ? "aiplatform.googleapis.com"
      : LOCATION + "-aiplatform.googleapis.com";
  const root =
    "https://" +
    host +
    "/v1/projects/" +
    proj +
    "/locations/" +
    LOCATION +
    "/publishers/google/models/" +
    MODEL;
  return root + ":streamGenerateContent?alt=sse";
}

type Part = { text: string };
type Content = { role: "user" | "model"; parts: Part[] };
function toContents(messages: ChatTurn[]): Content[] {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

// Streams plain-text deltas from Vertex. `useSearch` enables Google grounding.
export async function* streamGemini(opts: {
  system: string;
  messages: ChatTurn[];
  useSearch?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const sa = loadSA();
  if (!sa) throw new Error("Vertex credentials not configured");
  const token = await getAccessToken(sa);

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: toContents(opts.messages),
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
  };
  if (opts.useSearch) body.tools = [{ googleSearch: {} }];

  const res = await fetch(endpoint(sa), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Vertex ${res.status}: ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const json = s.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const obj = JSON.parse(json);
        const parts = obj?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (typeof p?.text === "string" && p.text) yield p.text as string;
          }
        }
      } catch {
        // partial JSON split across chunks — safe to skip
      }
    }
  }
}
