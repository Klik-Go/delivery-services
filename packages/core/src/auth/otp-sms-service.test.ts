import { describe, expect, it } from "vitest";
import { FakeSmsSender, MemoryLogger } from "../testing";
import { OtpSmsService } from "./otp-sms-service";

describe("OtpSmsService", () => {
  it("texts the code with a warning never to share it", async () => {
    const sms = new FakeSmsSender();
    const service = new OtpSmsService({ sms, logger: new MemoryLogger() });
    const result = await service.deliver({ phone: "639171234567", otp: "482913" });
    expect(result.ok).toBe(true);
    expect(sms.sent).toEqual([
      {
        to: "+639171234567",
        body: "Your Klik Go code is 482913. It expires in 5 minutes. Never share it: Klik Go will never ask for it.",
      },
    ]);
  });

  it("never logs the code itself", async () => {
    const logger = new MemoryLogger();
    await new OtpSmsService({ sms: new FakeSmsSender(), logger }).deliver({
      phone: "+639171234567",
      otp: "482913",
    });
    expect(JSON.stringify(logger.lines)).not.toContain("482913");
  });

  it("refuses a malformed code or phone from the hook", async () => {
    const service = new OtpSmsService({ sms: new FakeSmsSender(), logger: new MemoryLogger() });
    expect((await service.deliver({ phone: "+639171234567", otp: "12" })).ok).toBe(false);
    expect((await service.deliver({ phone: "not a phone", otp: "123456" })).ok).toBe(false);
  });
});
