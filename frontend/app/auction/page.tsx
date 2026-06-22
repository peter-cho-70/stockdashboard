"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X, Image as ImageIcon, FileText, Loader2, Gavel, Sparkles } from "lucide-react";
import { auctionApi, type AuctionCaseSummary } from "@/lib/auctionApi";

const STATUS_LABELS: Record<string, string> = {
  watching: "관심", researching: "조사중", rights_check: "권리분석", field_check: "임장",
  loan_check: "대출확인", bid_review: "입찰검토", bid_day: "입찰일", won: "낙찰",
  won_day_action: "낙찰후처리", balance: "잔금", eviction: "명도", leasing: "임대",
  completed: "완료", abandoned: "포기",
};

function fmtWon(n: number | null) {
  if (n == null) return "-";
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "억";
  if (n >= 10000) return Math.round(n / 10000) + "만";
  return n.toLocaleString("ko-KR");
}

function emptyForm() {
  return {
    case_number: "",
    address: "",
    property_type: "",
    appraisal_price: "",
    min_price: "",
    bid_date: "",
  };
}

export default function AuctionCaseListPage() {
  const router = useRouter();
  const [cases, setCases] = useState<AuctionCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const quickPdfInputRef = useRef<HTMLInputElement>(null);
  const [quickPdfBusy, setQuickPdfBusy] = useState(false);
  const [quickPdfNotice, setQuickPdfNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { items } = await auctionApi.getCases();
      setCases(items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit() {
    if (!form.case_number.trim() || !form.address.trim()) {
      setSubmitError("사건번호와 주소는 필수입니다.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await auctionApi.createCase({
        case_number: form.case_number.trim(),
        address: form.address.trim(),
        property_type: form.property_type || undefined,
        appraisal_price: form.appraisal_price ? Number(form.appraisal_price) : undefined,
        min_price: form.min_price ? Number(form.min_price) : undefined,
        bid_date: form.bid_date || undefined,
      });

      if (pdfFile) {
        await auctionApi.uploadSourceDocument(created.id, pdfFile, { kind: "pdf" });
      }
      if (coverFile) {
        await auctionApi.uploadThumbnail(created.id, { cover: coverFile, listImage: coverFile });
      }

      setForm(emptyForm());
      setPdfFile(null);
      setCoverFile(null);
      setFormOpen(false);
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleQuickPdfRegister(file: File) {
    setQuickPdfBusy(true);
    setQuickPdfNotice(null);
    try {
      const result = await auctionApi.extractFromPdf(file);
      const fields = result.case_fields;

      if (!fields.case_number || !fields.address) {
        setForm((f) => ({
          ...f,
          case_number: fields.case_number || f.case_number,
          address: fields.address || f.address,
          property_type: fields.property_type || f.property_type,
          appraisal_price: fields.appraisal_price != null ? String(fields.appraisal_price) : f.appraisal_price,
          min_price: fields.min_price != null ? String(fields.min_price) : f.min_price,
          bid_date: fields.bid_date || f.bid_date,
        }));
        setPdfFile(file);
        setFormOpen(true);
        setQuickPdfNotice(
          "PDF에서 사건번호 또는 주소를 찾지 못해 직접 입력이 필요합니다. 나머지 항목은 자동으로 채워졌습니다.",
        );
        return;
      }

      const created = await auctionApi.createCase(fields);
      await auctionApi.uploadSourceDocument(created.id, file, {
        kind: result.kind,
        extractedText: result.extracted_text,
        structuredJson: JSON.stringify(result.extracted),
      });
      for (const tenant of result.tenants) {
        if (tenant.occupant_name || tenant.unit) {
          await auctionApi.createTenant(created.id, tenant);
        }
      }
      router.push(`/auction/${created.id}`);
    } catch (err) {
      setQuickPdfNotice(err instanceof Error ? err.message : "PDF 등록 실패");
    } finally {
      setQuickPdfBusy(false);
      if (quickPdfInputRef.current) quickPdfInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">물건 목록</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => quickPdfInputRef.current?.click()}
            disabled={quickPdfBusy}
            className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
          >
            {quickPdfBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            PDF로 바로 등록
          </button>
          <input
            ref={quickPdfInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleQuickPdfRegister(e.target.files[0])}
          />
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
          >
            <Plus size={12} />
            물건 등록
          </button>
        </div>
      </div>

      {quickPdfNotice && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
          {quickPdfNotice}
        </div>
      )}

      {formOpen && (
        <div className="rounded-xl border border-amber-200 bg-white p-5 shadow-sm dark:bg-neutral-900 dark:border-amber-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">물건 등록</h2>
            <button onClick={() => setFormOpen(false)} className="text-neutral-400 hover:text-neutral-600">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">사건번호 *</label>
              <input
                type="text"
                value={form.case_number}
                onChange={(e) => setForm((f) => ({ ...f, case_number: e.target.value }))}
                placeholder="예: 2026타경1234"
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">주소 *</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="예: 서울 강남구 ..."
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">물건 유형</label>
              <input
                type="text"
                value={form.property_type}
                onChange={(e) => setForm((f) => ({ ...f, property_type: e.target.value }))}
                placeholder="예: 다가구"
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">입찰일</label>
              <input
                type="date"
                value={form.bid_date}
                onChange={(e) => setForm((f) => ({ ...f, bid_date: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">감정가 (원)</label>
              <input
                type="number"
                value={form.appraisal_price}
                onChange={(e) => setForm((f) => ({ ...f, appraisal_price: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">최저가 (원)</label>
              <input
                type="number"
                value={form.min_price}
                onChange={(e) => setForm((f) => ({ ...f, min_price: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1 flex items-center gap-1">
                <FileText size={11} /> PDF 원문 (선택)
              </label>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-neutral-500"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1 flex items-center gap-1">
                <ImageIcon size={11} /> 표지/썸네일 이미지 (선택)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-neutral-500"
              />
            </div>
          </div>
          {submitError && <p className="mt-3 text-xs text-rose-500">{submitError}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 text-sm text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              등록
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-neutral-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : cases.length === 0 ? (
        <div className="py-20 text-center text-neutral-400">
          <Gavel size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">등록된 물건이 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {cases.map((c) => (
            <Link
              key={c.id}
              href={`/auction/${c.id}`}
              className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="aspect-[16/10] bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center overflow-hidden">
                {c.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api"}${c.thumbnail_url}`}
                    alt={c.address}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon size={28} className="text-neutral-300 dark:text-neutral-600" />
                )}
              </div>
              <div className="p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    {STATUS_LABELS[c.status] ?? c.status}
                  </span>
                  <span className="text-[11px] text-neutral-400">{c.case_number}</span>
                </div>
                <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                  {c.list_title || c.address}
                </p>
                <p className="text-xs text-neutral-400">
                  감정가 {fmtWon(c.appraisal_price)} · 최저가 {fmtWon(c.min_price)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
