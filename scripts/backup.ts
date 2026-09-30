import { backup } from "node:sqlite";
import { mkdir, copyFile, chmod, writeFile, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../server/db.ts";
import { dataPath } from "../server/paths.ts";
const name =
  new Date().toISOString().replace(/[:.]/g, "-") +
  "-" +
  randomBytes(3).toString("hex");
const destination = resolve(process.argv[2] ?? dataPath("backups"), name);
await mkdir(destination, { recursive: true, mode: 0o700 });
try {
  await backup(db, join(destination, "surveys.sqlite"));
  const files = ["surveys.sqlite"];
  for (const file of ["admin-access.txt", "operator.json", "deployment.json"]) {
    try {
      await copyFile(
        dataPath(file),
        join(destination, file),
        constants.COPYFILE_EXCL,
      );
      files.push(file);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const checksums: Record<string, string> = {};
  for (const file of files) {
    await chmod(join(destination, file), 0o600);
    checksums[file] = createHash("sha256")
      .update(await readFile(join(destination, file)))
      .digest("hex");
  }
  await writeFile(
    join(destination, "manifest.json"),
    JSON.stringify(
      {
        app: "ootle-surveys",
        version: 1,
        created: new Date().toISOString(),
        checksums,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("Complete backup saved to " + destination);
} finally {
  db.close();
}
