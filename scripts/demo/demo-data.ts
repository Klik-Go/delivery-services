/**
 * Demo stores for showing Klik Go end to end in the hosted environment (`pnpm demo:data`).
 * Names, menus and prices are invented for the demo; pins are inside each launch zone (checked by
 * the database's merchants_inside_zone trigger). Fixed ids (de300000-…) make the script idempotent
 * and let `hide` find exactly these rows again.
 */

/** A choice group on an item: [option name, extra price in centavos]. */
export interface DemoChoices {
  readonly name: string;
  readonly required: boolean;
  readonly max: number;
  readonly options: readonly (readonly [string, number])[];
}

export interface DemoItem {
  readonly category: string;
  readonly name: string;
  readonly description?: string;
  readonly priceCentavos: number;
  readonly choices?: DemoChoices;
}

export interface DemoStore {
  readonly id: string;
  readonly zoneSlug: "makati" | "san-fernando-pampanga" | "san-marcelino-zambales";
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly category: "food" | "grocery";
  readonly addressLine: string;
  readonly lat: number;
  readonly lng: number;
  readonly prepMinutes: number;
  readonly items: readonly DemoItem[];
}

const rice: DemoChoices = {
  name: "Rice",
  required: true,
  max: 1,
  options: [
    ["Plain rice", 0],
    ["Garlic rice", 1000],
    ["No rice", 0],
  ],
};
const size: DemoChoices = {
  name: "Size",
  required: true,
  max: 1,
  options: [
    ["Regular", 0],
    ["Large", 2000],
  ],
};
const sugar: DemoChoices = {
  name: "Sugar",
  required: true,
  max: 1,
  options: [
    ["No sugar", 0],
    ["Less sugar", 0],
    ["Regular", 0],
  ],
};
const egg: DemoChoices = {
  name: "Egg",
  required: true,
  max: 1,
  options: [
    ["Sunny side up", 0],
    ["Scrambled", 0],
    ["Hard boiled", 0],
  ],
};

