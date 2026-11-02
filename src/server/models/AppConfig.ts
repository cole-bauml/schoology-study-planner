import { model, Schema, type InferSchemaType } from "mongoose";

const appConfigSchema = new Schema(
  {
    _id: { type: String, default: "primary" },
    schoologyKey: { type: String, required: true },
    schoologySecret: { type: String, required: true },
    openAiKey: { type: String, required: true },
    passwordHash: { type: String, required: true },
    sessionVersion: { type: Number, required: true, default: 1 }
  },
  { timestamps: true }
);

export type AppConfigData = InferSchemaType<typeof appConfigSchema>;
export const AppConfig = model<AppConfigData>("AppConfig", appConfigSchema);
