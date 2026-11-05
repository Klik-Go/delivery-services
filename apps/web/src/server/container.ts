import "server-only";
import {
  createPinoLogger,
  DevSmsSender,
  GeminiMenuParser,
  PrismaMenuRepository,
  PrismaMerchantApplicationRepository,
  PrismaStoreRepository,
  PrismaZoneLocator,
  SupabasePhotoStorage,
  UnconfiguredMenuParser,
  UnconfiguredPhotoStorage,
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
  MenuImportService,
  MenuService,
  MerchantOnboardingService,
  MfaService,
  OtpSmsService,
  PhoneOtpService,
  StaffAuthService,
  StoreSettingsService,
  StorefrontService,
  type IMenuParser,
  type IRateLimiter,
  type IUserRoleRepository,
  type Logger,
  type Result,
} from "@klikgo/core";
import { FakeMenuParser } from "@klikgo/core/testing";
import { getPrismaClient } from "@klikgo/db";
import { randomUUID } from "node:crypto";
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
  readonly storeSettings: StoreSettingsService;
  readonly menu: MenuService;
  readonly menuImport: MenuImportService;
  readonly storefront: StorefrontService;
  /** Staff invitations need the service-role key; an error explains what to configure otherwise. */
  inviteService(): Result<InviteService, AppError>;
  /** Partner applications and approvals (approval creates staff accounts: service-role key). */
  merchantOnboarding(): Result<MerchantOnboardingService, AppError>;
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
  let onboarding: MerchantOnboardingService | undefined;
  const admin = supabaseAdminClient();
  const stores = new PrismaStoreRepository(prisma);
  const menus = new PrismaMenuRepository(prisma);
  const menu = new MenuService({
    menus,
    photos: admin
      ? new SupabasePhotoStorage(admin, logger)
      : new UnconfiguredPhotoStorage(env.NEXT_PUBLIC_SUPABASE_URL),
    authz,
    logger,
    newId: randomUUID,
  });

  return {
    logger,
    healthService: new HealthService({ clock, version: env.APP_VERSION }),
    authz,
    userRoles,
    rateLimiter,
    otpSms: new OtpSmsService({ sms, logger }),
    storeSettings: new StoreSettingsService({ stores, authz }),
    menu,
    menuImport: new MenuImportService({
      parser: menuParser(env, logger),
      rateLimiter,
      authz,
      logger,
    }),
    storefront: new StorefrontService({ storefronts: stores, menus, menuService: menu }),
    merchantOnboarding() {
      if (onboarding) return { ok: true, value: onboarding };
      if (!admin) return err(notConfigured("Merchant approvals"));
      onboarding = new MerchantOnboardingService({
        applications: new PrismaMerchantApplicationRepository(prisma),
        zones: new PrismaZoneLocator(prisma),
        accounts: new SupabaseStaffAccountGateway(admin, logger),
        rateLimiter,
        authz,
        clock,
        logger,
      });
      return { ok: true, value: onboarding };
    },
    inviteService() {
      if (invite) return { ok: true, value: invite };
      if (!admin) return err(notConfigured("Staff invitations"));
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

function notConfigured(feature: string): AppError {
  return new AppError("INTERNAL", `${feature} are not configured (SUPABASE_SERVICE_ROLE_KEY).`);
}

/** Gemini when a key is set; the deterministic fake only when asked for (tests, local demos). */
function menuParser(env: ServerEnv, logger: Logger): IMenuParser {
  // The fake never answers real merchants: it is ignored on Vercel production.
  if (env.MENU_PARSER === "fake" && env.VERCEL_ENV !== "production") return new FakeMenuParser();
  if (env.GEMINI_API_KEY)
    return new GeminiMenuParser({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, logger });
  return new UnconfiguredMenuParser();
}

let container: Container | undefined;

/** Returns the process-wide container, created on first use. */
export function getContainer(): Container {
  container ??= createContainer(getServerEnv());
  return container;
}
