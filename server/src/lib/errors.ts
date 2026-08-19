export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, "BAD_REQUEST", d);
export const unauthorized = (m = "Authentication required") => new HttpError(401, m, "UNAUTHORIZED");
export const forbidden = (m = "Insufficient permission") => new HttpError(403, m, "FORBIDDEN");
export const notFound = (m = "Not found") => new HttpError(404, m, "NOT_FOUND");
export const conflict = (m: string) => new HttpError(409, m, "CONFLICT");
export const locked = (m: string) => new HttpError(423, m, "LOCKED");
export const tooMany = (m: string) => new HttpError(429, m, "RATE_LIMIT");
