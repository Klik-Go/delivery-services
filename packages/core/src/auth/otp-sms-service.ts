import type { Logger } from "../ports/logger";
import { ValidationError, type AppError } from "../shared/errors";
import { err, type Result } from "../shared/result";
import { normalizePhilippineMobile } from "./phone";
import type { ISmsSender } from "./ports";

/** Turns a Supabase "Send SMS" hook call into a Klik Go text message. */
export class OtpSmsService {
  constructor(private readonly deps: { sms: ISmsSender; logger: Logger }) {}

  /** Texts the code. The code is never logged. */
  async deliver(input: {
    phone: string;
    otp: string;
  }): Promise<Result<{ providerMessageId: string | null }, AppError>> {
    if (!/^\d{4,10}$/.test(input.otp))
      return err(new ValidationError("Malformed code from the auth hook."));
    const phone = normalizePhilippineMobile(
      input.phone.startsWith("+") ? input.phone : `+${input.phone}`,
    );
    if (!phone.ok) return phone;
    const body = `Your Klik Go code is ${input.otp}. It expires in 5 minutes. Never share it: Klik Go will never ask for it.`;
    const sent = await this.deps.sms.send({ to: phone.value, body });
    if (sent.ok)
      this.deps.logger.info("sms.otp_sent", { providerMessageId: sent.value.providerMessageId });
    else this.deps.logger.error("sms.otp_failed", { code: sent.error.code });
    return sent;
  }
}
