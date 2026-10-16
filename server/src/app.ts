import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin/index.js";
import { assessmentRouter } from "./routes/assessment.js";
import { profileRouter } from "./routes/profile.js";
import { playgroundRouter } from "./routes/playground.js";
import { errorHandler } from "./middleware/error.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: env.APP_URL,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser() as unknown as express.RequestHandler);

  // Login only: keep abuse control, but allow a cohort behind one office IP.
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    message: { error: "Too many sign-in attempts from this network. Wait a few minutes, then try again.", code: "RATE_LIMIT" },
  });
  const authLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    standardHeaders: true,
    message: { error: "Too many auth requests. Wait a moment, then try again.", code: "RATE_LIMIT" },
  });
  const apiLimit = rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true });

  app.get("/api/health", (_req, res) => res.json({ ok: true, name: "SEAL", time: new Date().toISOString() }));
  app.use("/api/auth/login", loginLimit as unknown as express.RequestHandler);
  app.use("/api/auth", authLimit as unknown as express.RequestHandler, authRouter);
  app.use("/api/admin", apiLimit as unknown as express.RequestHandler, adminRouter);
  app.use("/api/assessment", apiLimit as unknown as express.RequestHandler, assessmentRouter);
  app.use("/api/profile", apiLimit as unknown as express.RequestHandler, profileRouter);
  app.use("/api/playground", apiLimit as unknown as express.RequestHandler, playgroundRouter);
  app.use(errorHandler as express.ErrorRequestHandler);
  return app;
}
