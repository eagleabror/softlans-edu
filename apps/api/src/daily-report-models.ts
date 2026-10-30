import mongoose, { Schema } from "mongoose";
const settings = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    enabled: { type: Boolean, default: false },
    time: { type: String, default: "20:00" },
    timezone: {
      type: String,
      enum: ["Asia/Tashkent"],
      default: "Asia/Tashkent",
    },
    sections: {
      type: [String],
      default: ["students", "financial", "attendance", "payroll"],
    },
    quietStart: { type: String, default: "21:00" },
    quietEnd: { type: String, default: "08:00" },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true, strict: "throw" },
);
settings.index({ tenantId: 1, userId: 1 }, { unique: true });
settings.index({ enabled: 1, time: 1 });
export const DailyReportSettings = mongoose.model(
  "DailyReportSettings",
  settings,
);
