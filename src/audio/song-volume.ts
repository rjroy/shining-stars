/** Parse the output-only song volume setting. Invalid values safely use full volume. */
export function parseSongOutputVolume(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 1;
  const volume = Number(value);
  return Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 1;
}
