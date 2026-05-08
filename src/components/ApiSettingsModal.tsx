import { useEffect, useState } from 'react';
import type { DeepseekModel } from '../api/deepseekGenerate';
import { Save, X } from 'lucide-react';

export default function ApiSettingsModal({
  open,
  onClose,
  apiKey,
  setApiKey,
  model,
  setModel,
  ecnuApiKey,
  setEcnuApiKey,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  model: DeepseekModel;
  setModel: (v: DeepseekModel) => void;
  ecnuApiKey: string;
  setEcnuApiKey: (v: string) => void;
  onSave: () => void;
}) {
  const [localKey, setLocalKey] = useState(apiKey);
  const [localEcnuKey, setLocalEcnuKey] = useState(ecnuApiKey);
  const [localModel, setLocalModel] = useState<DeepseekModel>(model);

  useEffect(() => {
    setLocalKey(apiKey);
    setLocalEcnuKey(ecnuApiKey);
    setLocalModel(model);
  }, [apiKey, ecnuApiKey, model, open]);

  if (!open) return null;

  const close = () => {
    onClose();
  };

  const save = () => {
    setApiKey(localKey);
    setEcnuApiKey(localEcnuKey);
    setModel(localModel);
    onSave();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={close}
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-xl bg-[#f5f2ed] rounded-3xl border border-[rgba(26,26,26,0.12)] shadow-2xl overflow-hidden">
          <div className="p-6 bg-white border-b border-[rgba(26,26,26,0.1)] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-black/5 flex items-center justify-center">
                <Save size={18} />
              </div>
              <div>
                <div className="text-sm font-bold uppercase tracking-widest">API 设置</div>
                <div className="text-[10px] text-[#1a1a1a]/60 mt-1">
                  DeepSeek 经本地代理；ECNU 经 /api/ecnu/chat 转发
                </div>
              </div>
            </div>
            <button
              onClick={close}
              className="p-2 hover:bg-black/5 rounded-full transition-colors"
              title="关闭"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/70">
                ECNU API Key（图表「数据概览」用，可选）
              </label>
              <input
                type="password"
                value={localEcnuKey}
                onChange={(e) => setLocalEcnuKey(e.target.value)}
                className="premium-input w-full p-3 text-sm"
                placeholder="填写后：数据概览走 ecnu-plus，三套方案仍走 DeepSeek"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/70">
                DeepSeek API Key（可选）
              </label>
              <input
                type="password"
                value={localKey}
                onChange={(e) => setLocalKey(e.target.value)}
                className="premium-input w-full p-3 text-sm"
                placeholder="输入 DeepSeek API Key（留空则使用后端默认 Key）"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/70">
                使用的模型
              </label>
              <select
                value={localModel}
                onChange={(e) => setLocalModel(e.target.value as DeepseekModel)}
                className="premium-input w-full p-3 text-sm"
              >
                <option value="deepseek-chat">deepseek-chat</option>
                <option value="deepseek-reasoner">deepseek-reasoner</option>
              </select>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={close}
                className="premium-button px-4 py-3 text-sm font-bold uppercase tracking-widest flex-1"
                style={{ background: 'rgba(26,26,26,0.05)' }}
              >
                取消
              </button>
              <button
                onClick={save}
                className="premium-button px-4 py-3 text-sm font-bold uppercase tracking-widest flex-1"
              >
                保存
              </button>
            </div>

            <div className="text-[10px] text-[#1a1a1a]/60">
              密钥保存于本机 localStorage；请勿将密钥提交到代码仓库。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

