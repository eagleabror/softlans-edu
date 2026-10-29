import express, { type Express } from "express";
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { AppError } from "./errors.js";

export function notFound() {
  return new AppError(404, "NOT_FOUND", "Sahifa topilmadi.");
}

export function serveFrontend(app: Express, directory: string) {
  const index = resolve(directory, "index.html");
  // A broken build must fail startup instead of passing Render's health check.
  if (!existsSync(index)) throw new Error("Frontend build is required");
  app.use(
    express.static(resolve(directory), {
      index: false,
      redirect: false,
      dotfiles: "ignore",
      // Retain the application's no-store header, including for index.html.
      cacheControl: false,
    }),
  );
  app.get("/{*path}", (req, res, next) => {
    // Missing assets and non-HTML clients get a real 404, never the SPA shell.
    if (
      !req.accepts("html") ||
      extname(req.path) ||
      req.path.startsWith("/assets/") ||
      req.path.split("/").some((segment) => segment.startsWith("."))
    ) {
      next(notFound());
      return;
    }
    res.sendFile(index, (error) => {
      if (error) next(error);
    });
  });
}
