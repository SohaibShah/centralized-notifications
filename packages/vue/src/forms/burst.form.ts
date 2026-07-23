import type { FormSchema } from "./types";

/** Burst control: N varied notifications, optionally seeded for reproducibility. */
export const burstForm: FormSchema = {
  id: "burst",
  fields: [
    { name: "count", label: "Count", type: "number", required: true, default: 25 },
    { name: "seed", label: "Seed (optional)", type: "number", placeholder: "reproducible output" },
  ],
  submitLabel: "Publish burst",
  submittingLabel: "Publishing…",
};
