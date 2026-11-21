export type Payment = {
  method: string;
  amount: string;
  tendered?: string | null;
  change?: string | null;
  reference?: string | null;
};

export type Receipt = {
  id: string;
  invoiceNumber: string;
  completedAt: string;
  storeName: string;
  cashierName: string;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  receiptLogo?: string | null;
  memberName: string | null;
  subtotal: string;
  netTotal: string;
  billDiscount: string;
  discountTotal: string;
  items: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    quantity: string;
    lineTotal: string;
    lineDiscount: string;
    billDiscountShare: string;
    returnable?: string;
  }[];
  payments: Payment[];
  returnedTotal?: string;
};

export type PrintSettings = {
  printer: string;
  paper: 58 | 80;
  escpos: boolean;
  cut: boolean;
  drawer: boolean;
};

export const defaultPrintSettings: PrintSettings = {
  printer: "",
  paper: 80,
  escpos: false,
  cut: false,
  drawer: false,
};
