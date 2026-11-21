export type Lot = {
  id: string;
  lotNumber: string;
  initialQuantity: string;
  remainingQuantity: string;
  unitCost: string;
  expirationDate: string | null;
  receivedAt: string;
  supplierName?: string | null;
};
