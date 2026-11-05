// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandLogo } from "./brand-logo";

describe("BrandLogo", () => {
  it("is announced to screen readers as the Klik Go logo", () => {
    render(<BrandLogo />);
    expect(screen.getByRole("img", { name: "Klik Go logo" })).toBeTruthy();
  });
});
