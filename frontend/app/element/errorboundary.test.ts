import { describe, expect, it } from "vitest";
import { makeErrorReport } from "./errorboundary";

describe("makeErrorReport", () => {
    it("includes the error and component stack for support reports", () => {
        const error = new ReferenceError("t is not defined");
        const report = makeErrorReport(error, "at StatusBar\n at App");

        expect(report).toContain("ReferenceError: t is not defined");
        expect(report).toContain("at StatusBar");
        expect(report).toContain("at App");
    });
});
