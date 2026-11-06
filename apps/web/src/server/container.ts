import "server-only";
import {
  createPinoLogger,
  DevSmsSender,
  GeminiMenuParser,
  GooglePlaceSearch,
  PrismaAddressRepository,
  PrismaCatalogRepository,
  PrismaSearchRepository,
  PrismaServiceArea,
  PrismaWaitlistRepository,
  TtlMemoryCache,
  UnconfiguredPlaceSearch,
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
  PrismaDatabaseProbe,
  SupabasePhoneAccountAdmin,
  SupabaseStaffAccountGateway,
  SystemClock,
  CashOnDeliveryGateway,
  NodeContentHasher,
  PayMongoGateway,
  PayMongoWebhookVerifier,
  PrismaOrderRepository,
  PrismaPromoRepository,
  PrismaWebhookEventStore,
  UnconfiguredWebhookVerifier,
  payMongoModeOf,
} from "@klikgo/adapters";
import {
  AddressService,
  AppError,
  AuthorizationService,
  DistanceBandFee,
  FeedService,
  PlaceSearchService,
  PricingService,
  SearchService,
  ServiceabilityService,
  ServiceFee,
  SmallOrderFee,
  ZoneBaseFee,
  err,
  HealthService,
  InviteService,
  MenuImportService,
  MenuService,
  MerchantOnboardingService,
  MfaService,
  OtpSmsService,
  PhoneOtpService,
  PlaceholderPhoneSignIn,
  ReadinessService,
  StaffAuthService,
  StoreSettingsService,
  StorefrontService,
  LedgerService,
  OrderService,
  OrderStateMachine,
  PaymentEventService,
  PaymentGatewayRegistry,
  PaymentWebhookService,
  PromoService,
  RefundService,
  type IMenuParser,
  type IPaymentGateway,
  type IRateLimiter,
  type IUserRoleRepository,
  type Logger,
  type Result,
} from "@klikgo/core";
import { FakeMenuParser, FakePaymentGateway } from "@klikgo/core/testing";
import { getPrismaClient, LATEST_MIGRATION } from "@klikgo/db";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv, type ServerEnv } from "./env";
import { FakeCheckout } from "./payments/fake-checkout";
import { supabaseAdminClient } from "./supabase/admin-client";

/**
 * Composition root: the only place that picks concrete adapters for core ports
 * (replaces NestJS DI from docs/BUSINESS.md §10.3 "D"). Route handlers get services from here.
 */
export interface Container {
  readonly logger: Logger;
  readonly healthService: HealthService;
  /** Database reachable and migrated (GET /api/health/ready). */
  readonly readiness: ReadinessService;
  readonly authz: AuthorizationService;
  readonly userRoles: IUserRoleRepository;
  readonly rateLimiter: IRateLimiter;
  readonly otpSms: OtpSmsService;
  readonly storeSettings: StoreSettingsService;
  readonly menu: MenuService;
  readonly menuImport: MenuImportService;
  readonly storefront: StorefrontService;
  readonly pricing: PricingService;
  readonly feed: FeedService;
  readonly search: SearchService;
  readonly serviceability: ServiceabilityService;
  readonly addresses: AddressService;
  readonly places: PlaceSearchService;
  /** True when address autocomplete has a key (the address screen hides it otherwise). */
  readonly placesConfigured: boolean;
  /** Staff invitations need the service-role key; an error explains what to configure otherwise. */
  inviteService(): Result<InviteService, AppError>;
  /** Partner applications and approvals (approval creates staff accounts: service-role key). */
  merchantOnboarding(): Result<MerchantOnboardingService, AppError>;
  /** Checkout quotes, placing orders (Idempotency-Key) and reading one order. */
  readonly orders: OrderService;
  /** POST /api/webhooks/paymongo: verify, then apply each event once. */
  readonly paymentWebhooks: PaymentWebhookService;
  readonly refunds: RefundService;
  /** The local payment page (PAYMENT_GATEWAY=fake only); null everywhere else. */
  readonly fakeCheckout: FakeCheckout | null;
  /** True while the pre-launch placeholder sign-in code is on (sign-in screens say so). */
  readonly placeholderOtp: boolean;
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
  const placeholderCode = placeholderOtpCode(env, admin !== null, logger);
  const stores = new PrismaStoreRepository(prisma);
  const menus = new PrismaMenuRepository(prisma);
  const cache = new TtlMemoryCache();
  const serviceArea = new PrismaServiceArea(prisma);
  const catalog = new PrismaCatalogRepository(prisma);
  const photos = admin
    ? new SupabasePhotoStorage(admin, logger)
    : new UnconfiguredPhotoStorage(env.NEXT_PUBLIC_SUPABASE_URL);
  // Delivery fee: the zone's distance bands first, otherwise base fee + per-km (OCP: add strategies).
  const pricing = new PricingService({
    catalog,
    serviceArea,
    delivery: [new DistanceBandFee(), new ZoneBaseFee()],
    surcharges: [new SmallOrderFee(), new ServiceFee()],
    clock,
  });
  const feed = new FeedService({ serviceArea, catalog, pricing, photos, cache, clock });
  const menu = new MenuService({
    menus,
    photos,
    authz,
    logger,
    newId: randomUUID,
  });

