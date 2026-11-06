import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "../src/errors.js";

afterEach(() => vi.restoreAllMocks());
it("logs route templates and request IDs without URL parameters, secrets or bodies", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.requestId = "test-request"; next(); });
  app.post("/students/:id", () => { throw new Error("private database credentials"); });
  app.use(errorHandler);
  const res = await request(app).post("/students/private-student-name?token=private-token")
    .set("Cookie", "session=private-cookie").send({ password: "private-password" });
  expect(res.status).toBe(500);
  expect(res.body.error).toEqual({ code: "INTERNAL_ERROR", message: "Serverda xatolik yuz berdi. Keyinroq urinib ko‘ring.", requestId: "test-request" });
  expect(log.mock.calls).toEqual([[JSON.stringify({ event: "request_failed", requestId: "test-request", method: "POST", route: "/students/:id" })]]);
});

it("does not log a concrete URL when failure happens before route matching", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = express();
  app.use((_req, res, next) => { res.locals.requestId = "test-request"; next(new Error("private")); });
  app.use(errorHandler);
  expect((await request(app).get("/private-student-name")).status).toBe(500);
  expect(JSON.parse(log.mock.calls[0]![0])).toEqual({ event: "request_failed", requestId: "test-request", method: "GET", route: "unmatched" });
});
