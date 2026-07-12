'use client';

import { useState, useEffect } from 'react';
import { useLedgerStore } from '@/lib/finance/store/ledger-store';
import { useFinanceStore } from '@/lib/finance/store/finance-store';
import {
  Plus,
  Trash2,
  RefreshCw,
  CreditCard,
  Tag,
  Users,
  AlertTriangle,
  ChevronRight,
  Settings as SettingsIcon,
  Download,
  Upload,
  Link2,
  Unlink,
  Zap,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Landmark,
} from 'lucide-react';
import { api, OpenbankingAccount } from '@/lib/api';
import {
  exportAndDownloadFinanceBackup,
  formatBackupSummary,
  parseFinanceBackupFile,
} from '@/lib/finance/backup';

type ObStatus = {
  configured: boolean;
  connected: boolean;
  user_seq_no?: string;
  token_expires_at?: string;
  accounts: OpenbankingAccount[];
  account_count: number;
} | null;

export default function SettingsPage() {
  const ledgerStore = useLedgerStore();
  const financeStore = useFinanceStore();

  const { settings, addCategory, deleteCategory, addCardIssuer, deleteCardIssuer, addUser, deleteUser } = ledgerStore;

  const [newCategory, setNewCategory] = useState({ name: '', color: 'blue', sub: [] as string[] });
  const [newSubCategory, setNewSubCategory] = useState('');
  const [newCard, setNewCard] = useState('');
  const [newUser, setNewUser] = useState('');

  const [activeTab, setActiveTab] = useState<'categories' | 'cards' | 'users' | 'openbanking' | 'system'>('categories');
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null);
  const [lastRestoreSummary, setLastRestoreSummary] = useState<string | null>(null);

  // 오픈뱅킹 상태
  const [obStatus, setObStatus] = useState<ObStatus>(null);
  const [obBusy, setObBusy] = useState<'sync' | 'accounts' | 'disconnect' | null>(null);
  const [obMsg, setObMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // URL 파라미터로 오픈뱅킹 탭 자동 이동 + 결과 메시지 처리
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'openbanking') {
      setActiveTab('openbanking');
      if (params.get('ob_success')) {
        setObMsg({ type: 'success', text: '오픈뱅킹 연동이 완료되었습니다.' });
      }
      if (params.get('ob_error')) {
        setObMsg({ type: 'error', text: `연동 실패: ${params.get('ob_error')}` });
      }
    }
  }, []);

  // 오픈뱅킹 상태 조회
  useEffect(() => {
    if (activeTab === 'openbanking') {
      api.getOpenbankingStatus().then(setObStatus).catch(() => setObStatus(null));
    }
  }, [activeTab]);

  const handleObConnect = async () => {
    try {
      const { url } = await api.getOpenbankingAuthUrl();
      window.location.href = url;
    } catch (e) {
      setObMsg({ type: 'error', text: e instanceof Error ? e.message : '인증 URL 가져오기 실패' });
    }
  };

  const handleObSyncAccounts = async () => {
    setObBusy('accounts');
    setObMsg(null);
    try {
      const result = await api.getOpenbankingAccounts();
      const status = await api.getOpenbankingStatus();
      setObStatus(status);
      setObMsg({ type: 'success', text: `계좌 ${result.count}개 조회 완료` });
    } catch (e) {
      setObMsg({ type: 'error', text: e instanceof Error ? e.message : '계좌 조회 실패' });
    } finally {
      setObBusy(null);
    }
  };

  const handleObSync = async () => {
    setObBusy('sync');
    setObMsg(null);
    try {
      const result = await api.syncOpenbanking();
      await financeStore.load();
      const total = result.updated + result.added;
      setObMsg({ type: 'success', text: `잔액 동기화 완료 — 업데이트 ${result.updated}건, 신규 ${result.added}건${result.errors.length ? ` (오류 ${result.errors.length}건)` : ''}` });
      if (total > 0) {
        const status = await api.getOpenbankingStatus();
        setObStatus(status);
      }
    } catch (e) {
      setObMsg({ type: 'error', text: e instanceof Error ? e.message : '잔액 동기화 실패' });
    } finally {
      setObBusy(null);
    }
  };

  const handleObDisconnect = async () => {
    if (!confirm('오픈뱅킹 연결을 해제하시겠습니까?\n연동된 계좌 정보가 삭제됩니다.')) return;
    setObBusy('disconnect');
    try {
      await api.disconnectOpenbanking();
      const status = await api.getOpenbankingStatus();
      setObStatus(status);
      setObMsg({ type: 'success', text: '오픈뱅킹 연결이 해제되었습니다.' });
    } catch (e) {
      setObMsg({ type: 'error', text: e instanceof Error ? e.message : '연결 해제 실패' });
    } finally {
      setObBusy(null);
    }
  };

  const handleAddCategory = () => {
    if (!newCategory.name) return;
    addCategory({
      name: newCategory.name,
      color: newCategory.color,
      sub: newCategory.sub,
      incomeOk: false
    });
    setNewCategory({ name: '', color: 'blue', sub: [] });
  };

  const handleAddSub = () => {
    if (!newSubCategory) return;
    setNewCategory(prev => ({ ...prev, sub: [...prev.sub, newSubCategory] }));
    setNewSubCategory('');
  };

  const handleFullReset = async () => {
    if (confirm('정말로 모든 데이터를 초기화하시겠습니까?\n가계부 내역, 자산, 부채, 설정 정보가 모두 삭제됩니다.')) {
      await Promise.all([ledgerStore.resetData(), financeStore.resetData()]);
      setLastRestoreSummary(null);
      alert('모든 데이터가 초기화되었습니다.');
    }
  };

  const handleExportBackup = async () => {
    setBackupBusy('export');
    try {
      const backup = await exportAndDownloadFinanceBackup();
      setLastRestoreSummary(`백업 완료 (${backup.exportedAt.slice(0, 10)})`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '백업에 실패했습니다.');
    } finally {
      setBackupBusy(null);
    }
  };

  const handleImportBackup = async (file: File | null) => {
    if (!file) return;
    setBackupBusy('import');
    try {
      const payload = await parseFinanceBackupFile(file);
      const exportedAt =
        typeof payload.exportedAt === 'string' ? payload.exportedAt.slice(0, 10) : '알 수 없음';
      if (
        !confirm(
          `백업 파일(${exportedAt})로 현재 재정·가계부 데이터를 덮어씁니다.\n계속하시겠습니까?`,
        )
      ) {
        return;
      }
      const result = await api.restoreFinanceBackup(payload);
      await Promise.all([financeStore.load(), ledgerStore.load()]);
      const summary = formatBackupSummary(result.summary);
      setLastRestoreSummary(`복구 완료 — ${summary}`);
      alert(`복구가 완료되었습니다.\n${summary}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '복구에 실패했습니다.');
    } finally {
      setBackupBusy(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <SettingsIcon size={24} className="text-emerald-600" />
          설정 및 관리
        </h1>
        <p className="text-gray-500 mt-1">가계부 항목, 카드사, 사용자 등을 추가하고 데이터를 관리합니다.</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {[
          { id: 'categories', label: '항목 사용자 등록', icon: Tag },
          { id: 'cards', label: '카드사 관리', icon: CreditCard },
          { id: 'users', label: '사용자 관리', icon: Users },
          { id: 'openbanking', label: '오픈뱅킹 연동', icon: Landmark },
          { id: 'system', label: '시스템 설정', icon: RefreshCw },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'categories' | 'cards' | 'users' | 'openbanking' | 'system')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all ${
              activeTab === tab.id
                ? 'border-emerald-500 text-emerald-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {activeTab === 'categories' && (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Category List */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <span className="w-1.5 h-4 bg-emerald-500 rounded-full" />
                  현재 카테고리 목록
                </h3>
                <div className="grid grid-cols-1 gap-2 max-h-[500px] overflow-y-auto pr-2">
                  {settings.categories.map((cat) => (
                    <div key={cat.name} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 bg-gray-50 group hover:border-emerald-200 transition-all">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full bg-${cat.color}-500`} />
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{cat.name}</p>
                          <p className="text-xs text-gray-500">{cat.sub.join(', ') || '하위 항목 없음'}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteCategory(cat.name)}
                        className="p-1.5 text-gray-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add Category Form */}
              <div className="space-y-4 bg-gray-50 p-6 rounded-xl border border-dashed border-gray-300">
                <h3 className="text-sm font-bold text-gray-900">새 카테고리 등록</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">카테고리명</label>
                    <input 
                      type="text" 
                      value={newCategory.name}
                      onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                      placeholder="예: 식비, 교육..."
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">대표 색상</label>
                    <div className="flex gap-2 flex-wrap">
                      {['amber', 'blue', 'violet', 'rose', 'green', 'pink', 'yellow', 'slate', 'red', 'teal', 'indigo', 'emerald', 'gray'].map(color => (
                        <button
                          key={color}
                          onClick={() => setNewCategory({ ...newCategory, color })}
                          className={`w-6 h-6 rounded-full bg-${color}-500 ring-offset-2 transition-all ${newCategory.color === color ? 'ring-2 ring-gray-400 scale-110' : 'hover:scale-110'}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">하위 항목 추가</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={newSubCategory}
                        onChange={(e) => setNewSubCategory(e.target.value)}
                        placeholder="예: 외식, 배달..."
                        className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-md outline-none"
                      />
                      <button 
                        onClick={handleAddSub}
                        className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-all"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    {newCategory.sub.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {newCategory.sub.map((sub, i) => (
                          <span key={i} className="px-2 py-1 bg-white border border-gray-200 text-[11px] font-medium rounded text-gray-600 flex items-center gap-1">
                            {sub}
                            <button onClick={() => setNewCategory({ ...newCategory, sub: newCategory.sub.filter((_, idx) => idx !== i) })}>
                              <Trash2 size={10} className="hover:text-rose-500" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={handleAddCategory}
                    disabled={!newCategory.name}
                    className="w-full py-2.5 bg-emerald-600 text-white rounded-md text-sm font-bold hover:bg-emerald-700 transition-all disabled:opacity-50"
                  >
                    카테고리 추가하기
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cards' && (
          <div className="p-6 max-w-2xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">카드사 목록</h3>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={newCard}
                  onChange={(e) => setNewCard(e.target.value)}
                  placeholder="새 카드사 입력..."
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                <button 
                  onClick={() => { if(newCard) { addCardIssuer(newCard); setNewCard(''); } }}
                  className="px-3 py-1.5 bg-emerald-600 text-white text-sm font-bold rounded-md hover:bg-emerald-700 transition-all"
                >
                  추가
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {settings.cardIssuers.map(card => (
                <div key={card} className="flex items-center justify-between px-4 py-3 border border-gray-100 bg-gray-50 rounded-lg group">
                  <span className="text-sm font-medium text-gray-700">{card}</span>
                  <button 
                    onClick={() => deleteCardIssuer(card)}
                    className="text-gray-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="p-6 max-w-2xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">사용자 목록</h3>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={newUser}
                  onChange={(e) => setNewUser(e.target.value)}
                  placeholder="새 사용자 입력..."
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                <button 
                  onClick={() => { if(newUser) { addUser(newUser); setNewUser(''); } }}
                  className="px-3 py-1.5 bg-emerald-600 text-white text-sm font-bold rounded-md hover:bg-emerald-700 transition-all"
                >
                  추가
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {settings.users?.map(user => (
                <div key={user} className="flex items-center justify-between px-4 py-3 border border-gray-100 bg-gray-50 rounded-lg group">
                  <span className="text-sm font-medium text-gray-700">{user}</span>
                  <button 
                    onClick={() => deleteUser(user)}
                    className="text-gray-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'openbanking' && (
          <div className="p-6 space-y-6">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Landmark size={18} className="text-emerald-600" />
                금융결제원 오픈뱅킹 연동
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                오픈뱅킹을 통해 국내 대부분 은행의 잔액을 자동으로 가져옵니다.
                연동 후 매일 16:10에 자동 갱신됩니다.
              </p>
            </div>

            {/* 메시지 */}
            {obMsg && (
              <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
                obMsg.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-rose-50 border border-rose-200 text-rose-700'
              }`}>
                {obMsg.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                {obMsg.text}
              </div>
            )}

            {/* 설정 안내 */}
            {obStatus && !obStatus.configured && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3">
                <p className="text-sm font-semibold text-amber-800">API 키 미설정</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  백엔드 환경변수에 아래 3가지를 설정하세요:
                </p>
                <div className="bg-white rounded-lg border border-amber-200 px-4 py-3 font-mono text-xs text-gray-700 space-y-1">
                  <p>OPENBANKING_CLIENT_ID=<span className="text-gray-400">your_client_id</span></p>
                  <p>OPENBANKING_CLIENT_SECRET=<span className="text-gray-400">your_client_secret</span></p>
                  <p>OPENBANKING_USE_CD=<span className="text-gray-400">your_use_cd</span></p>
                </div>
                <a
                  href="https://openbanking.or.kr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-amber-700 underline"
                >
                  <ExternalLink size={12} />
                  금융결제원 오픈뱅킹 신청하기
                </a>
              </div>
            )}

            {/* 연결 상태 */}
            {obStatus && obStatus.configured && (
              <div className="space-y-4">
                <div className={`rounded-xl border p-5 flex items-center justify-between ${
                  obStatus.connected
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-gray-200 bg-gray-50'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${obStatus.connected ? 'bg-emerald-100' : 'bg-gray-200'}`}>
                      <Link2 size={18} className={obStatus.connected ? 'text-emerald-600' : 'text-gray-400'} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {obStatus.connected ? '연동됨' : '미연동'}
                      </p>
                      {obStatus.connected && (
                        <p className="text-xs text-gray-500">
                          연결 계좌 {obStatus.account_count}개
                          {obStatus.token_expires_at && ` · 만료 ${new Date(obStatus.token_expires_at).toLocaleDateString('ko-KR')}`}
                        </p>
                      )}
                    </div>
                  </div>
                  {!obStatus.connected ? (
                    <button
                      onClick={handleObConnect}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 transition-all"
                    >
                      <Link2 size={15} />
                      오픈뱅킹 연결
                    </button>
                  ) : (
                    <button
                      onClick={handleObDisconnect}
                      disabled={obBusy === 'disconnect'}
                      className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-all disabled:opacity-50"
                    >
                      <Unlink size={13} />
                      {obBusy === 'disconnect' ? '해제 중…' : '연결 해제'}
                    </button>
                  )}
                </div>

                {/* 연결된 경우: 계좌 목록 + 동기화 */}
                {obStatus.connected && (
                  <>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleObSyncAccounts}
                        disabled={obBusy !== null}
                        className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 bg-white text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-all disabled:opacity-50"
                      >
                        <RefreshCw size={13} className={obBusy === 'accounts' ? 'animate-spin' : ''} />
                        {obBusy === 'accounts' ? '계좌 조회 중…' : '계좌 목록 새로고침'}
                      </button>
                      <button
                        onClick={handleObSync}
                        disabled={obBusy !== null}
                        className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-all disabled:opacity-50"
                      >
                        <Zap size={13} className={obBusy === 'sync' ? 'animate-pulse' : ''} />
                        {obBusy === 'sync' ? '잔액 동기화 중…' : '지금 잔액 동기화'}
                      </button>
                    </div>

                    {obStatus.accounts.length > 0 && (
                      <div className="rounded-xl border border-gray-200 overflow-hidden">
                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                          <p className="text-xs font-semibold text-gray-700">연결된 계좌 ({obStatus.accounts.length}개)</p>
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-gray-500 text-xs font-medium border-b border-gray-100">
                              <th className="px-4 py-2.5 text-left">은행</th>
                              <th className="px-4 py-2.5 text-left">계좌번호</th>
                              <th className="px-4 py-2.5 text-left">예금주</th>
                              <th className="px-4 py-2.5 text-center">잔액조회 동의</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {obStatus.accounts.map((acct) => (
                              <tr key={acct.fintech_use_num} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-gray-800 font-medium">{acct.bank_name}</td>
                                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{acct.account_num_masked}</td>
                                <td className="px-4 py-3 text-gray-600 text-xs">{acct.account_holder_name}</td>
                                <td className="px-4 py-3 text-center">
                                  {acct.inquiry_agree_yn === 'Y' ? (
                                    <CheckCircle2 size={14} className="text-emerald-500 mx-auto" />
                                  ) : (
                                    <XCircle size={14} className="text-rose-400 mx-auto" />
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* 브로커 예수금 설명 */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-5 space-y-2">
              <p className="text-sm font-semibold text-indigo-800 flex items-center gap-2">
                <Zap size={14} />
                증권사 예수금 자동 동기화
              </p>
              <p className="text-xs text-indigo-700 leading-relaxed">
                환경변수에 <strong>KIS_APP_KEY / KIS_ACCOUNTS</strong> 또는{' '}
                <strong>KIWOOM_APP_KEY / KIWOOM_ACCOUNTS</strong>가 설정된 경우,
                자산 페이지 접근 시 예수금이 자동으로 동기화됩니다.
                매일 16:10에도 자동 갱신됩니다.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="p-8 space-y-10">
            <section className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">JSON 백업 · 복구</h3>
                <p className="text-sm text-gray-500 mt-1">
                  FinanceHub 형식 JSON으로 재정·가계부 데이터를 내보내거나 복구합니다.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-5 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                    <Download size={16} />
                    백업 다운로드
                  </div>
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    현재 DB에 저장된 자산, 부채, 가계부, 설정을 JSON 파일로 저장합니다.
                  </p>
                  <button
                    onClick={handleExportBackup}
                    disabled={backupBusy !== null}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 transition-all disabled:opacity-50"
                  >
                    <Download size={16} />
                    {backupBusy === 'export' ? '백업 중…' : 'JSON 백업 받기'}
                  </button>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-5 space-y-3">
                  <div className="flex items-center gap-2 text-blue-800 font-semibold text-sm">
                    <Upload size={16} />
                    백업 복구
                  </div>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    이전에 내보낸 `financehub-backup-*.json` 파일을 선택하면 현재 데이터를 덮어씁니다.
                  </p>
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-all cursor-pointer disabled:opacity-50">
                    <Upload size={16} />
                    {backupBusy === 'import' ? '복구 중…' : 'JSON 파일 선택'}
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      disabled={backupBusy !== null}
                      onChange={(e) => {
                        void handleImportBackup(e.target.files?.[0] ?? null);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>
              {lastRestoreSummary && (
                <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  {lastRestoreSummary}
                </p>
              )}
            </section>

            <section className="border-t border-gray-200 pt-8 text-center space-y-6">
              <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto text-rose-500">
                <AlertTriangle size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-gray-900">전체 데이터 초기화</h3>
                <p className="text-sm text-gray-500 max-w-md mx-auto">
                  가계부 내역, 예산, 자산, 부채 및 모든 사용자 정의 설정을 초기화합니다.<br />
                  <span className="text-rose-600 font-semibold">복구 전 JSON 백업을 권장합니다.</span>
                </p>
              </div>
              <button 
                onClick={handleFullReset}
                disabled={backupBusy !== null}
                className="px-8 py-3 bg-rose-600 text-white text-sm font-bold rounded-lg hover:bg-rose-700 transition-all shadow-lg shadow-rose-600/20 flex items-center gap-2 mx-auto disabled:opacity-50"
              >
                <RefreshCw size={16} />
                시스템 전체 초기화 실행
              </button>
            </section>
          </div>
        )}
      </div>

      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-6 flex items-start gap-4">
        <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600">
          <ChevronRight size={20} />
        </div>
        <div>
          <h4 className="text-sm font-bold text-emerald-900">사용자 정의 팁</h4>
          <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
            자주 사용하는 카테고리와 카드사를 미리 등록해두면 가계부 입력 시 시간을 단축할 수 있습니다.<br />
            사용자(가족 구성원 등)를 등록하여 지출 내역을 분리할 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
}