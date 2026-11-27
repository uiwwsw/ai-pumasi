// The web build has no file system. Shared modules import node:path at the top; this stands in.
export const join = (...parts: string[]) => parts.join("/");
export const dirname = (p: string) => p.split("/").slice(0, -1).join("/") || ".";
export const basename = (p: string) => p.split("/").pop() ?? "";
export default { join, dirname, basename };
