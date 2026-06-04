export const config = { runtime: "edge" };

const RELAYER_ORIGIN = "https://relayer.testnet.zama.org";

const FORWARD_REQ_HEADERS = new Set([
  "content-type",
  "accept",
  "accept-encoding",
  "x-zama-client",
  "zama-sdk-version",
  "zama-sdk-name",
]);

function filterRequestHeaders(src) {
  const out = new Headers();
  for (const [k, v] of src.entries()) {
    if (FORWARD_REQ_HEADERS.has(k.toLowerCase())) out.set(k, v);
  }
  return out;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  const url = new URL(req.url);
  let path = url.pathname.replace(/^\/api\/zama-relay/, "") || "/";

  // The Zama relayer migrated its API under /v2; the bare paths (/keyurl, /input-proof, …)
  // that the legacy relayer-sdk 0.4.x requests with default config now 404. relayer-sdk 0.4.3
  // natively speaks the v2 protocol, so normalize every forwarded path to the /v2 route.
  path = path.replace(/^\/v[12](?=\/|$)/, "");   // drop any existing version segment
  path = path === "/" ? "/v2" : `/v2${path}`;     // always target /v2

  const target = `${RELAYER_ORIGIN}${path}${url.search ?? ""}`;

  const response = await fetch(target, {
    method: req.method,
    headers: filterRequestHeaders(req.headers),
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
  });

  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";
  const data =
    contentType.includes("application/octet-stream") ||
    contentType.includes("binary")
      ? await response.arrayBuffer()
      : await response.text();

  return new Response(data, {
    status: response.status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "content-type": contentType,
      "ZAMA-SDK-VERSION": response.headers.get("ZAMA-SDK-VERSION") ?? "",
      "ZAMA-SDK-NAME": response.headers.get("ZAMA-SDK-NAME") ?? "",
    },
  });
}
