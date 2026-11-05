import "server-only";
import {
  createPinoLogger,
  DevSmsSender,
  PostgresRateLimiter,
  PrismaInviteRepository,
  PrismaUserRoleRepository,
  SemaphoreSmsSender,
  SupabaseAuthGateway,
  SupabaseStaffAccountGateway,
  SystemClock,
} from "@klikgo/adapters";
import {
  AppError,
  AuthorizationService,
  err,
  HealthService,
  InviteService,
  MfaService,
  OtpSmsService,
  PhoneOtpService,
  StaffAuthService,
  type IRateLimiter,
  type IUserRoleRepository,
  type Logger,
  type Result,
} from "@klikgo/core";
import { getPrismaClient } from "@klikgo/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv, type ServerEnv } from "./env";
import { supabaseAdminClient } from "./supabase/admin-client";

/**
 * Composition root: the only place that picks concrete adapters for core ports
 * (replaces NestJS DI from docs/BUSINESS.md §10.3 "D"). Route handlers get services from here.
 */
export interface Container {
  readonly logger: Logger;
  readonly healthService: HealthService;
  readonly authz: AuthorizationService;
  readonly userRoles: IUserRoleRepository;
  readonly rateLimiter: IRateLimiter;
  readonly otpSms: OtpSmsService;
  /** Staff invitations need the service-role key; an error explains what to configure otherwise. */
  inviteService(): Result<InviteService, AppError>;
  /** Services bound to one request's Supabase session (cookies). */
  forRequest(supabase: SupabaseClient): RequestServices;
}

/** Request-scoped auth services. */
export interface RequestServices {
  readonly phoneOtp: PhoneOtpService;
  readonly staffAuth: StaffAuthService;
  readonly mfa: MfaService;
  readonly signOut: () => ReturnType<SupabaseAuthGateway["signOut"]>;
}

/** Wires services to adapters for the given configuration. */
export function createContainer(env: ServerEnv): Container {
  const logger = createPinoLogger({ level: env.LOG_LEVEL, service: "klikgo-web" });
  const clock = new SystemClock();
  const prisma = getPrismaClient();
  const authz = new AuthorizationService();
  const userRoles = new PrismaUserRoleRepository(prisma);
  const invites = new PrismaInviteRepository(prisma);
  const rateLimiter = new PostgresRateLimiter(prisma);
  const sms = env.SEMAPHORE_API_KEY
    ? new SemaphoreSmsSender({
        apiKey: env.SEMAPHORE_API_KEY,
        senderName: env.SEMAPHORE_SENDER_NAME,
        logger,
      })
    : new DevSmsSender(logger);
  let invite: InviteService | undefined;

  return {
    logger,
    healthService: new HealthService({ clock, version: env.APP_VERSION }),
    authz,
    userRoles,
    rateLimiter,
    otpSms: new OtpSmsService({ sms, logger }),
    inviteService() {
      if (invite) return { ok: true, value: invite };
      const admin = supabaseAdminClient();
      if (!admin)
        return err(
          new AppError(
            "INTERNAL",
            "Staff invitations are not configured (SUPABASE_SERVICE_ROLE_KEY).",
          ),
        );
      invite = new InviteService({
        accounts: new SupabaseStaffAccountGateway(admin, logger),
        roles: userRoles,
        invites,
        authz,
        clock,
        logger,
      });
      return { ok: true, value: invite };
    },
    forRequest(supabase) {
      const gateway = new SupabaseAuthGateway(supabase, logger);
      return {
        phoneOtp: new PhoneOtpService({ gateway, rateLimiter, logger }),
        staffAuth: new StaffAuthService({ gateway, invites, rateLimiter, logger }),
        mfa: new MfaService({ gateway, rateLimiter }),
        signOut: () => gateway.signOut(),
      };
    },
  };
}

let container: Container | undefined;

/** Returns the process-wide container, created on first use. */
export function getContainer(): Container {
  container ??= createContainer(getServerEnv());
  return container;
}
