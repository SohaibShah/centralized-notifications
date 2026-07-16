import type { FormSchema } from "./types";

/** Drip control: repeat a burst every N seconds. totalTicks 0 = until Stop. */
export const dripForm: FormSchema = {
  id: "drip",
  fields: [
    { name: "count", label: "Per tick", type: "number", required: true, default: 5 },
    {
      name: "intervalSeconds",
      label: "Every (seconds)",
      type: "number",
      required: true,
      default: 3,
    },
    { name: "totalTicks", label: "Total ticks (0 = until Stop)", type: "number", default: 0 },
  ],
  submitLabel: "Start drip",
};
