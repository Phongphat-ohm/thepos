import type { ErrorCode } from "@thepos/contracts";

export class ApiError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 423 | 429 | 503, readonly code: ErrorCode) {
    super(code);
  }
}
