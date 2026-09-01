import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { AppError, type ErrorResponse } from "@llmeval/shared";

export function errorBody(code: string, message: string, details?: unknown): ErrorResponse {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function handleError(err: unknown, c: Context): Response {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof AppError) {
    return c.json(
      errorBody(err.code, err.message, err.details),
      err.status as ContentfulStatusCode,
    );
  }
  if (err instanceof ZodError) {
    return c.json(errorBody("VALIDATION", "Invalid request", err.issues), 400);
  }
  console.error(err);
  const message = err instanceof Error ? err.message : "Unexpected error";
  return c.json(errorBody("INTERNAL", message), 500);
}
