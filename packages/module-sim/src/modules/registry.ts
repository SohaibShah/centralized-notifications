import { accessGovernance } from "./access-governance";
import { assessments } from "./assessments";
import { dataMapping } from "./data-mapping";
import { dsr } from "./dsr";
import type { SimModule } from "./types";

/** All simulated modules, keyed by the module key the hub uses in a dispatch URL's `:module` segment. */
const modules: Record<string, SimModule> = {
  [dsr.key]: dsr,
  [accessGovernance.key]: accessGovernance,
  [dataMapping.key]: dataMapping,
  [assessments.key]: assessments,
};

/** Looks up a simulated module by key; `undefined` for an unregistered/unknown module. */
export function lookupModule(key: string): SimModule | undefined {
  return modules[key];
}
