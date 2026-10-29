import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = res.locals.requestId as string;
  if (error instanceof ZodError) {
    res
      .status(400)
      .json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Kiritilgan ma’lumotlarni tekshiring.",
          fields: error.flatten().fieldErrors,
          requestId,
        },
      });
    return;
  }
  if (error instanceof AppError) {
    res
      .status(error.status)
      .json({ error: { code: error.code, message: error.message, requestId } });
    return;
  }
  if (error?.code === 11000) {
    res
      .status(409)
      .json({
        error: {
          code: "ACCOUNT_CONFLICT",
          message: "Bu ma’lumotlar bilan hisob yaratib bo‘lmadi.",
          requestId,
        },
      });
    return;
  }
  const status =
    error?.type === "entity.too.large"
      ? 413
      : error instanceof SyntaxError && "body" in error
        ? 400
        : 500;
  // Never log request bodies, cookies, database connection strings, or raw errors.
  if (status === 500)
    console.error(
      JSON.stringify({
        event: "request_failed",
        requestId,
        method: req.method,
        path: req.path,
      }),
    );
  res
    .status(status)
    .json({
      error: {
        code: status === 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
        message:
          status === 500
            ? "Serverda xatolik yuz berdi. Keyinroq urinib ko‘ring."
            : "So‘rov formati noto‘g‘ri.",
        requestId,
      },
    });
};
