import type { ProductInput } from "@thepos/contracts";

export type Product = ProductInput & { id: string; categoryName?: string };
export const productText = ({ sku, name }: Product) => `${sku} · ${name}`;
