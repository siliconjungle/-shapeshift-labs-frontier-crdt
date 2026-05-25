import { applyPatchImmutable } from '@shapeshift-labs/frontier/apply';
import type { JsonValue, Patch } from './types.js';

export function applyCrdtViewPatch(value: JsonValue, patch: Patch): JsonValue {
  return applyPatchImmutable(value, patch);
}
