import cookieParser from "cookie-parser";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response
} from "express";
import helmet from "helmet";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { requireAuth } from "./middleware/auth.js";
import { AppConfig } from "./models/AppConfig.js";
import { SyncSnapshot } from "./models/SyncSnapshot.js";
import { analyzeCourses } from "./services/analyzer.js";
import {
  clearSessionCookie,
  decrypt,
  encrypt,
  hashPassword,
  setSessionCookie,
  sessionCookieName,
  sessionIsValid,
  verifyPassword
} from "./services/security.js";
import { SchoologyClient } from "./services/schoology.js";

const setupSchema = z.object({
  schoologyKey: z.string().trim().min(1),
  schoologySecret: z.string().trim().min(1),
  openAiKey: z.string().trim().min(1),
  appPassword: z.string().min(8)
});

const settingsSchema = z.object({
  schoologyKey: z.string().trim().optional(),
  schoologySecret: z.string().trim().optional(),
  openAiKey: z.string().trim().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional()
});

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

interface SyncProgress {
  active: boolean;
  stage: "idle" | "schoology" | "analysis" | "saving" | "complete" | "error";
  message: string;
  updatedAt: string;
}

let syncProgress: SyncProgress = {
  active: false,
  stage: "idle",
  message: "Ready to sync",
  updatedAt: new Date().toISOString()
};

function updateSyncProgress(
  stage: SyncProgress["stage"],
  message: string,
  active = true
): void {
  syncProgress = { active, stage, message, updatedAt: new Date().toISOString() };
}

function readBody<T extends z.ZodType>(
  schema: T,
  body: unknown
): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(result.error.issues[0]?.message ?? "Invalid request.", 400);
  }
  return result.data;
}

