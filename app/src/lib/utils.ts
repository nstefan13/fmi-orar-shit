export { cn } from "cn"

export function allElementsUnique<T>(list: T[]): boolean {
  return list.length === new Set(list).size
}
