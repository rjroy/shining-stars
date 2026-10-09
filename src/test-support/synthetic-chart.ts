export type SyntheticLane = 0 | 1 | 2 | 3;

export interface SyntheticChartNote {
  readonly id: string;
  readonly time: number;
  readonly lane: SyntheticLane;
}

export const syntheticChart = [
  { id: 'synthetic-1', time: 0.5, lane: 0 },
  { id: 'synthetic-2', time: 1.25, lane: 3 },
] as const satisfies readonly SyntheticChartNote[];
