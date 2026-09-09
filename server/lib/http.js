// Thin fetch wrapper with timeouts, JSON handling, and friendly errors.

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function fetchJson(url, options = {}) {
  const { timeoutMs = 20000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(
        res.status,
        `Request to ${new URL(url).host} failed with status ${res.status}`,
        text.slice(0, 2000)
      );
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(502, `Unexpected non-JSON response from ${new URL(url).host}`, text.slice(0, 500));
    }
  } catch (err) {
    if (err.name === "AbortError") {
      throw new HttpError(504, `Request to ${new URL(url).host} timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
