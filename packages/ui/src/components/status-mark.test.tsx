// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusMark } from "./status-mark";

afterEach(cleanup);

describe("StatusMark", () => {
  it("pairs a glyph with a written word", () => {
    render(<StatusMark tone="awaiting" icon={<svg data-testid="glyph" />} label="Preparing" />);
    expect(screen.getByText("Preparing")).toBeTruthy();
    expect(screen.getByTestId("glyph")).toBeTruthy();
    expect(screen.getByText("Preparing").parentElement?.className).toContain("text-awaiting");
  });
});
