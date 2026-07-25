// @ts-nocheck — vendored dither-kit source (kept as shipped)
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/** Tailwind-aware className combiner — local copy so the chart pack is
 * self-contained and portable as a registry. */
export const cn = (...inputs: ClassValue[]) => {
  return twMerge(clsx(inputs))
};