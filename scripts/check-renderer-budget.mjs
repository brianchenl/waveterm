// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const outputDir = path.resolve(process.argv[2] ?? "dist/frontend");
const maxEntryBytes = 4_600_000;
const maxInitialCssBytes = 210_000;
const forbiddenAssetPrefixes = ["ts.worker-"];
const maxLazyChunkBytes = new Map([["sysinfo-view-", 30_000]]);
const requiredLazyChunkPrefixes = [
  "builder-app-",
  "monaco-react-",
  "preview-",
  "processviewer-view-",
  "sysinfo-view-",
  "waveconfig-",
  "widgets-",
];
const forbiddenEntrySources = [
  "/app/ai/conversation.ts",
  "/app/aipanel/aimessage.tsx",
  "/app/aipanel/waveai-model.tsx",
  "/app/monaco/monaco-react.tsx",
  "/app/view/preview/preview.tsx",
  "/app/view/processviewer/processviewer-view.tsx",
  "/app/view/sysinfo/sysinfo-view.tsx",
  "/app/view/waveconfig/waveconfig.tsx",
  "/app/workspace/widgets.tsx",
  "/builder/builder-app.tsx",
];
const requiredEntrySources = ["/app/performance/renderer-performance.ts"];

function fail(message) {
  console.error(`[renderer-budget] ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(outputDir)) {
  fail(`build output does not exist: ${outputDir}`);
} else {
  const htmlPath = path.join(outputDir, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const scriptMatch = html.match(/<script[^>]+src="\.\/assets\/([^"]+\.js)"/);
  const cssMatch = html.match(/<link[^>]+href="\.\/assets\/([^"]+\.css)"/);
  if (html.includes('rel="modulepreload"')) {
    fail("initial HTML must not preload lazy renderer modules");
  }
  if (scriptMatch == null) {
    fail("unable to resolve the renderer entry script from index.html");
  } else {
    const entryPath = path.join(outputDir, "assets", scriptMatch[1]);
    const entryBytes = fs.statSync(entryPath).size;
    if (entryBytes > maxEntryBytes) {
      fail(`entry ${scriptMatch[1]} is ${entryBytes} bytes; budget is ${maxEntryBytes}`);
    }
    const sourceMapPath = `${entryPath}.map`;
    if (!fs.existsSync(sourceMapPath)) {
      fail(`entry source map is missing: ${path.basename(sourceMapPath)}`);
    } else {
      const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, "utf8"));
      const sources = Array.isArray(sourceMap.sources) ? sourceMap.sources : [];
      for (const forbiddenSource of forbiddenEntrySources) {
        if (sources.some((source) => source.endsWith(forbiddenSource))) {
          fail(`lazy source leaked into the entry chunk: ${forbiddenSource}`);
        }
      }
      for (const requiredSource of requiredEntrySources) {
        if (!sources.some((source) => source.endsWith(requiredSource))) {
          fail(`required startup instrumentation is missing from the entry chunk: ${requiredSource}`);
        }
      }
    }
    console.log(`[renderer-budget] entry ${scriptMatch[1]}: ${entryBytes}/${maxEntryBytes} bytes`);
  }
  if (cssMatch == null) {
    fail("unable to resolve the initial stylesheet from index.html");
  } else {
    const cssBytes = fs.statSync(path.join(outputDir, "assets", cssMatch[1])).size;
    if (cssBytes > maxInitialCssBytes) {
      fail(`initial CSS ${cssMatch[1]} is ${cssBytes} bytes; budget is ${maxInitialCssBytes}`);
    }
    console.log(`[renderer-budget] initial CSS ${cssMatch[1]}: ${cssBytes}/${maxInitialCssBytes} bytes`);
  }
  const assetNames = fs.readdirSync(path.join(outputDir, "assets"));
  for (const prefix of forbiddenAssetPrefixes) {
    if (assetNames.some((assetName) => assetName.startsWith(prefix))) {
      fail(`forbidden renderer asset is present: ${prefix}*`);
    }
  }
  for (const prefix of requiredLazyChunkPrefixes) {
    if (!assetNames.some((assetName) => assetName.startsWith(prefix) && assetName.endsWith(".js"))) {
      fail(`required lazy chunk is missing: ${prefix}*.js`);
    }
  }
  for (const [prefix, maxBytes] of maxLazyChunkBytes) {
    const assetName = assetNames.find((name) => name.startsWith(prefix) && name.endsWith(".js"));
    if (assetName == null) continue;
    const assetBytes = fs.statSync(path.join(outputDir, "assets", assetName)).size;
    if (assetBytes > maxBytes) {
      fail(`lazy chunk ${assetName} is ${assetBytes} bytes; budget is ${maxBytes}`);
    }
    console.log(`[renderer-budget] lazy chunk ${assetName}: ${assetBytes}/${maxBytes} bytes`);
  }
}

if (process.exitCode == null) {
  console.log("[renderer-budget] all renderer performance budgets passed");
}
