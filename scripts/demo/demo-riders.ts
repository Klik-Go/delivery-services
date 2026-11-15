/**
 * Demo riders for showing the rider app, dispatch and the rider console (`pnpm demo:riders`).
 * Every person here is invented: names, plates and payout names are placeholders, and the phone
 * numbers sit in the +63 917 000 09xx block that Klik Go keeps for test sign-ins (no SMS is sent to
 * a test number). Fixed ids (de400000-…) make the script idempotent and let `hide` find exactly
 * these rows again. Pins are a few hundred metres from the demo stores in scripts/demo/demo-data.ts.
 */

export type DemoZoneSlug = "makati" | "san-fernando-pampanga" | "san-marcelino-zambales";
export type DemoKycType =
  | "government_id"
  | "drivers_license"
  | "vehicle_registration"
  | "selfie_with_id"
  | "payout_account";

/** The five documents a rider sends (docs/BUSINESS.md Appendix B), in checklist order. */
export const DEMO_KYC_TYPES: readonly DemoKycType[] = [
  "government_id",
  "drivers_license",
  "vehicle_registration",
  "selfie_with_id",
  "payout_account",
];

export interface DemoRider {
  /** riders.id; the account (auth user) is found or created by phone. */
  readonly id: string;
  readonly fullName: string;
  /** E.164, inside the test block +63917000090x–091x. */
  readonly phone: string;
  readonly zoneSlug: DemoZoneSlug;
  readonly vehicleType: "motorcycle" | "bicycle" | "tricycle";
  readonly plateNo: string | null;
  /**
   * What the demo shows: `online` riders get job offers straight away, `offline` ones are approved
   * but off shift, `applicant` riders wait in the KYC queue, `suspended` ones show the status reason.
   */
  readonly state: "online" | "offline" | "applicant" | "suspended";
  /** Where the rider is parked (online and offline riders). */
  readonly at?: { readonly lat: number; readonly lng: number };
  /** Placeholder rating (real ratings arrive with delivered orders; Phase 9). */
  readonly rating?: { readonly avg: number; readonly count: number };
  readonly payoutAccountName?: string;
  readonly statusReason?: string;
  /** Applicants only: documents the reviewer has already accepted. The rest wait for review. */
  readonly approvedDocuments?: readonly DemoKycType[];
}

