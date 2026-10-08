import { DEFAULT_STAIR_STEPS } from "./model";

export type CatalogCategory = "Architecture" | "Furniture" | "Bathroom" | "Kitchen" | "Electrical" | "Plumbing";
export type CatalogItem = { id: string; name: string; category: CatalogCategory; width: number; depth: number; symbol: string; steps?: number };
export const CATALOG: CatalogItem[] = [
  { id: "stairs", name: "Stairs", category: "Architecture", width: 36, depth: 120, symbol: "stairs", steps: DEFAULT_STAIR_STEPS },
  { id: "queen-bed", name: "Queen bed", category: "Furniture", width: 60, depth: 80, symbol: "bed" },
  { id: "king-bed", name: "King bed", category: "Furniture", width: 76, depth: 80, symbol: "bed" },
  { id: "twin-bed", name: "Twin bed", category: "Furniture", width: 38, depth: 75, symbol: "bed" },
  { id: "sofa", name: "Sofa", category: "Furniture", width: 84, depth: 36, symbol: "sofa" },
  { id: "armchair", name: "Armchair", category: "Furniture", width: 34, depth: 34, symbol: "sofa" },
  { id: "coffee-table", name: "Coffee table", category: "Furniture", width: 48, depth: 24, symbol: "table" },
  { id: "dining-table", name: "Dining table", category: "Furniture", width: 60, depth: 36, symbol: "table" },
  { id: "chair", name: "Dining chair", category: "Furniture", width: 20, depth: 20, symbol: "chair" },
  { id: "desk", name: "Desk", category: "Furniture", width: 48, depth: 24, symbol: "desk" },
  { id: "nightstand", name: "Nightstand", category: "Furniture", width: 20, depth: 20, symbol: "table" },
  { id: "closet", name: "Wardrobe", category: "Furniture", width: 60, depth: 24, symbol: "cabinet" },
  { id: "tub", name: "Bathtub", category: "Bathroom", width: 60, depth: 30, symbol: "tub" },
  { id: "toilet", name: "Toilet", category: "Bathroom", width: 20, depth: 30, symbol: "toilet" },
  { id: "shower", name: "Roll-in shower", category: "Bathroom", width: 48, depth: 48, symbol: "shower" },
  { id: "vanity", name: "Vanity & basin", category: "Bathroom", width: 36, depth: 24, symbol: "sink" },
  { id: "grab-bar", name: "Grab bar", category: "Bathroom", width: 36, depth: 3, symbol: "bar" },
  { id: "sink", name: "Kitchen sink", category: "Kitchen", width: 30, depth: 22, symbol: "sink" },
  { id: "counter", name: "Countertop", category: "Kitchen", width: 72, depth: 24, symbol: "cabinet" },
  { id: "island", name: "Kitchen island", category: "Kitchen", width: 60, depth: 36, symbol: "cabinet" },
  { id: "range", name: "Range / stove", category: "Kitchen", width: 30, depth: 28, symbol: "range" },
  { id: "fridge", name: "Refrigerator", category: "Kitchen", width: 36, depth: 36, symbol: "fridge" },
  { id: "dishwasher", name: "Dishwasher", category: "Kitchen", width: 24, depth: 24, symbol: "appliance" },
  { id: "washer", name: "Washer", category: "Plumbing", width: 27, depth: 30, symbol: "washer" },
  { id: "dryer", name: "Dryer", category: "Plumbing", width: 27, depth: 30, symbol: "washer" },
  { id: "water-heater", name: "Water heater", category: "Plumbing", width: 24, depth: 24, symbol: "heater" },
  { id: "floor-drain", name: "Floor drain", category: "Plumbing", width: 6, depth: 6, symbol: "drain" },
  { id: "outlet", name: "Duplex outlet", category: "Electrical", width: 8, depth: 8, symbol: "outlet" },
  { id: "gfci", name: "GFCI outlet", category: "Electrical", width: 8, depth: 8, symbol: "gfci" },
  { id: "switch", name: "Light switch", category: "Electrical", width: 8, depth: 8, symbol: "switch" },
  { id: "light", name: "Ceiling light", category: "Electrical", width: 12, depth: 12, symbol: "light" },
  { id: "fan", name: "Ceiling fan", category: "Electrical", width: 52, depth: 52, symbol: "fan" },
  { id: "panel", name: "Electrical panel", category: "Electrical", width: 18, depth: 6, symbol: "panel" },
  { id: "smoke", name: "Smoke detector", category: "Electrical", width: 8, depth: 8, symbol: "smoke" },
];
export const CATEGORIES: CatalogCategory[] = ["Furniture", "Bathroom", "Kitchen", "Electrical", "Plumbing"];
export const CATALOG_MAP = new Map(CATALOG.map(item => [item.id, item]));
