"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, FileText, Image as ImageIcon, Loader2, Plus, Trash2,
  Users, Calculator, Info, Download, Trash, Sparkles,
} from "lucide-react";
import {
  auctionApi,
  type AuctionCaseDetail,
  type AuctionCaseStatus,
} from "@/lib/auctionApi";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

const STATUS_OPTIONS: { value: AuctionCaseStatus; label: string }[] = [
  { value: "watching", label: "관심" },
  { value: "researching", label: "조사중" },
  { value: "rights_check", label: "권리분석" },
  { value: "field_check", label: "임장" },
  { value: "loan_check", label: "대출확인" },
  { value: "bid_review", label: "입찰검토" },
  { value: "bid_day", label: "입찰일" },
  { value: "won", label: "낙찰" },
  { value: "won_day_action", label: "낙찰후처리" },
  { value: "balance", label: "잔금" },
  { value: "eviction", label: "명도" },
  { value: "leasing", label: "임대" },
  { value: "completed", label: "완료" },
  { value: "abandoned", label: "포기" },
];

function fmt(n: number | null | undefined) {
  if (n == null) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

type Tab = "info" | "tenants" | "bid";

export default function AuctionCaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = Number(params.id);

  const [tab, setTab] = useState<Tab>("info");
  const [data, setData] = useState<AuctionCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const detail = await auctionApi.getCase(caseId);
      setData(detail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (caseId) load();
  }, [caseId]);

  async function handleField(field: keyof AuctionCaseDetail, value: unknown) {
    if (!data) return;
    setData({ ...data, [field]: value } as AuctionCaseDetail);
  }

  async function handleSave() {
    if (!data) return;
    setSaving(true);
    try {
      await auctionApi.updateCase(caseId, {
        case_number: data.case_number,
        address: data.address,
        list_title: data.list_title || undefined,
        property_type: data.property_type || undefined,
        built_year: data.built_year || undefined,
        floor: data.floor || undefined,
        household_count: data.household_count ?? undefined,
        land_area_sqm: data.land_area_sqm ?? undefined,
        building_area_sqm: data.building_area_sqm ?? undefined,
        parking_unit_count: data.parking_unit_count ?? undefined,
        appraisal_price: data.appraisal_price ?? undefined,
        min_price: data.min_price ?? undefined,
        expected_bid_price: data.expected_bid_price ?? undefined,
        bid_date: data.bid_date || undefined,
        current_round: data.current_round,
        status: data.status,
        priority_level: data.priority_level,
        memo: data.memo || undefined,
        market_notes: data.market_notes || undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCase() {
    if (!confirm("이 물건을 삭제하시겠습니까? PDF·이미지 파일도 함께 삭제됩니다.")) return;
    await auctionApi.deleteCase(caseId);
    router.push("/auction");
  }

  async function handlePdfUpload(file: File) {
    setSaving(true);
    try {
      await auctionApi.uploadSourceDocument(caseId, file, { kind: "pdf" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 업로드 실패");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDoc(docId: number) {
    await auctionApi.deleteSourceDocument(caseId, docId);
    await load();
  }

  async function handleThumbnailUpload(file: File) {
    setSaving(true);
    try {
      await auctionApi.uploadThumbnail(caseId, { cover: file, listImage: file });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "썸네일 업로드 실패");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return <p className="text-sm text-rose-500">{error}</p>;
  }

  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/auction")}
          className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          <ArrowLeft size={14} />
          목록으로
        </button>
        <button
          onClick={handleDeleteCase}
          className="flex items-center gap-1.5 text-xs text-rose-500 hover:text-rose-600"
        >
          <Trash size={12} />
          물건 삭제
        </button>
      </div>

      <div>
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
          {data.case_number} · {data.address}
        </h1>
      </div>

      <div className="flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-700">
        {([
          { id: "info" as Tab, label: "기본정보", icon: Info },
          { id: "tenants" as Tab, label: "세입자 분석", icon: Users },
          { id: "bid" as Tab, label: "입찰가 분석", icon: Calculator },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === id
                ? "border-amber-600 text-amber-700 dark:text-amber-400 font-medium"
                : "border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {tab === "info" && (
        <InfoTab
          data={data}
          onField={handleField}
          onSave={handleSave}
          saving={saving}
          onPdfUpload={handlePdfUpload}
          onDeleteDoc={handleDeleteDoc}
          onThumbnailUpload={handleThumbnailUpload}
        />
      )}
      {tab === "tenants" && <TenantsTab caseId={caseId} data={data} reload={load} />}
      {tab === "bid" && <BidTab caseId={caseId} data={data} reload={load} />}
    </div>
  );
}

function FieldInput({
  label, value, onChange, type = "text",
}: {
  label: string;
  value: string | number | null | undefined;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-neutral-500 mb-1">{label}</label>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400"
      />
    </div>
  );
}

function InfoTab({
  data, onField, onSave, saving, onPdfUpload, onDeleteDoc, onThumbnailUpload,
}: {
  data: AuctionCaseDetail;
  onField: (field: keyof AuctionCaseDetail, value: unknown) => void;
  onSave: () => void;
  saving: boolean;
  onPdfUpload: (file: File) => void;
  onDeleteDoc: (docId: number) => void;
  onThumbnailUpload: (file: File) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 space-y-4">
        <div className="flex gap-5">
          <div className="w-56 h-36 shrink-0 bg-neutral-100 dark:bg-neutral-800 rounded-md overflow-hidden flex items-center justify-center">
            {data.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_BASE}${data.thumbnail_url}`} alt="" className="w-full h-full object-cover" />
            ) : (
              <ImageIcon size={24} className="text-neutral-300 dark:text-neutral-600" />
            )}
          </div>
          <div className="flex-1 grid grid-cols-3 lg:grid-cols-6 gap-3">
            <FieldInput label="사건번호" value={data.case_number} onChange={(v) => onField("case_number", v)} />
            <FieldInput label="주소" value={data.address} onChange={(v) => onField("address", v)} />
            <FieldInput label="물건 유형" value={data.property_type} onChange={(v) => onField("property_type", v)} />
            <div>
              <label className="block text-xs text-neutral-500 mb-1">진행 상태</label>
              <select
                value={data.status}
                onChange={(e) => onField("status", e.target.value)}
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 rounded-md"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <FieldInput label="입찰일" type="date" value={data.bid_date} onChange={(v) => onField("bid_date", v)} />
            <div>
              <label className="block text-xs text-neutral-500 mb-1 flex items-center gap-1">
                <ImageIcon size={11} /> 표지/썸네일 교체
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && onThumbnailUpload(e.target.files[0])}
                className="w-full text-xs text-neutral-500"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FieldInput label="감정가 (원)" type="number" value={data.appraisal_price} onChange={(v) => onField("appraisal_price", Number(v))} />
          <FieldInput label="최저가 (원)" type="number" value={data.min_price} onChange={(v) => onField("min_price", Number(v))} />
          <FieldInput label="예상 낙찰가 (원)" type="number" value={data.expected_bid_price} onChange={(v) => onField("expected_bid_price", Number(v))} />
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <FieldInput label="건축연도" value={data.built_year} onChange={(v) => onField("built_year", v)} />
          <FieldInput label="층" value={data.floor} onChange={(v) => onField("floor", v)} />
          <FieldInput label="세대수" type="number" value={data.household_count} onChange={(v) => onField("household_count", Number(v))} />
          <FieldInput label="토지면적(㎡)" type="number" value={data.land_area_sqm} onChange={(v) => onField("land_area_sqm", Number(v))} />
          <FieldInput label="건물면적(㎡)" type="number" value={data.building_area_sqm} onChange={(v) => onField("building_area_sqm", Number(v))} />
          <FieldInput label="주차대수" type="number" value={data.parking_unit_count} onChange={(v) => onField("parking_unit_count", Number(v))} />
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">메모</label>
            <textarea
              value={data.memo ?? ""}
              onChange={(e) => onField("memo", e.target.value)}
              rows={5}
              className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">월세·주변시세 메모</label>
            <textarea
              value={data.market_notes ?? ""}
              onChange={(e) => onField("market_notes", e.target.value)}
              rows={5}
              placeholder="인근 매물 시세, 임대수익 추정 등 자유 메모"
              className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            저장
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
            <FileText size={14} />
            첨부 PDF 원문
          </h3>
          <label className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 cursor-pointer">
            <Plus size={12} />
            PDF 추가
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onPdfUpload(e.target.files[0])}
            />
          </label>
        </div>
        {data.source_documents.length === 0 ? (
          <p className="text-xs text-neutral-400 text-center py-4">첨부된 PDF가 없습니다.</p>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {data.source_documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between py-2 text-sm">
                <a
                  href={`${API_BASE}${doc.url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300 hover:underline"
                >
                  <Download size={12} />
                  {doc.original_name || `문서 #${doc.id}`}
                  <span className="text-xs text-neutral-400">
                    {doc.file_size ? `(${Math.round(doc.file_size / 1024)}KB)` : ""}
                  </span>
                </a>
                <button onClick={() => onDeleteDoc(doc.id)} className="text-neutral-400 hover:text-rose-500">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function emptyTenantForm() {
  return { unit: "", occupant_name: "", deposit: "", monthly_rent: "", memo: "" };
}

function TenantsTab({
  caseId, data, reload,
}: {
  caseId: number;
  data: AuctionCaseDetail;
  reload: () => Promise<void>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyTenantForm());
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function handleRefreshFromSaleStatement(file: File) {
    if (
      !confirm(
        "매각물건명세서로 갱신하면 현재 등록된 세입자 기록이 모두 삭제되고 이 문서에서 읽은 내용으로 교체됩니다. 계속하시겠습니까?",
      )
    ) {
      return;
    }
    setRefreshing(true);
    setRefreshError(null);
    try {
      await auctionApi.refreshTenantsFromSaleStatement(caseId, file);
      await reload();
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "매각물건명세서 분석 실패");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleAdd() {
    setSaving(true);
    try {
      await auctionApi.createTenant(caseId, {
        unit: form.unit || undefined,
        occupant_name: form.occupant_name || undefined,
        deposit: form.deposit ? Number(form.deposit) : undefined,
        monthly_rent: form.monthly_rent ? Number(form.monthly_rent) : undefined,
        memo: form.memo || undefined,
      });
      setForm(emptyTenantForm());
      setFormOpen(false);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tenantId: number) {
    await auctionApi.deleteTenant(caseId, tenantId);
    await reload();
  }

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">호실별 임차인 기록</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 cursor-pointer">
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            매각물건명세서로 갱신
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={refreshing}
              onChange={(e) => e.target.files?.[0] && handleRefreshFromSaleStatement(e.target.files[0])}
            />
          </label>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700"
          >
            <Plus size={12} />
            세입자 추가
          </button>
        </div>
      </div>

      {refreshError && <p className="text-xs text-rose-500">{refreshError}</p>}

      {formOpen && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end p-3 bg-neutral-50 dark:bg-neutral-800 rounded-md">
          <FieldInput label="호실" value={form.unit} onChange={(v) => setForm((f) => ({ ...f, unit: v }))} />
          <FieldInput label="임차인명" value={form.occupant_name} onChange={(v) => setForm((f) => ({ ...f, occupant_name: v }))} />
          <FieldInput label="보증금" type="number" value={form.deposit} onChange={(v) => setForm((f) => ({ ...f, deposit: v }))} />
          <FieldInput label="월세" type="number" value={form.monthly_rent} onChange={(v) => setForm((f) => ({ ...f, monthly_rent: v }))} />
          <button
            onClick={handleAdd}
            disabled={saving}
            className="px-3 py-2 text-sm font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
          >
            추가
          </button>
        </div>
      )}

      {data.tenant_records.length === 0 ? (
        <p className="text-xs text-neutral-400 text-center py-6">등록된 세입자 기록이 없습니다.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100 dark:border-neutral-800">
              <th className="py-2">호실</th>
              <th className="py-2">임차인</th>
              <th className="py-2">보증금</th>
              <th className="py-2">월세</th>
              <th className="py-2">배당상태</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.tenant_records.map((t) => (
              <tr key={t.id} className="border-b border-neutral-50 dark:border-neutral-800/50">
                <td className="py-2">{t.unit || "-"}</td>
                <td className="py-2">{t.occupant_name || "-"}</td>
                <td className="py-2">{fmt(t.deposit)}</td>
                <td className="py-2">{fmt(t.monthly_rent)}</td>
                <td className="py-2 text-xs text-neutral-400">{t.dividend_status}</td>
                <td className="py-2 text-right">
                  <button onClick={() => handleDelete(t.id)} className="text-neutral-400 hover:text-rose-500">
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function emptyComparableForm() {
  return { case_number: "", appraisal_price: "", winning_bid_price: "" };
}

function BidTab({
  caseId, data, reload,
}: {
  caseId: number;
  data: AuctionCaseDetail;
  reload: () => Promise<void>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyComparableForm());
  const [saving, setSaving] = useState(false);
  const [computing, setComputing] = useState(false);

  async function handleAdd() {
    setSaving(true);
    try {
      await auctionApi.createComparable(caseId, {
        case_number: form.case_number || undefined,
        appraisal_price: form.appraisal_price ? Number(form.appraisal_price) : undefined,
        winning_bid_price: form.winning_bid_price ? Number(form.winning_bid_price) : undefined,
      });
      setForm(emptyComparableForm());
      setFormOpen(false);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(compId: number) {
    await auctionApi.deleteComparable(caseId, compId);
    await reload();
  }

  async function handleCompute() {
    setComputing(true);
    try {
      await auctionApi.computeBidAnalysis(caseId);
      await reload();
    } finally {
      setComputing(false);
    }
  }

  const bid = data.bid_analysis;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">인근 매각 비교사례</h3>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700"
          >
            <Plus size={12} />
            비교사례 추가
          </button>
        </div>

        {formOpen && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end p-3 bg-neutral-50 dark:bg-neutral-800 rounded-md">
            <FieldInput label="사건번호" value={form.case_number} onChange={(v) => setForm((f) => ({ ...f, case_number: v }))} />
            <FieldInput label="감정가" type="number" value={form.appraisal_price} onChange={(v) => setForm((f) => ({ ...f, appraisal_price: v }))} />
            <FieldInput label="낙찰가" type="number" value={form.winning_bid_price} onChange={(v) => setForm((f) => ({ ...f, winning_bid_price: v }))} />
            <button
              onClick={handleAdd}
              disabled={saving}
              className="px-3 py-2 text-sm font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
            >
              추가
            </button>
          </div>
        )}

        {data.sale_comparables.length === 0 ? (
          <p className="text-xs text-neutral-400 text-center py-6">등록된 비교사례가 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100 dark:border-neutral-800">
                <th className="py-2">사건번호</th>
                <th className="py-2">감정가</th>
                <th className="py-2">낙찰가</th>
                <th className="py-2">낙찰가율</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.sale_comparables.map((c) => (
                <tr key={c.id} className="border-b border-neutral-50 dark:border-neutral-800/50">
                  <td className="py-2">{c.case_number || "-"}</td>
                  <td className="py-2">{fmt(c.appraisal_price)}</td>
                  <td className="py-2">{fmt(c.winning_bid_price)}</td>
                  <td className="py-2 font-medium">{c.bid_rate_pct != null ? `${c.bid_rate_pct}%` : "-"}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => handleDelete(c.id)} className="text-neutral-400 hover:text-rose-500">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
            <Calculator size={14} />
            제안 입찰가 계산
          </h3>
          <button
            onClick={handleCompute}
            disabled={computing}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-50"
          >
            {computing && <Loader2 size={11} className="animate-spin" />}
            계산하기
          </button>
        </div>
        {bid ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-md p-3">
                <p className="text-[11px] text-neutral-400">제안 입찰가</p>
                <p className="text-base font-bold text-amber-700 dark:text-amber-400">{fmt(bid.suggested_bid_won)}</p>
              </div>
              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-md p-3">
                <p className="text-[11px] text-neutral-400">중간 낙찰가율</p>
                <p className="text-base font-bold text-neutral-700 dark:text-neutral-300">
                  {bid.median_bid_rate_pct != null ? `${bid.median_bid_rate_pct}%` : "-"}
                </p>
              </div>
              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-md p-3">
                <p className="text-[11px] text-neutral-400">비교사례 수</p>
                <p className="text-base font-bold text-neutral-700 dark:text-neutral-300">{bid.peer_count}건</p>
              </div>
            </div>
            {bid.narrative && (
              <p className="text-xs text-neutral-500 leading-relaxed bg-neutral-50 dark:bg-neutral-800 rounded-md p-3">
                {bid.narrative}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-neutral-400 text-center py-4">
            비교사례를 등록하고 &quot;계산하기&quot;를 누르면 제안 입찰가가 표시됩니다.
          </p>
        )}
      </div>
    </div>
  );
}