export const DEMO_RIDERS: readonly DemoRider[] = [
  // Makati City: near Lutong Bahay ni Lola Ising, Kape at Pandesal Salcedo, Inasal Grill Poblacion.
  {
    id: "de400000-0000-4000-8000-000000000001",
    fullName: "Andoy Villanueva",
    phone: "+639170000901",
    zoneSlug: "makati",
    vehicleType: "motorcycle",
    plateNo: "NDA 1101",
    state: "online",
    at: { lat: 14.5575, lng: 121.0185 },
    rating: { avg: 4.8, count: 42 },
    payoutAccountName: "Andoy Villanueva",
  },
  {
    id: "de400000-0000-4000-8000-000000000002",
    fullName: "Bea Manalo",
    phone: "+639170000902",
    zoneSlug: "makati",
    vehicleType: "bicycle",
    plateNo: null,
    state: "offline",
    at: { lat: 14.5615, lng: 121.0245 },
    rating: { avg: 4.6, count: 18 },
    payoutAccountName: "Beatriz Manalo",
  },
  {
    id: "de400000-0000-4000-8000-000000000003",
    fullName: "Carlo Bautista",
    phone: "+639170000903",
    zoneSlug: "makati",
    vehicleType: "motorcycle",
    plateNo: "NDC 3303",
    state: "online",
    at: { lat: 14.5665, lng: 121.0295 },
    // Below 3.5 with at least 5 ratings: listed under Riders → Coaching (docs/BUSINESS.md §5.3).
    rating: { avg: 3.2, count: 6 },
    payoutAccountName: "Carlo Bautista",
  },
  {
    id: "de400000-0000-4000-8000-000000000004",
    fullName: "Dina Ramos",
    phone: "+639170000904",
    zoneSlug: "makati",
    vehicleType: "motorcycle",
    plateNo: "NDD 4404",
    state: "applicant",
    payoutAccountName: "Dina Ramos",
    approvedDocuments: ["government_id"],
  },
  {
    id: "de400000-0000-4000-8000-000000000005",
    fullName: "Edwin Castro",
    phone: "+639170000905",
    zoneSlug: "makati",
    vehicleType: "tricycle",
    plateNo: "TRE 5505",
    state: "suspended",
    rating: { avg: 3.9, count: 14 },
    payoutAccountName: "Edwin Castro",
    statusReason: "Demo: three missed pickups this week. Call the coordinator before reactivating.",
  },
  // San Fernando, Pampanga: near Kusinang Kapampangan and Tibok-Tibok at Kakanin.
  {
    id: "de400000-0000-4000-8000-000000000006",
    fullName: "Faye Mercado",
    phone: "+639170000906",
    zoneSlug: "san-fernando-pampanga",
    vehicleType: "motorcycle",
    plateNo: "PMF 6606",
    state: "online",
    at: { lat: 15.0322, lng: 120.6858 },
    rating: { avg: 4.9, count: 27 },
    payoutAccountName: "Faye Mercado",
  },
  {
    id: "de400000-0000-4000-8000-000000000007",
    fullName: "Gilbert Lansangan",
    phone: "+639170000907",
    zoneSlug: "san-fernando-pampanga",
    vehicleType: "tricycle",
    plateNo: "PMG 7707",
    state: "online",
    at: { lat: 15.0418, lng: 120.6812 },
    rating: { avg: 4.7, count: 11 },
    payoutAccountName: "Gilbert Lansangan",
  },
  {
    id: "de400000-0000-4000-8000-000000000008",
    fullName: "Hazel David",
    phone: "+639170000908",
    zoneSlug: "san-fernando-pampanga",
    vehicleType: "motorcycle",
    plateNo: "PMH 8808",
    state: "applicant",
    payoutAccountName: "Hazel David",
  },
  // San Marcelino, Zambales: near Mangga ng Zambales and Pares at Mami ni Mang Lito.
  {
    id: "de400000-0000-4000-8000-000000000009",
    fullName: "Ito Fariñas",
    phone: "+639170000909",
    zoneSlug: "san-marcelino-zambales",
    vehicleType: "motorcycle",
    plateNo: "ZBI 9909",
    state: "online",
    at: { lat: 14.9758, lng: 120.1589 },
    rating: { avg: 4.5, count: 9 },
    payoutAccountName: "Ito Fariñas",
  },
  {
    id: "de400000-0000-4000-8000-000000000010",
    fullName: "Jessa Ebalo",
    phone: "+639170000910",
    zoneSlug: "san-marcelino-zambales",
    vehicleType: "bicycle",
    plateNo: null,
    state: "offline",
    at: { lat: 14.9712, lng: 120.1562 },
    rating: { avg: 4.4, count: 5 },
    payoutAccountName: "Jessa Ebalo",
  },
];

/** Status reason put on every demo rider by `hide`, so the console says why they are off. */
export const DEMO_HIDDEN_REASON = "Demo rider hidden (pnpm demo:riders with DEMO_ACTION=hide).";

const KYC_LABELS: Record<DemoKycType, string> = {
  government_id: "Government ID",
  drivers_license: "Driver's licence",
  vehicle_registration: "Vehicle registration (OR/CR)",
  selfie_with_id: "Selfie holding the ID",
  payout_account: "GCash / bank account proof",
};

/**
 * A one-page PDF that says plainly it is a placeholder, so reviewers opening it from the KYC
 * queue see a stand-in document, never anything that looks like a real ID.
 */
export function placeholderKycPdf(rider: DemoRider, type: DemoKycType): Buffer {
  const lines = [
    "KLIK GO DEMO - PLACEHOLDER DOCUMENT",
    "",
    `Document: ${KYC_LABELS[type]}`,
    `Rider: ${rider.fullName} (invented for the demo)`,
    `Vehicle: ${rider.vehicleType}${rider.plateNo ? `, plate ${rider.plateNo}` : ""}`,
    "",
    "This is not a real document. No personal data.",
  ];
  const escape = (text: string): string =>
    text
      .normalize("NFD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = [
    "BT",
    "/F1 16 Tf",
    "72 760 Td",
    "22 TL",
    ...lines.map((line) => `(${escape(line)}) Tj T*`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${String(Buffer.byteLength(stream, "latin1"))} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
