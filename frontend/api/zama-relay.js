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
  const path = url.pathname.replace(/^\/api\/zama-relay/, "") || "/";
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