export function createApp(): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/status", async (req: Request, res: Response) => {
    const config = await AppConfig.findById("primary");
    res.json({
      setupRequired: !config,
      authenticated: Boolean(
        config &&
          sessionIsValid(
            req.cookies[sessionCookieName],
            config.sessionVersion
          )
      )
    });
  });

  app.post("/api/setup", async (req: Request, res: Response) => {
    const data = readBody(setupSchema, req.body);
    const existing = await AppConfig.findById("primary");
    if (existing) throw new HttpError("Initial setup has already been completed.", 409);

    const config = await AppConfig.create({
      _id: "primary",
      schoologyKey: encrypt(data.schoologyKey),
      schoologySecret: encrypt(data.schoologySecret),
      openAiKey: encrypt(data.openAiKey),
      passwordHash: await hashPassword(data.appPassword),
      sessionVersion: 1
    });
    setSessionCookie(res, config.sessionVersion);
    res.status(201).json({ ok: true });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const data = readBody(z.object({ password: z.string().min(1) }), req.body);
    const config = await AppConfig.findById("primary");
    if (!config) throw new HttpError("Complete the initial setup first.", 428);
    if (!(await verifyPassword(data.password, config.passwordHash))) {
      throw new HttpError("That app password is incorrect.", 401);
    }
    setSessionCookie(res, config.sessionVersion);
    res.json({ ok: true });
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/settings", requireAuth, async (_req: Request, res: Response) => {
    const config = await AppConfig.findById("primary");
    if (!config) throw new HttpError("App setup is missing.", 428);
    res.json({
      schoologyConfigured: Boolean(config.schoologyKey && config.schoologySecret),
      openAiConfigured: Boolean(config.openAiKey),
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini"
    });
  });

  app.put("/api/settings", requireAuth, async (req: Request, res: Response) => {
    const data = readBody(settingsSchema, req.body);
    const config = await AppConfig.findById("primary");
    if (!config) throw new HttpError("App setup is missing.", 428);

    const changesPassword = Boolean(data.newPassword);
    if (changesPassword) {
      if (!data.currentPassword) {
        throw new HttpError("Enter your current app password to change it.", 400);
      }
      if (!(await verifyPassword(data.currentPassword, config.passwordHash))) {
        throw new HttpError("Your current app password is incorrect.", 401);
      }
    }

    if (data.schoologyKey) config.schoologyKey = encrypt(data.schoologyKey);
    if (data.schoologySecret) config.schoologySecret = encrypt(data.schoologySecret);
    if (data.openAiKey) config.openAiKey = encrypt(data.openAiKey);
    if (data.newPassword) {
      config.passwordHash = await hashPassword(data.newPassword);
      config.sessionVersion += 1;
    }
    await config.save();
    if (changesPassword) setSessionCookie(res, config.sessionVersion);
    res.json({ ok: true });
  });

  app.get("/api/dashboard", requireAuth, async (_req: Request, res: Response) => {
    const snapshot = await SyncSnapshot.findById("latest").lean();
    res.json({
      syncedAt: snapshot?.syncedAt ?? null,
      courses: snapshot?.courses ?? []
    });
  });

  app.get("/api/sync/status", requireAuth, (_req: Request, res: Response) => {
    res.json(syncProgress);
  });

  app.patch(
    "/api/courses/:courseId/checklist/:itemId",
    requireAuth,
    async (req: Request, res: Response) => {
      const { completed } = readBody(
        z.object({ completed: z.boolean() }),
        req.body
      );
      const snapshot = await SyncSnapshot.findOneAndUpdate(
        {
          _id: "latest",
          "courses.id": req.params.courseId,
          "courses.checklist.id": req.params.itemId
        },
        {
          $set: {
            "courses.$[course].checklist.$[item].completed": completed
          }
        },
        {
          arrayFilters: [
            { "course.id": req.params.courseId },
            { "item.id": req.params.itemId }
          ],
          new: true
        }
      );
      if (!snapshot) throw new HttpError("Checklist item was not found.", 404);
      res.json({ ok: true });
    }
  );

  app.post("/api/sync", requireAuth, async (_req: Request, res: Response) => {
    if (syncProgress.active) {
      throw new HttpError("A Schoology sync is already running.", 409);
    }
    updateSyncProgress("schoology", "Connecting to Schoology");
    try {
      const config = await AppConfig.findById("primary");
      if (!config) throw new HttpError("App setup is missing.", 428);
      const schoology = new SchoologyClient({
        key: decrypt(config.schoologyKey),
        secret: decrypt(config.schoologySecret)
      });
      const schoologyData = await schoology.fetchAllCourses((message) => {
        updateSyncProgress("schoology", message);
      });
      const courses = await analyzeCourses(
        schoologyData.courses,
        decrypt(config.openAiKey),
        process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        (message) => updateSyncProgress("analysis", message)
      );
      const previousSnapshot = await SyncSnapshot.findById("latest").lean();
      const previousCourses: unknown[] = Array.isArray(previousSnapshot?.courses)
        ? previousSnapshot.courses
        : [];
      for (const course of courses) {
        const previousCourse = previousCourses.find(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            "id" in value &&
            value.id === course.id
        );
        const previousChecklist: unknown[] =
          typeof previousCourse === "object" &&
          previousCourse !== null &&
          "checklist" in previousCourse &&
          Array.isArray(previousCourse.checklist)
            ? previousCourse.checklist
            : [];
        for (const item of course.checklist) {
          const previousItem = previousChecklist.find(
            (value) =>
              typeof value === "object" &&
              value !== null &&
              "id" in value &&
              value.id === item.id
          );
          if (
            typeof previousItem === "object" &&
            previousItem !== null &&
            "completed" in previousItem &&
            typeof previousItem.completed === "boolean"
          ) {
            item.completed = previousItem.completed;
          }
        }
      }
      updateSyncProgress("saving", "Saving your course checklist");
      const syncedAt = new Date();
      await SyncSnapshot.findByIdAndUpdate(
        "latest",
        { _id: "latest", syncedAt, courses },
        { upsert: true, new: true, runValidators: true }
      );
      updateSyncProgress("complete", "Sync complete", false);
      res.json({ syncedAt, courses });
    } catch (error) {
      updateSyncProgress(
        "error",
        error instanceof Error ? error.message : "The sync failed.",
        false
      );
      throw error;
    }
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });

  const clientPath = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "../client"
  );
  app.use(express.static(clientPath));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(resolve(clientPath, "index.html"));
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Request failed:", error);
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "An unexpected server error occurred."
    });
  };
  app.use(errorHandler);
  return app;
}
