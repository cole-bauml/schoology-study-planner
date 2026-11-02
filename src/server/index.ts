import "dotenv/config";
import mongoose from "mongoose";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  throw new Error("MONGODB_URI is not configured. See .env.example.");
}
if (!process.env.APP_ENCRYPTION_KEY || !process.env.SESSION_SECRET) {
  throw new Error("APP_ENCRYPTION_KEY and SESSION_SECRET must be configured.");
}

await mongoose.connect(mongoUri);
const app = createApp();
app.listen(port, () => {
  console.log(`Dublin Study Planner API listening on http://localhost:${port}`);
});
