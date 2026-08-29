// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { getMonacoLanguageFeature, type MonacoLanguageFeature } from "./monaco-language";
import ymlWorker from "./yamlworker?worker";

let monacoConfigured = false;
let editorFeaturesPromise: Promise<void> | null = null;
const languageFeaturePromises = new Map<Exclude<MonacoLanguageFeature, null>, Promise<void>>();

window.MonacoEnvironment = {
    getWorker(_, label) {
        if (label === "json") {
            return new jsonWorker();
        }
        if (label === "css" || label === "scss" || label === "less") {
            return new cssWorker();
        }
        if (label === "yaml" || label === "yml") {
            return new ymlWorker();
        }
        if (label === "html" || label === "handlebars" || label === "razor") {
            return new htmlWorker();
        }
        return new editorWorker();
    },
};

export function loadMonaco() {
    if (monacoConfigured) {
        return;
    }
    monacoConfigured = true;
    monaco.editor.defineTheme("wave-theme-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
            "editor.background": "#00000000",
            "editorStickyScroll.background": "#00000055",
            "minimap.background": "#00000077",
            focusBorder: "#00000000",
        },
    });
    monaco.editor.defineTheme("wave-theme-light", {
        base: "vs",
        inherit: true,
        rules: [],
        colors: {
            "editor.background": "#fefefe",
            focusBorder: "#00000000",
        },
    });
    monaco.editor.setTheme("wave-theme-dark");
}

export function loadMonacoEditorFeatures(): Promise<void> {
    if (editorFeaturesPromise != null) {
        return editorFeaturesPromise;
    }
    editorFeaturesPromise = import("monaco-editor/esm/vs/editor/editor.all.js")
        .then(() => undefined)
        .catch((error) => {
            editorFeaturesPromise = null;
            throw error;
        });
    return editorFeaturesPromise;
}

async function configureLanguageFeature(feature: Exclude<MonacoLanguageFeature, null>): Promise<void> {
    if (feature === "css") {
        await import("monaco-editor/esm/vs/language/css/monaco.contribution.js");
        return;
    }
    if (feature === "go") {
        await import("monaco-editor/esm/vs/basic-languages/go/go.contribution.js");
        return;
    }
    if (feature === "html") {
        await import("monaco-editor/esm/vs/language/html/monaco.contribution.js");
        return;
    }
    if (feature === "typescript") {
        // Wave does not provide project type libraries, so Monaco's 13 MB TypeScript
        // language-service worker adds little value here. The basic contributions keep
        // syntax highlighting and language configuration without creating a worker.
        await Promise.all([
            import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js"),
            import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"),
        ]);
        return;
    }
    if (feature === "json") {
        const [jsonContribution, { MonacoSchemas }] = await Promise.all([
            import("monaco-editor/esm/vs/language/json/monaco.contribution.js"),
            import("@/app/monaco/schemaendpoints"),
        ]);
        (jsonContribution as any).jsonDefaults.setDiagnosticsOptions({
            validate: true,
            allowComments: false,
            enableSchemaRequest: true,
            schemas: MonacoSchemas,
        });
        return;
    }
    if (feature === "python") {
        await import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js");
        return;
    }
    if (feature === "shell") {
        await import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js");
        return;
    }
    const { configureMonacoYaml } = await import("monaco-yaml");
    configureMonacoYaml(monaco as any, { validate: true, schemas: [] });
}

export function loadMonacoLanguage(language: unknown): Promise<void> {
    const feature = getMonacoLanguageFeature(language);
    if (feature == null) {
        return Promise.resolve();
    }
    const existing = languageFeaturePromises.get(feature);
    if (existing != null) {
        return existing;
    }
    const loadPromise = configureLanguageFeature(feature).catch((error) => {
        languageFeaturePromises.delete(feature);
        throw error;
    });
    languageFeaturePromises.set(feature, loadPromise);
    return loadPromise;
}
