const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.text();
    let message = err || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(err) as { detail?: unknown };
      if (typeof parsed.detail === "string") message = parsed.detail;
    } catch {
      /* keep raw */
    }
    throw new Error(message);
  }
  return res.json();
}

async function fetchFormApi<T>(path: string, form: FormData, method: string = "POST"): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, body: form });
  if (!res.ok) {
    const err = await res.text();
    let message = err || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(err) as { detail?: unknown };
      if (typeof parsed.detail === "string") message = parsed.detail;
    } catch {
      /* keep raw */
    }
    throw new Error(message);
  }
  return res.json();
}

export type AuctionCaseStatus =
  | "watching" | "researching" | "rights_check" | "field_check" | "loan_check"
  | "bid_review" | "bid_day" | "won" | "won_day_action" | "balance"
  | "eviction" | "leasing" | "completed" | "abandoned";

export interface AuctionCaseSummary {
  id: number;
  case_number: string;
  address: string;
  list_title: string | null;
  property_type: string | null;
  appraisal_price: number | null;
  min_price: number | null;
  expected_bid_price: number | null;
  bid_date: string | null;
  current_round: number;
  status: AuctionCaseStatus;
  priority_level: number;
  created_at: string | null;
  updated_at: string | null;
  thumbnail_url: string | null;
  cover_url: string | null;
}

export interface AuctionSourceDocument {
  id: number;
  case_id: number;
  kind: string;
  url: string;
  original_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  page_count: number | null;
  extracted_text: string | null;
  created_at: string | null;
}

export interface AuctionTenantRecord {
  id: number;
  case_id: number;
  unit: string | null;
  occupant_name: string | null;
  deposit: number | null;
  monthly_rent: number | null;
  move_in_date: string | null;
  confirmed_date: string | null;
  dividend_request_date: string | null;
  has_opposing_power: boolean | null;
  dividend_amount: number | null;
  undivided_amount: number | null;
  dividend_status: string;
  inquiry_notes: string | null;
  memo: string | null;
  updated_at: string | null;
}

export interface AuctionSaleComparable {
  id: number;
  case_id: number;
  case_number: string | null;
  address: string | null;
  appraisal_price: number | null;
  winning_bid_price: number | null;
  bid_rate_pct: number | null;
  sold_round: number | null;
  bid_date: string | null;
  memo: string | null;
  created_at: string | null;
}

export interface AuctionBidAnalysis {
  peer_count: number;
  median_bid_rate_pct: number | null;
  suggested_bid_won: number | null;
  suggested_bid_rate_pct: number | null;
  range_low_won: number | null;
  range_high_won: number | null;
  narrative: string | null;
  computed_at: string | null;
}

export interface AuctionCaseDetail extends AuctionCaseSummary {
  built_year: string | null;
  floor: string | null;
  household_count: number | null;
  land_area_sqm: number | null;
  building_area_sqm: number | null;
  parking_unit_count: number | null;
  memo: string | null;
  market_notes: string | null;
  extracted_text: string | null;
  source_documents: AuctionSourceDocument[];
  tenant_records: AuctionTenantRecord[];
  sale_comparables: AuctionSaleComparable[];
  bid_analysis: AuctionBidAnalysis | null;
}

export type AuctionCaseInput = Partial<
  Omit<AuctionCaseDetail, "id" | "created_at" | "updated_at" | "thumbnail_url" | "cover_url" | "source_documents" | "tenant_records" | "sale_comparables" | "bid_analysis">
>;

export type AuctionTenantInput = Partial<Omit<AuctionTenantRecord, "id" | "case_id" | "updated_at">>;
export type AuctionComparableInput = Partial<Omit<AuctionSaleComparable, "id" | "case_id" | "bid_rate_pct" | "created_at">>;

export interface AuctionBackupRestoreResult {
  ok: boolean;
  restoredAt: string;
  summary: {
    cases: number;
    source_documents: number;
    tenant_records: number;
    sale_comparables: number;
  };
}

export interface AuctionPdfExtractResult {
  page_count: number;
  extracted_text: string;
  kind: string;
  extracted: Record<string, unknown>;
  case_fields: AuctionCaseInput;
  tenants: AuctionTenantInput[];
  warnings: string[];
}

