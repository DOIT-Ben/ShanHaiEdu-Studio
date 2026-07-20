import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourcePath = "tests/fixtures/provider-ledger/manifest.json";
const targetPath = "API台账系统/manifest.json";

export function createCiPublicProviderManifest(source) {
  if (!source || typeof source !== "object" || Array.isArray(source) || !Number.isInteger(source.version) || !Array.isArray(source.providers)) {
    throw new Error("CI Provider ledger fixture is invalid.");
  }
  return {
    ...source,
    project: {
      name: "ShanHaiEdu CI Provider Ledger Fixture",
      source_project: "ShanHaiEdu",
      portable: true,
      contains_real_secrets: false,
    },
    package_modes: {
      public_zip: {
        artifact_name: "ci-provider-ledger-fixture.json",
        contains_private_env: false,
        purpose: "CI standalone tracing only",
      },
    },
  };
}

export function stageCiProviderLedger({ root = process.cwd(), env = process.env } = {}) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true") {
    throw new Error("CI Provider ledger staging is restricted to GitHub Actions.");
  }
  const sourceFile = path.join(root, ...sourcePath.split("/"));
  if (!existsSync(sourceFile)) throw new Error("CI Provider ledger source fixture is missing.");
  const source = JSON.parse(readFileSync(sourceFile, "utf8"));
  const targetFile = path.join(root, ...targetPath.split("/"));
  mkdirSync(path.dirname(targetFile), { recursive: true });
  writeFileSync(targetFile, `${JSON.stringify(createCiPublicProviderManifest(source), null, 2)}\n`, { flag: "wx" });
  return targetFile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  stageCiProviderLedger();
  console.log(JSON.stringify({ ok: true, targetPath }));
}
