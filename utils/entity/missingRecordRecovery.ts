export const isMissingLocalRecordError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /record not found/i.test(message) || /record\s+\w+#.+\s+not found/i.test(message);
};
