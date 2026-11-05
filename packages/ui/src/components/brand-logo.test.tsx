// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandLogo } from "./brand-logo";

afterEach(cleanup);

describe("BrandLogo", () => {
  it("is announced to screen readers as the Klik Go logo", () => {
    render(<BrandLogo />);
    expect(screen.getByRole("img", { name: "Klik Go logo" })).toBeTruthy();
  });

  it("draws the KGo mark: logo-blue tile with yellow lettering", () => {
    render(<BrandLogo />);
    const logo = screen.getByRole("img", { name: "Klik Go logo" });
    const fills = [...logo.querySelectorAll("path")].map((path) => path.getAttribute("class"));
    expect(fills).toContain("fill-brand-600");
    expect(fills).toContain("fill-accent-400");
  });

  it("renders at the requested size", () => {
    render(<BrandLogo size={64} />);
    const logo = screen.getByRole("img", { name: "Klik Go logo" });
    expect(logo.getAttribute("width")).toBe("64");
    expect(logo.getAttribute("height")).toBe("63");
  });

  it("can be hidden from assistive tech when a visible name sits next to it", () => {
    const { container } = render(<BrandLogo decorative />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });
});
