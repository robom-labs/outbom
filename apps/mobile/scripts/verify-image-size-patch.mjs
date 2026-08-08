// image-size의 조작된 ICNS·JXL 입력이 무한 반복 없이 종료되는지 별도 프로세스로 검증한다.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function writeAscii(buffer, offset, value) {
  for (let index = 0; index < value.length; index += 1) buffer[offset + index] = value.charCodeAt(index);
}

function writeUint32BE(buffer, offset, value) {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
}

function packageDirectory() {
  const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const virtualStore = resolve(appDirectory, "node_modules/.pnpm");
  const entries = readdirSync(virtualStore).filter((name) => name.startsWith("image-size@1.2.1"));
  const entry = entries.find((name) => name.includes("patch_hash=")) ?? entries[0];
  if (!entry) throw new Error("image-size@1.2.1 설치 경로를 찾지 못했습니다.");
  return resolve(virtualStore, entry, "node_modules/image-size");
}

function runChild(kind) {
  if (kind === "icns") {
    const input = new Uint8Array(16);
    writeAscii(input, 0, "icns");
    writeUint32BE(input, 4, 16);
    writeAscii(input, 8, "ic07");
    writeUint32BE(input, 12, 0);
    const { ICNS } = require(resolve(packageDirectory(), "dist/types/icns.js"));
    try { ICNS.calculate(input); } catch { return; }
    return;
  }

  const input = new Uint8Array(16);
  writeUint32BE(input, 0, 0);
  writeAscii(input, 4, "jxlp");
  const { JXL } = require(resolve(packageDirectory(), "dist/types/jxl.js"));
  try { JXL.calculate(input); } catch { return; }
}

if (process.argv[2] === "--child") {
  runChild(process.argv[3]);
} else {
  const script = fileURLToPath(import.meta.url);
  for (const kind of ["icns", "jxl"]) {
    execFileSync(process.execPath, [script, "--child", kind], {
      stdio: "pipe",
      timeout: 2_000
    });
  }
  console.log("image-size patch verification: ICNS/JXL malformed input terminates");
}
