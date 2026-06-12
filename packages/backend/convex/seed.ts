import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael",
  "Linda", "David", "Elizabeth", "William", "Barbara", "Richard", "Susan",
  "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Christopher",
  "Lisa", "Daniel", "Nancy", "Matthew", "Betty", "Anthony", "Margaret",
  "Mark", "Sandra",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
  "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
  "Ramirez", "Lewis", "Robinson",
];

const STREETS = [
  "Oakwood Dr", "Maple Ave", "Cedar Ln", "Pine St", "Elm Ct", "Willow Way",
  "Birch Rd", "Magnolia Blvd", "Hickory Trl", "Dogwood Cir",
];

const CITIES: Array<[string, string, string]> = [
  ["Huntsville", "AL", "35801"],
  ["Birmingham", "AL", "35203"],
  ["Nashville", "TN", "37203"],
  ["Chattanooga", "TN", "37402"],
  ["Atlanta", "GA", "30303"],
  ["Knoxville", "TN", "37902"],
  ["Montgomery", "AL", "36104"],
  ["Decatur", "AL", "35601"],
];

const WORK_ITEMS: Array<[string, number, number]> = [
  // [description, min unit price, max unit price]
  ["Demolition and site prep", 4000, 9000],
  ["Foundation and concrete work", 8000, 16000],
  ["Framing and structural modifications", 10000, 22000],
  ["Roofing replacement", 8000, 15000],
  ["Wheelchair ramp installation", 5000, 12000],
  ["Doorway widening", 3000, 8000],
  ["Roll-in shower conversion", 9000, 18000],
  ["Accessible kitchen remodel", 12000, 25000],
  ["Bathroom grab bars and fixtures", 2000, 5000],
  ["Electrical rewiring and panel upgrade", 6000, 14000],
  ["Plumbing rough-in and fixtures", 5000, 12000],
  ["HVAC system replacement", 7000, 14000],
  ["Flooring - slip resistant", 4000, 10000],
  ["Drywall and paint", 3000, 9000],
  ["Exterior siding and trim", 5000, 12000],
  ["Windows and accessible hardware", 4000, 10000],
  ["Driveway and walkway paving", 4000, 9000],
  ["Final cleanup and inspection prep", 1500, 4000],
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seedInvoices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const clients = await ctx.db.query("clients").collect();
    const existing = await ctx.db.query("invoices").collect();
    const existingNumbers = new Set(existing.map((inv) => inv.invoiceNumber));

    let inserted = 0;
    for (const client of clients) {
      if (existingNumbers.has(client.invoiceNumber)) continue;
      const invoiceDate = new Date(client.createdAt).toISOString().slice(0, 10);
      await ctx.db.insert("invoices", {
        name: client.name,
        street: client.street,
        city: client.city,
        state: client.state,
        zip: client.zip,
        phone: client.phone,
        invoiceNumber: client.invoiceNumber,
        caseNumber: client.caseNumber ?? "",
        invoiceDate,
        lineItems: client.lineItems,
        total: client.lineItems.reduce((sum, item) => sum + item.amount, 0),
        createdAt: client.createdAt,
        updatedAt: client.createdAt,
      });
      inserted++;
    }
    return { inserted };
  },
});

export const seedMockData = internalMutation({
  args: { count: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const count = args.count ?? 30;
    const rand = mulberry32(42);
    const randInt = (min: number, max: number) =>
      Math.floor(rand() * (max - min + 1)) + min;
    const pick = <T>(arr: T[]): T => arr[randInt(0, arr.length - 1)];

    const statuses = ["unsigned", "signed", "complete"] as const;
    const drawCounts = [4, 5, 6] as const;
    const ids = [];

    for (let i = 0; i < count; i++) {
      const itemCount = randInt(5, 9);
      const shuffled = [...WORK_ITEMS].sort(() => rand() - 0.5);
      const lineItems = shuffled.slice(0, itemCount).map(([desc, lo, hi]) => {
        const qty = 1;
        const unitPrice = randInt(lo / 100, hi / 100) * 100;
        return { description: desc, qty, unitPrice, amount: qty * unitPrice };
      });
      const workTotal = lineItems.reduce((s, li) => s + li.amount, 0);
      const profit = Math.round(workTotal * 0.1);
      lineItems.push({
        description: "Profit",
        qty: 10,
        unitPrice: profit,
        amount: profit,
      });
      const total = workTotal + profit;

      const [city, state, zip] = pick(CITIES);
      const createdAt =
        Date.now() - randInt(0, 90) * 24 * 60 * 60 * 1000 - randInt(0, 86_400_000);

      const id = await ctx.db.insert("clients", {
        name: `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[(i * 7) % LAST_NAMES.length]}`,
        street: `${randInt(100, 9999)} ${pick(STREETS)}`,
        city,
        state,
        zip,
        phone: `(${randInt(205, 931)}) ${randInt(200, 999)}-${String(randInt(0, 9999)).padStart(4, "0")}`,
        invoiceNumber: `INV-${String(1000 + i)}`,
        caseNumber: rand() < 0.7 ? `48-48-6-${randInt(100000, 999999)}` : undefined,
        drawCount: pick([...drawCounts]),
        lineItems,
        subtotal: total,
        total,
        status: pick([...statuses]),
        createdAt,
        updatedAt: createdAt,
      });
      ids.push(id);
    }

    return { inserted: ids.length };
  },
});
