export { cn } from "cn"

/** plural(1, "part") → "1 part", plural(3, "part") → "3 parts". */
export const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
