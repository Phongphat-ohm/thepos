import { Prisma } from "@prisma/client";

export const Decimal = Prisma.Decimal.clone({ precision: 40 });
export const dateText = (date: Date) => date.toISOString().slice(0, 10);
export const dayDate = (day: string) => new Date(day + "T00:00:00.000Z");

const bangkok = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok" });
export const bangkokDay = (value: number) => bangkok.format(new Date(value));
