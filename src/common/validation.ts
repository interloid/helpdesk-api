import type { ValidationError } from "class-validator";

/**
 * Flatten class-validator errors into `{ "path.to.field": ["message", ...] }`, including nested objects.
 * Shared by env validation and request DTO validation so both report errors the same way.
 */
export function formatValidationErrors(
  errors: ValidationError[],
  parentPath = "",
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    const path = parentPath ? `${parentPath}.${e.property}` : e.property;
    if (e.constraints) out[path] = Object.values(e.constraints);
    if (e.children?.length) Object.assign(out, formatValidationErrors(e.children, path));
  }
  return out;
}