const id = (n: number): string => `de300000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const DEMO_STORES: readonly DemoStore[] = [
  {
    id: id(101),
    zoneSlug: "makati",
    name: "Lutong Bahay ni Lola Ising",
    slug: "demo-lutong-bahay-ni-lola-ising",
    description: "Home-style ulam, rice meals and kakanin, cooked fresh every day. (Demo store)",
    category: "food",
    addressLine: "Legazpi Village, Makati City",
    lat: 14.5555,
    lng: 121.017,
    prepMinutes: 15,
    items: [
      {
        category: "Ulam",
        name: "Chicken Adobo",
        description: "Braised in soy, vinegar and garlic.",
        priceCentavos: 12000,
        choices: rice,
      },
      {
        category: "Ulam",
        name: "Pork Sinigang",
        description: "Sour tamarind soup with vegetables.",
        priceCentavos: 14500,
        choices: rice,
      },
      { category: "Ulam", name: "Beef Caldereta", priceCentavos: 16500, choices: rice },
      {
        category: "Ulam",
        name: "Pinakbet",
        description: "Vegetables with bagoong.",
        priceCentavos: 9500,
        choices: rice,
      },
      { category: "Ulam", name: "Fried Bangus", priceCentavos: 13500, choices: rice },
      { category: "Extras", name: "Extra Rice", priceCentavos: 2000 },
      { category: "Kakanin", name: "Bibingka", priceCentavos: 6000 },
      { category: "Kakanin", name: "Leche Flan", priceCentavos: 5500 },
      { category: "Drinks", name: "Sago't Gulaman", priceCentavos: 4500, choices: size },
    ],
  },
  {
    id: id(102),
    zoneSlug: "makati",
    name: "Kape at Pandesal Salcedo",
    slug: "demo-kape-at-pandesal-salcedo",
    description: "Hot pandesal, ensaymada and local coffee for the morning rush. (Demo store)",
    category: "food",
    addressLine: "Salcedo Village, Makati City",
    lat: 14.5605,
    lng: 121.0225,
    prepMinutes: 10,
    items: [
      { category: "Tinapay", name: "Pandesal (10 pcs)", priceCentavos: 5000 },
      { category: "Tinapay", name: "Cheese Ensaymada", priceCentavos: 4500 },
      { category: "Tinapay", name: "Spanish Bread (5 pcs)", priceCentavos: 5500 },
      { category: "Tinapay", name: "Ube Cheese Pandesal (4 pcs)", priceCentavos: 8000 },
      { category: "Kape", name: "Kapeng Barako", priceCentavos: 7000, choices: sugar },
      {
        category: "Kape",
        name: "Iced Spanish Latte",
        priceCentavos: 12000,
        choices: { ...sugar, name: "Sweetness" },
      },
      { category: "Kape", name: "Tsokolate (Tablea)", priceCentavos: 9000, choices: size },
    ],
  },
  {
    id: id(103),
    zoneSlug: "makati",
    name: "Inasal Grill Poblacion",
    slug: "demo-inasal-grill-poblacion",
    description: "Chicken inasal and grilled liempo with unlimited sauce. (Demo store)",
    category: "food",
    addressLine: "Poblacion, Makati City",
    lat: 14.565,
    lng: 121.031,
    prepMinutes: 20,
    items: [
      { category: "Grilled", name: "Chicken Inasal (Paa)", priceCentavos: 15500, choices: rice },
      { category: "Grilled", name: "Chicken Inasal (Pecho)", priceCentavos: 16500, choices: rice },
      { category: "Grilled", name: "Pork Liempo", priceCentavos: 17500, choices: rice },
      { category: "Grilled", name: "Pork BBQ (3 sticks)", priceCentavos: 12000, choices: rice },
      { category: "Sides", name: "Atchara", priceCentavos: 2500 },
      { category: "Drinks", name: "Calamansi Juice", priceCentavos: 5000, choices: size },
      {
        category: "Desserts",
        name: "Halo-halo",
        priceCentavos: 12000,
        choices: {
          ...size,
          options: [
            ["Regular", 0],
            ["Special", 3500],
          ],
        },
      },
    ],
  },
  {
    id: id(201),
    zoneSlug: "san-fernando-pampanga",
    name: "Kusinang Kapampangan",
    slug: "demo-kusinang-kapampangan",
    description: "Sisig, bringhe and kare-kare from the culinary capital. (Demo store)",
    category: "food",
    addressLine: "Sto. Rosario, City of San Fernando",
    lat: 15.0306,
    lng: 120.6874,
    prepMinutes: 20,
    items: [
      {
        category: "Ulam",
        name: "Sizzling Sisig",
        priceCentavos: 18000,
        choices: { name: "Egg on top", required: false, max: 1, options: [["Add egg", 1500]] },
      },
      { category: "Ulam", name: "Kare-kare", priceCentavos: 24000, choices: rice },
      {
        category: "Ulam",
        name: "Bringhe",
        description: "Kapampangan sticky rice with chicken.",
        priceCentavos: 16000,
      },
      { category: "Ulam", name: "Tocino Kapampangan", priceCentavos: 13000, choices: egg },
      { category: "Ulam", name: "Buro with Fried Hito", priceCentavos: 19000 },
      { category: "Extras", name: "Extra Rice", priceCentavos: 2000 },
      { category: "Drinks", name: "Iced Tea", priceCentavos: 4500, choices: size },
    ],
  },
  {
    id: id(202),
    zoneSlug: "san-fernando-pampanga",
    name: "Tibok-Tibok at Kakanin",
    slug: "demo-tibok-tibok-at-kakanin",
    description: "Kapampangan desserts: tibok-tibok, sans rival and turrones. (Demo store)",
    category: "food",
    addressLine: "Dolores, City of San Fernando",
    lat: 15.0435,
    lng: 120.6799,
    prepMinutes: 10,
    items: [
      { category: "Desserts", name: "Tibok-tibok", priceCentavos: 9000 },
      { category: "Desserts", name: "Sans Rival (slice)", priceCentavos: 11000 },
      { category: "Desserts", name: "Turrones de Casoy (box)", priceCentavos: 25000 },
      { category: "Desserts", name: "Buko Pandan", priceCentavos: 8000, choices: size },
      {
        category: "Kakanin",
        name: "Puto Bumbong",
        priceCentavos: 7000,
        choices: {
          name: "Topping",
          required: false,
          max: 2,
          options: [
            ["Extra muscovado", 1000],
            ["Extra cheese", 1500],
          ],
        },
      },
      { category: "Kakanin", name: "Suman", priceCentavos: 5000 },
    ],
  },
  {
    id: id(203),
    zoneSlug: "san-fernando-pampanga",
    name: "Pancit at Lomi House",
    slug: "demo-pancit-at-lomi-house",
    description: "Big bowls of lomi, pancit and goto for sharing. (Demo store)",
    category: "food",
    addressLine: "Sindalan, City of San Fernando",
    lat: 15.064,
    lng: 120.656,
    prepMinutes: 15,
    items: [
      { category: "Noodles", name: "Special Lomi", priceCentavos: 13000, choices: size },
      { category: "Noodles", name: "Pancit Canton", priceCentavos: 15000, choices: size },
      { category: "Noodles", name: "Pancit Bihon", priceCentavos: 14000, choices: size },
      {
        category: "Soup",
        name: "Goto",
        priceCentavos: 9000,
        choices: {
          name: "Add-ons",
          required: false,
          max: 2,
          options: [
            ["Egg", 1500],
            ["Tokwa", 1500],
          ],
        },
      },
      { category: "Sides", name: "Lumpiang Shanghai (10 pcs)", priceCentavos: 10000 },
      { category: "Drinks", name: "Softdrinks", priceCentavos: 3500 },
    ],
  },
  {
    id: id(301),
    zoneSlug: "san-marcelino-zambales",
    name: "Mangga ng Zambales",
    slug: "demo-mangga-ng-zambales",
    description: "Sweet Zambales mangoes in shakes, floats and desserts. (Demo store)",
    category: "food",
    addressLine: "Poblacion, San Marcelino",
    lat: 14.9745,
    lng: 120.1578,
    prepMinutes: 10,
    items: [
      { category: "Shakes", name: "Mango Shake", priceCentavos: 9000, choices: size },
      { category: "Shakes", name: "Mango Graham Shake", priceCentavos: 11000, choices: size },
      { category: "Desserts", name: "Mango Float (tub)", priceCentavos: 22000 },
      { category: "Desserts", name: "Mango Sago", priceCentavos: 8500 },
      { category: "Fresh", name: "Ripe Mangoes (1 kg)", priceCentavos: 18000 },
      { category: "Fresh", name: "Green Mango with Bagoong", priceCentavos: 7000 },
    ],
  },
  {
    id: id(302),
    zoneSlug: "san-marcelino-zambales",
    name: "Pares at Mami ni Mang Lito",
    slug: "demo-pares-at-mami-ni-mang-lito",
    description: "Beef pares, mami and silog meals all day. (Demo store)",
    category: "food",
    addressLine: "Poblacion, San Marcelino",
    lat: 14.977,
    lng: 120.16,
    prepMinutes: 15,
    items: [
      { category: "Pares", name: "Beef Pares", priceCentavos: 11000, choices: rice },
      { category: "Pares", name: "Pares Overload", priceCentavos: 15000, choices: rice },
      { category: "Mami", name: "Beef Mami", priceCentavos: 9500, choices: size },
      { category: "Mami", name: "Chicken Mami", priceCentavos: 8500, choices: size },
      { category: "Silog", name: "Tapsilog", priceCentavos: 12000, choices: egg },
      { category: "Silog", name: "Longsilog", priceCentavos: 10500, choices: egg },
      { category: "Drinks", name: "Iced Tea", priceCentavos: 4000, choices: size },
    ],
  },
  {
    id: id(303),
    zoneSlug: "san-marcelino-zambales",
    name: "Sari-Sari Plus San Marcelino",
    slug: "demo-sari-sari-plus-san-marcelino",
    description: "Everyday groceries delivered: rice, eggs, water and more. (Demo store)",
    category: "grocery",
    addressLine: "Poblacion, San Marcelino",
    lat: 14.97,
    lng: 120.155,
    prepMinutes: 10,
    items: [
      { category: "Staples", name: "Well-milled Rice (5 kg)", priceCentavos: 27500 },
      { category: "Staples", name: "Eggs (1 tray, 30 pcs)", priceCentavos: 24000 },
      { category: "Staples", name: "Cooking Oil (1 L)", priceCentavos: 11000 },
      { category: "Drinks", name: "Purified Water (5 gal refill)", priceCentavos: 4000 },
      { category: "Snacks", name: "Instant Pancit Canton (6 packs)", priceCentavos: 9000 },
      { category: "Household", name: "Laundry Soap Bar (3 pcs)", priceCentavos: 7500 },
    ],
  },
];

/** Demo promo codes (valid in every zone for 90 days, featured on Home). */
export const DEMO_PROMOS = [
  {
    code: "DEMOKAIN",
    type: "fixed_off",
    discountCentavos: 5000,
    discountBps: null,
    maxDiscountCentavos: null,
    minSubtotalCentavos: 30000,
  },
  {
    code: "DEMOHATID",
    type: "free_delivery",
    discountCentavos: null,
    discountBps: null,
    maxDiscountCentavos: null,
    minSubtotalCentavos: 20000,
  },
  {
    code: "DEMO10",
    type: "percent_off",
    discountCentavos: null,
    discountBps: 1000,
    maxDiscountCentavos: 6000,
    minSubtotalCentavos: 15000,
  },
] as const;

/** Open 6 AM to 11 PM every day (Asia/Manila), so demos work most of the day. */
export const DEMO_HOURS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
    day,
    [{ open: "06:00", close: "23:00" }],
  ]),
);
