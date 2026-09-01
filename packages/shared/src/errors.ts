export const ErrorCodes = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION",
  CONFLICT: "CONFLICT",
  INVALID_STATE: "INVALID_STATE",
  FORBIDDEN: "FORBIDDEN",
  PROVIDER: "PROVIDER",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const errorStatus: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  INVALID_STATE: 409,
  FORBIDDEN: 403,
  PROVIDER: 502,
  INTERNAL: 500,
};

/** Domain error thrown by core services. REST maps `code` to an HTTP status, MCP to `isError`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return errorStatus[this.code];
  }

  static notFound(entity: string, id: string): AppError {
    return new AppError("NOT_FOUND", `${entity} ${id} not found`);
  }
}