export const auctionApi = {
  getCases: () => fetchApi<{ items: AuctionCaseSummary[] }>("/auction/cases"),
  getCase: (id: number) => fetchApi<AuctionCaseDetail>(`/auction/cases/${id}`),
  createCase: (body: AuctionCaseInput) =>
    fetchApi<AuctionCaseDetail>("/auction/cases", { method: "POST", body: JSON.stringify(body) }),
  updateCase: (id: number, body: AuctionCaseInput) =>
    fetchApi<AuctionCaseDetail>(`/auction/cases/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteCase: (id: number) =>
    fetchApi<{ ok: boolean }>(`/auction/cases/${id}`, { method: "DELETE" }),

  uploadSourceDocument: (
    caseId: number,
    file: File,
    opts?: { kind?: string; extractedText?: string; structuredJson?: string; pageCount?: number },
  ) => {
    const form = new FormData();
    form.append("file", file);
    if (opts?.kind) form.append("kind", opts.kind);
    if (opts?.extractedText) form.append("extracted_text", opts.extractedText);
    if (opts?.structuredJson) form.append("structured_json", opts.structuredJson);
    if (opts?.pageCount != null) form.append("page_count", String(opts.pageCount));
    return fetchFormApi<AuctionCaseDetail>(`/auction/cases/${caseId}/source-documents`, form);
  },

  extractFromPdf: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetchFormApi<AuctionPdfExtractResult>("/auction/pdf-extract", form);
  },
  deleteSourceDocument: (caseId: number, docId: number) =>
    fetchApi<{ ok: boolean }>(`/auction/cases/${caseId}/source-documents/${docId}`, { method: "DELETE" }),

  uploadThumbnail: (caseId: number, opts: { cover?: File; listImage?: File }) => {
    const form = new FormData();
    if (opts.cover) form.append("cover", opts.cover);
    if (opts.listImage) form.append("list_image", opts.listImage);
    return fetchFormApi<AuctionCaseDetail>(`/auction/cases/${caseId}/thumbnail`, form);
  },

  getTenants: (caseId: number) => fetchApi<{ items: AuctionTenantRecord[] }>(`/auction/cases/${caseId}/tenants`),
  createTenant: (caseId: number, body: AuctionTenantInput) =>
    fetchApi<AuctionTenantRecord>(`/auction/cases/${caseId}/tenants`, { method: "POST", body: JSON.stringify(body) }),
  updateTenant: (caseId: number, tenantId: number, body: AuctionTenantInput) =>
    fetchApi<AuctionTenantRecord>(`/auction/cases/${caseId}/tenants/${tenantId}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteTenant: (caseId: number, tenantId: number) =>
    fetchApi<{ ok: boolean }>(`/auction/cases/${caseId}/tenants/${tenantId}`, { method: "DELETE" }),
  refreshTenantsFromSaleStatement: (caseId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetchFormApi<{ tenants: AuctionTenantRecord[]; case_number: string | null; address: string | null }>(
      `/auction/cases/${caseId}/tenants/from-sale-statement`,
      form,
    );
  },

  getComparables: (caseId: number) => fetchApi<{ items: AuctionSaleComparable[] }>(`/auction/cases/${caseId}/comparables`),
  createComparable: (caseId: number, body: AuctionComparableInput) =>
    fetchApi<AuctionSaleComparable>(`/auction/cases/${caseId}/comparables`, { method: "POST", body: JSON.stringify(body) }),
  deleteComparable: (caseId: number, comparableId: number) =>
    fetchApi<{ ok: boolean }>(`/auction/cases/${caseId}/comparables/${comparableId}`, { method: "DELETE" }),

  computeBidAnalysis: (caseId: number) =>
    fetchApi<AuctionBidAnalysis>(`/auction/cases/${caseId}/bid-analysis/compute`, { method: "POST" }),
  getBidAnalysis: (caseId: number) => fetchApi<AuctionBidAnalysis | null>(`/auction/cases/${caseId}/bid-analysis`),

  downloadBackupUrl: () => `${BASE}/auction/backup`,
  restoreBackup: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetchFormApi<AuctionBackupRestoreResult>("/auction/backup/restore", form);
  },
};
