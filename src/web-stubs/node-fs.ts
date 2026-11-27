// The web build has no file system: nothing exists and nothing is written.
export const existsSync = () => false;
export const readFileSync = () => {
  throw new Error("no file system");
};
export const writeFileSync = () => {};
export const mkdirSync = () => {};
export const renameSync = () => {};
export default { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync };
