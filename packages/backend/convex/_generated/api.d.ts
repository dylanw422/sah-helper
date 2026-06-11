/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as clientFiles from "../clientFiles.js";
import type * as clients from "../clients.js";
import type * as healthCheck from "../healthCheck.js";
import type * as http from "../http.js";
import type * as invoices from "../invoices.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_drawSchedule from "../lib/drawSchedule.js";
import type * as lib_pdf from "../lib/pdf.js";
import type * as lib_pdfFieldMap from "../lib/pdfFieldMap.js";
import type * as lib_scopeOfWorkPdf from "../lib/scopeOfWorkPdf.js";
import type * as lib_templateKeys from "../lib/templateKeys.js";
import type * as lib_templateNames from "../lib/templateNames.js";
import type * as packets from "../packets.js";
import type * as privateData from "../privateData.js";
import type * as scopeOfWork from "../scopeOfWork.js";
import type * as settings from "../settings.js";
import type * as templateMapping from "../templateMapping.js";
import type * as templates from "../templates.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  clientFiles: typeof clientFiles;
  clients: typeof clients;
  healthCheck: typeof healthCheck;
  http: typeof http;
  invoices: typeof invoices;
  "lib/auth": typeof lib_auth;
  "lib/drawSchedule": typeof lib_drawSchedule;
  "lib/pdf": typeof lib_pdf;
  "lib/pdfFieldMap": typeof lib_pdfFieldMap;
  "lib/scopeOfWorkPdf": typeof lib_scopeOfWorkPdf;
  "lib/templateKeys": typeof lib_templateKeys;
  "lib/templateNames": typeof lib_templateNames;
  packets: typeof packets;
  privateData: typeof privateData;
  scopeOfWork: typeof scopeOfWork;
  settings: typeof settings;
  templateMapping: typeof templateMapping;
  templates: typeof templates;
  uploads: typeof uploads;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
