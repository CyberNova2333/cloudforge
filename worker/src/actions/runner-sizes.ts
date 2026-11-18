// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and ADDITIONAL_TERMS.zh-CN.md; ref: ADDITIONAL_TERMS.en.md).
/** Container instance types an Actions job runs on, smallest first. Its own module: settings.ts reads it at load. */
export const SIZES = [
  'lite',
  'standard-1',
  'standard-2',
  'standard-3',
  'standard-4',
] as const;

export type InstanceType = (typeof SIZES)[number];
