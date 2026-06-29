import type { ServerResponse } from "node:http";

export const json = (res: ServerResponse, statusCode: number, body: unknown) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
};

export const text = (res: ServerResponse, statusCode: number, body: string, contentType = "text/plain; charset=utf-8") => {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
};

export const readBody = async (request: NodeJS.ReadableStream, maxBytes = 100 * 1024 * 1024) => {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error(`Request body exceeds ${maxBytes} bytes.`);
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
};

export const parseBearerToken = (authorization?: string) => {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

export const contentTypeFor = (pathname: string) => {
  const dot = pathname.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return contentTypes[pathname.slice(dot).toLowerCase()] || "application/octet-stream";
};
