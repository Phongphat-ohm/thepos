import { RefreshCw } from "lucide-react";
import { Autocomplete } from "@/components/common/autocomplete";
import type { Page } from "@/components/data-table/table";
import { Button } from "@/components/ui/button";
import { productText, type Product } from "@/features/catalog/types";
import { business } from "@/lib/native";

const searchProducts = (q: string, after?: string) =>
  business<Page<Product>>("products", { query: { q, after, stockTracked: "true" } });

export function StockProductFilter({
  product,
  busy,
  choose,
  refresh,
}: {
  product: Product | null;
  busy: boolean;
  choose: (product: Product | null) => void;
  refresh: () => void;
}) {
  return (
    <div className="stock-inline stock-search">
      <Autocomplete
        label="สินค้า"
        placeholder="ชื่อสินค้า รหัส SKU หรือบาร์โค้ด"
        value={product}
        onChange={choose}
        maxLength={255}
        text={productText}
        load={searchProducts}
        disabled={busy}
      />
      {product && (
        <Button type="button" variant="outline" loading={busy} onClick={refresh}>
          <RefreshCw size={15} /> โหลดข้อมูลล่าสุด
        </Button>
      )}
    </div>
  );
}
