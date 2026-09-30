import { resolve, join } from "node:path";
export const dataDirectory = resolve(process.env.SURVEY_DATA_DIR ?? "data");
export const dataPath = (name: string) => join(dataDirectory, name);
