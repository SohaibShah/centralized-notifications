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

/** Looks up a simulated module by key; `undefined` for an unregistered/unknown module.
 * `key` reaches here as caller/request input (route params, `/emit`'s `custom.module`), so a
 * plain `modules[key]` property lookup would resolve inherited `Object.prototype` keys like
 * `"__proto__"`/`"constructor"`/`"toString"` as truthy hits instead of 404ing/erroring as an
 * unknown module — `hasOwn` restricts the lookup to the module's own registered keys. */
export function lookupModule(key: string): SimModule | undefined {
  return Object.hasOwn(modules, key) ? modules[key] : undefined;
}

/** All simulated modules, for callers (the emit generator, Task 12) that iterate every module
 * rather than looking one up by key. */
export const ALL_MODULES: readonly SimModule[] = Object.values(modules);
