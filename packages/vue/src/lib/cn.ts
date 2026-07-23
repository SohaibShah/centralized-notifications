import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional classes and resolve Tailwind conflicts (base → variant → override). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
