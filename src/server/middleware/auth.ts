import type { NextFunction, Request, Response } from "express";
import { AppConfig } from "../models/AppConfig.js";
import { sessionCookieName, sessionIsValid } from "../services/security.js";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const config = await AppConfig.findById("primary");
    if (!config) {
      res.status(428).json({ error: "Complete the initial setup first." });
      return;
    }
    if (!sessionIsValid(req.cookies[sessionCookieName], config.sessionVersion)) {
      res.status(401).json({ error: "Please unlock the app to continue." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
