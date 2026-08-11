// 설치된 production 의존성을 npm Bulk Advisory API로 검사해 high 이상 취약점에서 출시를 중단한다.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dirIndex = process.argv.indexOf("--dir");
const targetDir = resolve(process.cwd(), dirIndex >= 0 ? process.argv[dirIndex + 1] : ".");
const usesPnpm = existsSync(resolve(targetDir, "pnpm-lock.yaml"));
const usesNpm = existsSync(resolve(targetDir, "package-lock.json"));
const targetPackage = JSON.parse(readFileSync(resolve(targetDir, "package.json"), "utf8"));
const imageSizePatch = targetPackage.pnpm?.patchedDependencies?.["image-size@1.2.1"];
const patchedAdvisoryIds = new Set();

if (imageSizePatch === "patches/image-size@1.2.1.patch") {
  const verifier = resolve(targetDir, "scripts/verify-image-size-patch.mjs");
  if (!existsSync(verifier)) throw new Error("image-size 보안 패치 검증 스크립트가 없습니다.");
  const verified = spawnSync(process.execPath, [verifier], {
    cwd: targetDir,
    encoding: "utf8",
    timeout: 10_000
  });
  if (verified.status !== 0) {
    throw new Error(`image-size 보안 패치 검증 실패: ${verified.stderr.trim() || verified.stdout.trim()}`);
  }
  patchedAdvisoryIds.add("GHSA-5p2g-fcmc-qvqq");
  patchedAdvisoryIds.add("GHSA-w3rx-r6r6-pgpr");
}

if (!usesPnpm && !usesNpm) {
  throw new Error(`지원하는 lockfile이 없습니다: ${targetDir}`);
}

const command = usesPnpm ? "pnpm" : "npm";
const commandArgs = usesPnpm
  ? [...(existsSync(resolve(targetDir, "pnpm-workspace.yaml")) ? ["-r"] : []), "list", "--prod", "--parseable", "--depth", "Infinity"]
  : ["ls", "--omit=dev", "--all", "--parseable"];
const listed = spawnSync(command, commandArgs, {
  cwd: targetDir,
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024
});

if (!listed.stdout.trim()) {
  throw new Error(`의존성 목록을 읽지 못했습니다: ${listed.stderr.trim() || `exit ${listed.status}`}`);
}

const packages = new Map();
for (const packageDir of new Set(listed.stdout.split(/\r?\n/).filter(Boolean))) {
  const packageFile = resolve(packageDir, "package.json");
  if (!existsSync(packageFile)) continue;
  const metadata = JSON.parse(readFileSync(packageFile, "utf8"));
  if (typeof metadata.name !== "string" || typeof metadata.version !== "string") continue;
  if (!packages.has(metadata.name)) packages.set(metadata.name, new Set());
  packages.get(metadata.name).add(metadata.version);
}

if (patchedAdvisoryIds.size > 0 && !packages.get("image-size")?.has("1.2.1")) {
  throw new Error("검증한 image-size@1.2.1과 실제 production 의존성이 일치하지 않습니다.");
}

const requestBody = Object.fromEntries(
  [...packages.entries()].map(([name, versions]) => [name, [...versions].sort()])
);
const response = await fetch("https://registry.npmjs.org/-/npm/v1/security/advisories/bulk", {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json"
  },
  body: JSON.stringify(requestBody),
  signal: AbortSignal.timeout(20_000)
});

if (!response.ok) {
  throw new Error(`npm 보안 감사 실패: ${response.status} ${response.statusText}`);
}

const advisoryMap = await response.json();
const advisories = Object.entries(advisoryMap).flatMap(([name, values]) =>
  values.map((advisory) => ({ name, ...advisory }))
);
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
advisories.sort((left, right) => (severityRank[right.severity] ?? -1) - (severityRank[left.severity] ?? -1));

for (const advisory of advisories) {
  const advisoryId = advisory.url?.split("/").pop();
  const patchLabel = patchedAdvisoryIds.has(advisoryId) ? " · local patch verified" : "";
  console.log(`[${advisory.severity}] ${advisory.name}: ${advisory.title} · ${advisory.url}${patchLabel}`);
}

const blocking = advisories.filter((advisory) => {
  const advisoryId = advisory.url?.split("/").pop();
  return (severityRank[advisory.severity] ?? -1) >= severityRank.high && !patchedAdvisoryIds.has(advisoryId);
});
console.log(`production audit: ${packages.size} packages · ${advisories.length} advisories · high/critical ${blocking.length}`);

if (blocking.length > 0) process.exitCode = 1;
