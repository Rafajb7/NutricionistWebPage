/** Keep the existing storage format so published plans and saved drafts remain compatible. */
export function parseGuidanceEntries(value: string): string[] {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

export function serializeGuidanceEntries(entries: string[]): string {
  return entries.flatMap(parseGuidanceEntries).join("\n");
}
