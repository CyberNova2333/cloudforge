/** Container instance types an Actions job runs on, smallest first. Its own module: settings.ts reads it at load. */
export const SIZES = [
  'lite',
  'standard-1',
  'standard-2',
  'standard-3',
  'standard-4',
] as const;

export type InstanceType = (typeof SIZES)[number];
