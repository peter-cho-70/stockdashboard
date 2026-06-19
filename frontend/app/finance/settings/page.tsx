'use client';

import { useState } from 'react';
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
  Settings as SettingsIcon
} from 'lucide-react';

export default function SettingsPage() {
  const ledgerStore = useLedgerStore();
  const financeStore = useFinanceStore();
  
  const { settings, addCategory, deleteCategory, addCardIssuer, deleteCardIssuer, addUser, deleteUser } = ledgerStore;
  
  const [newCategory, setNewCategory] = useState({ name: '', color: 'blue', sub: [] as string[] });
  const [newSubCategory, setNewSubCategory] = useState('');
  const [newCard, setNewCard] = useState('');
  const [newUser, setNewUser] = useState('');
  
  const [activeTab, setActiveTab] = useState<'categories' | 'cards' | 'users' | 'system'>('categories');

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
      alert('모든 데이터가 초기화되었습니다.');
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
          { id: 'system', label: '시스템 설정', icon: RefreshCw },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'categories' | 'cards' | 'users' | 'system')}
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

        {activeTab === 'system' && (
          <div className="p-12 text-center space-y-6">
            <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto text-rose-500">
              <AlertTriangle size={32} />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-gray-900">전체 데이터 초기화</h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto">
                가계부 내역, 예산, 자산, 부채 및 모든 사용자 정의 설정을 초기화합니다.<br />
                <span className="text-rose-600 font-semibold">이 작업은 되돌릴 수 없습니다.</span>
              </p>
            </div>
            <button 
              onClick={handleFullReset}
              className="px-8 py-3 bg-rose-600 text-white text-sm font-bold rounded-lg hover:bg-rose-700 transition-all shadow-lg shadow-rose-600/20 flex items-center gap-2 mx-auto"
            >
              <RefreshCw size={16} />
              시스템 전체 초기화 실행
            </button>
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