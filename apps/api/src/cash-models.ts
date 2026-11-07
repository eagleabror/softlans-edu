import mongoose, { Schema } from "mongoose";

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const money = {
  type: Number,
  required: true,
  min: 0,
  max: Number.MAX_SAFE_INTEGER,
  validate: Number.isSafeInteger,
};
const options = { timestamps: true as const, strict: "throw" as const };
export const expenseClassifications = [
  "operating",
  "capital",
  "prepayment",
  "unclassified",
] as const;
const category = new Schema(
  {
    tenantId: ref("Tenant"),
    name: { type: String, required: true, maxlength: 120 },
    active: { type: Boolean, default: true },
    accountingClassification: {
      type: String,
      enum: expenseClassifications,
      default: "unclassified",
    },
    createdBy: ref("User"),
  },
  options,
);
category.index({ tenantId: 1, name: 1 }, { unique: true });
const account = new Schema(
  {
    tenantId: ref("Tenant"),
    name: { type: String, required: true, maxlength: 120 },
    kind: {
      type: String,
      enum: ["cash", "bank", "manual"],
      required: true,
      immutable: true,
    },
    active: { type: Boolean, default: true },
    openingDate: { type: String, default: null },
    createdBy: ref("User"),
  },
  options,
);
account.index({ tenantId: 1, name: 1 }, { unique: true });
const expense = new Schema(
  {
    tenantId: ref("Tenant"),
    createdBy: ref("User"),
    amount: { ...money, min: 1 },
    categoryId: ref("ExpenseCategory"),
    // Snapshot for NEW drafts only. Historical missing values always require review.
    accountingClassification: {
      type: String,
      enum: expenseClassifications,
      immutable: true,
    },
    categoryName: { type: String, immutable: true },
    accountId: ref("CashAccount"),
    description: { type: String, required: true, maxlength: 1000 },
    expenseDate: { type: String, required: true },
    method: { type: String, enum: ["cash", "bank_transfer"], required: true },
    supplier: { type: String, default: "", maxlength: 200 },
    reference: { type: String, default: "", maxlength: 200 },
    status: {
      type: String,
      enum: ["draft", "confirmed", "voided"],
      default: "draft",
    },
  },
  options,
);
expense.index({ tenantId: 1, expenseDate: -1, _id: -1 });
expense.index({ tenantId: 1, createdBy: 1, status: 1 });
expense.pre("save", async function () {
  if (this.isNew) return;
  const prior = await this.$model("Expense")
    .findById(this._id)
    .session(this.$session());
  if (!prior) throw new Error("Expense history missing");
  const permitted =
    prior.get("status") === "draft"
      ? ["confirmed", "voided"].includes(this.status)
      : prior.get("status") === "confirmed" && this.status === "voided";
  if (
    !permitted ||
    this.modifiedPaths().some((path) => !["status", "updatedAt"].includes(path))
  )
    throw new Error("Expense corrections require void and replacement");
});
expense.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ],
  function () {
    throw new Error("Expense corrections require void and replacement");
  },
);
expense.pre("deleteOne", { document: true, query: false }, function () {
  throw new Error("Expense corrections require void and replacement");
});
expense.pre("bulkWrite", function () {
  throw new Error("Expense corrections require void and replacement");
});
const movement = new Schema(
  {
    tenantId: ref("Tenant"),
    recordedBy: ref("User"),
    accountId: ref("CashAccount"),
    delta: { type: Number, required: true, validate: Number.isSafeInteger },
    date: { type: String, required: true },
    kind: {
      type: String,
      enum: [
        "opening",
        "manual_in",
        "manual_out",
        "transfer",
        "expense",
        "expense_void",
        "payment",
        "payment_reversal",
        "salary",
        "salary_reversal",
        "movement_void",
      ],
      required: true,
    },
    sourceId: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
  },
  options,
);
movement.index(
  { tenantId: 1, kind: 1, sourceId: 1, accountId: 1 },
  { unique: true },
);
// Source receipts/payouts/expenses may belong to exactly one account.
// Transfers alone have two account legs under the same source id.
movement.index(
  { tenantId: 1, kind: 1, sourceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: {
        $in: [
          "payment",
          "payment_reversal",
          "salary",
          "salary_reversal",
          "expense",
          "expense_void",
          "opening",
        ],
      },
    },
  },
);
movement.index({ tenantId: 1, accountId: 1, date: 1, _id: 1 });
movement.index({ tenantId: 1, date: 1, _id: 1 });
const operation = new Schema(
  {
    tenantId: ref("Tenant"),
    recordedBy: ref("User"),
    key: { type: String, required: true },
    fingerprint: { type: String, required: true },
    result: { type: Schema.Types.Mixed, required: true },
  },
  options,
);
operation.index({ tenantId: 1, key: 1 }, { unique: true });
const audit = new Schema(
  {
    tenantId: ref("Tenant"),
    recordedBy: ref("User"),
    entityId: { type: String, required: true },
    action: { type: String, required: true },
    reason: { type: String, required: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
  },
  options,
);
audit.index({ tenantId: 1, entityId: 1, createdAt: 1 });

// Append-only at the application model boundary, including query and document APIs.
function appendOnly(schema: Schema) {
  schema.pre("save", function () {
    if (!this.isNew) throw new Error("Immutable financial event");
  });
  schema.pre(
    [
      "updateOne",
      "updateMany",
      "findOneAndUpdate",
      "replaceOne",
      "findOneAndReplace",
      "deleteOne",
      "deleteMany",
      "findOneAndDelete",
    ],
    function () {
      throw new Error("Immutable financial event");
    },
  );
  schema.pre("deleteOne", { document: true, query: false }, function () {
    throw new Error("Immutable financial event");
  });
  schema.pre("bulkWrite", function () {
    throw new Error("Immutable financial event");
  });
}
appendOnly(movement);
appendOnly(operation);
appendOnly(audit);
export const ExpenseCategory = mongoose.model("ExpenseCategory", category);
export const CashAccount = mongoose.model("CashAccount", account);
export const Expense = mongoose.model("Expense", expense);
export const CashMovement = mongoose.model("CashMovement", movement);
export const CashOperation = mongoose.model("CashOperation", operation);
export const CashAudit = mongoose.model("CashAudit", audit);
export const cashModels = [
  ExpenseCategory,
  CashAccount,
  Expense,
  CashMovement,
  CashOperation,
  CashAudit,
];
