export function comparisonBars(
  value: number,
  reference: number,
  lowerIsBetter = false,
) {
  const scale = Math.max(value, reference, 1);
  return {
    valueWidth: (Math.max(0, value) / scale) * 100,
    referenceWidth: (Math.max(0, reference) / scale) * 100,
    direction:
      value === reference
        ? "equal"
        : (lowerIsBetter ? value < reference : value > reference)
          ? "better"
          : "review",
  } as const;
}

export function deathInterval(
  time: number,
  seconds: number | null,
  duration: number,
) {
  if (duration <= 0 || time < 0 || time >= duration) return null;
  return {
    left: (time / duration) * 100,
    width:
      seconds === null
        ? null
        : (Math.max(0, Math.min(seconds, duration - time)) / duration) * 100,
  };
}
