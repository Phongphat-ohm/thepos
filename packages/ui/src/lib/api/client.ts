import {
  bootstrapSchema,
  enrollableDeviceSchema,
  enrollSchema,
  loginSchema,
  profileSchema,
  setupStatusSchema,
  type EnrollableDevice,
} from "@thepos/contracts";
import { z } from "zod";
import type { BusinessOptions, BusinessRoute } from "./routes";
import { webExecute } from "./web-transport";

type DesktopInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let desktopInvoke: DesktopInvoke | null = null;

export function registerDesktopTransport(invokeFn: DesktopInvoke) {
  desktopInvoke = invokeFn;
}

export function invokeDesktop<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!desktopInvoke) return Promise.reject("UNAVAILABLE");
  return desktopInvoke<T>(cmd, args);
}

export const isDesktopApp = () =>
  desktopInvoke !== null || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);

const connectionSchema = z.object({
  url: z.string().nullable(),
  setup: setupStatusSchema.nullable(),
  lockedUser: z.string().nullable(),
});

export type Connection = z.infer<typeof connectionSchema>;

function request<T = unknown>(kind: string, data: Record<string, unknown> = {}) {
  if (desktopInvoke) return desktopInvoke<T>("pos_request", { command: { kind, ...data } });
  return webExecute(kind, data) as Promise<T>;
}

export function business<T>(route: BusinessRoute, options: BusinessOptions = {}) {
  return request<T>("business", { route, ...options });
}

const setupDevicesSchema = z.object({ items: z.array(enrollableDeviceSchema) });

export const native = {
  startup: async () => connectionSchema.parse(await request("startup")),
  setupDevices: async (): Promise<EnrollableDevice[]> => setupDevicesSchema.parse(await request("setup_devices")).items,
  verifyAdmin: (input: z.infer<typeof loginSchema>) => request<{ ok: true }>("verify_admin", { input }),
  connect: async (url: string, serverKey: string) =>
    connectionSchema.parse(await request("connect", { url, server_key: serverKey })),
  bootstrap: (input: z.infer<typeof bootstrapSchema>) => request("bootstrap", { input }),
  enroll: (input: z.infer<typeof enrollSchema>) => request("enroll", { input }),
  login: async (input: z.infer<typeof loginSchema>) => profileSchema.parse(await request("login", { input })),
  profile: async () => profileSchema.parse(await request("profile")),
  lock: () => request("lock"),
  unlock: async (pin: string) => profileSchema.parse(await request("unlock", { pin })),
  logout: () => request("logout"),
};
