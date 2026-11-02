import { model, Schema, type InferSchemaType } from "mongoose";

const syncSnapshotSchema = new Schema(
  {
    _id: { type: String, default: "latest" },
    syncedAt: { type: Date, required: true },
    courses: { type: [Schema.Types.Mixed], required: true }
  },
  { versionKey: false }
);

export type SyncSnapshotData = InferSchemaType<typeof syncSnapshotSchema>;
export const SyncSnapshot = model<SyncSnapshotData>(
  "SyncSnapshot",
  syncSnapshotSchema
);
