import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("ProcessViewer translations", () => {
    it("does not reference translation helpers outside their component scope", () => {
        const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
        expect(configPath).toBeDefined();

        const config = ts.readConfigFile(configPath!, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath!));
        const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
        const diagnostics = ts
            .getPreEmitDiagnostics(program)
            .filter(
                (diagnostic) =>
                    diagnostic.code === 2304 &&
                    diagnostic.file?.fileName.endsWith("frontend/app/view/processviewer/processviewer.tsx")
            );

        expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual(
            []
        );
    }, 15_000);
});