  // Payments: one gateway per family of methods (OCP: a new gateway is one more entry here).
  const payments = paymentSetup(env, logger);
  const gateways = new PaymentGatewayRegistry([
    ...(payments.online ? [payments.online] : []),
    new CashOnDeliveryGateway(),
  ]);
  const orderStore = new PrismaOrderRepository(prisma);
  const ledger = new LedgerService();
  const refunds = new RefundService({
    orders: orderStore,
    payments: orderStore,
    gateways,
    ledger,
    authz,
    logger,
  });
  const paymentWebhooks = new PaymentWebhookService({
    verifier: payments.webhookSecret
      ? new PayMongoWebhookVerifier({
          webhookSecret: payments.webhookSecret,
          mode: payMongoModeOf(env.PAYMONGO_SECRET_KEY),
        })
      : new UnconfiguredWebhookVerifier(),
    events: new PaymentEventService({
      events: new PrismaWebhookEventStore(prisma),
      payments: orderStore,
      ledger,
      states: new OrderStateMachine(),
      refunds,
      logger,
    }),
    clock,
    logger,
  });

  return {
    logger,
    healthService: new HealthService({ clock, version: env.APP_VERSION }),
    readiness: new ReadinessService({
      database: new PrismaDatabaseProbe(prisma),
      expectedSchemaVersion: LATEST_MIGRATION,
      logger,
    }),
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
    pricing,
    feed,
    search: new SearchService({ serviceArea, search: new PrismaSearchRepository(prisma), feed }),
    serviceability: new ServiceabilityService({
      serviceArea,
      waitlist: new PrismaWaitlistRepository(prisma),
      rateLimiter,
      logger,
    }),
    addresses: new AddressService({
      addresses: new PrismaAddressRepository(prisma),
      serviceArea,
      authz,
    }),
    places: new PlaceSearchService({
      places: env.GOOGLE_MAPS_API_KEY
        ? new GooglePlaceSearch({ apiKey: env.GOOGLE_MAPS_API_KEY, logger })
        : new UnconfiguredPlaceSearch(),
      cache,
      rateLimiter,
    }),
    placesConfigured: Boolean(env.GOOGLE_MAPS_API_KEY),
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
    orders: new OrderService({
      pricing,
      promos: new PromoService({ promos: new PrismaPromoRepository(prisma), clock }),
      orders: orderStore,
      gateways,
      hasher: new NodeContentHasher(),
      authz,
      clock,
      logger,
    }),
    paymentWebhooks,
    refunds,
    fakeCheckout:
      payments.fake && payments.webhookSecret
        ? new FakeCheckout({
            payments: orderStore,
            webhooks: paymentWebhooks,
            webhookSecret: payments.webhookSecret,
            clock,
          })
        : null,
    placeholderOtp: placeholderCode !== undefined,
    forRequest(supabase) {
      const gateway = new SupabaseAuthGateway(supabase, logger);
      const placeholder =
        placeholderCode !== undefined && admin
          ? new PlaceholderPhoneSignIn({
              code: placeholderCode,
              accounts: new SupabasePhoneAccountAdmin(admin, logger),
              roles: userRoles,
              gateway,
              logger,
            })
          : undefined;
      return {
        phoneOtp: new PhoneOtpService({ gateway, rateLimiter, logger, placeholder }),
        staffAuth: new StaffAuthService({ gateway, invites, rateLimiter, logger }),
        mfa: new MfaService({ gateway, rateLimiter }),
        signOut: () => gateway.signOut(),
      };
    },
  };
}

/**
 * The placeholder sign-in code, only while SMS is off: it needs the service-role key (to create
 * accounts) and switches itself off as soon as SEMAPHORE_API_KEY is set, so it cannot outlive
 * the SMS launch by accident.
 */
function placeholderOtpCode(env: ServerEnv, hasAdmin: boolean, logger: Logger): string | undefined {
  if (!env.PLACEHOLDER_OTP_CODE) return undefined;
  if (env.SEMAPHORE_API_KEY) {
    logger.warn("auth.placeholder_ignored", { reason: "SEMAPHORE_API_KEY is set" });
    return undefined;
  }
  if (!hasAdmin) {
    logger.warn("auth.placeholder_ignored", { reason: "SUPABASE_SERVICE_ROLE_KEY is not set" });
    return undefined;
  }
  logger.warn("auth.placeholder_enabled", {});
  return env.PLACEHOLDER_OTP_CODE;
}

function notConfigured(feature: string): AppError {
  return new AppError("INTERNAL", `${feature} are not configured (SUPABASE_SERVICE_ROLE_KEY).`);
}

/**
 * PayMongo when its secret key is set; the local fake (pays on /dev/pay, signs its own webhooks)
 * only when asked for and never on Vercel production. Without either, checkout offers cash only.
 */
function paymentSetup(
  env: ServerEnv,
  logger: Logger,
): { online: IPaymentGateway | null; webhookSecret: string | undefined; fake: boolean } {
  if (env.PAYMENT_GATEWAY === "fake" && env.VERCEL_ENV !== "production") {
    return {
      online: new FakePaymentGateway({ checkoutBase: "/dev/pay" }),
      // A per-process secret is enough: the fake page signs and this process verifies.
      webhookSecret: env.PAYMONGO_WEBHOOK_SECRET ?? randomBytes(32).toString("hex"),
      fake: true,
    };
  }
  if (!env.PAYMONGO_SECRET_KEY) {
    logger.warn("payments.online_disabled", { reason: "PAYMONGO_SECRET_KEY is not set" });
    return { online: null, webhookSecret: env.PAYMONGO_WEBHOOK_SECRET, fake: false };
  }
  return {
    online: new PayMongoGateway({ secretKey: env.PAYMONGO_SECRET_KEY, logger }),
    webhookSecret: env.PAYMONGO_WEBHOOK_SECRET,
    fake: false,
  };
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
