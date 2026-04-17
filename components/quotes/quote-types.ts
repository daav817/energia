export type ComparisonRfpQuote = {
  id: string;
  rate: number;
  priceUnit: string;
  termMonths: number;
  supplier: { id: string; name: string };
  /** Present when this row belongs to an electric comparison bucket. */
  comparisonBucket?: string | null;
};

export type TermPick = { kind: "quote"; quoteId: string } | { kind: "manual"; rowId: string };

export type ManualQuoteRow = {
  id: string;
  supplierName: string;
  rates: Partial<Record<number, string>>;
  units: Partial<Record<number, string>>;
};
