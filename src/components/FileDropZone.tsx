import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Upload, FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react';
import { parseCSVText } from '../data/parseCSV';
import { parseExcelFile } from '../data/parseExcel';

const ACCEPT = {
  extensions: ['.csv', '.xlsx', '.xls'] as const,
  acceptAttr: '.csv,.xlsx,.xls',
};

function isAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPT.extensions.some((ext) => lower.endsWith(ext));
}

async function parseDroppedFile(file: File): Promise<Array<Record<string, any>>> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text = await file.text();
    return parseCSVText(text);
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseExcelFile(file);
  }
  throw new Error('仅支持 CSV、Excel（.xlsx / .xls）文件。');
}

export type FileDropZoneParsedPayload = {
  rows: Array<Record<string, any>>;
  fileName: string;
};

type FileDropZoneProps = {
  onDataParsed: (payload: FileDropZoneParsedPayload) => void;
  disabled?: boolean;
  className?: string;
};

export default function FileDropZone({
  onDataParsed,
  disabled = false,
  className = '',
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!isAcceptedExtension(file.name)) {
        setError('文件类型不支持，请上传 .csv、.xlsx 或 .xls 文件。');
        return;
      }
      setIsParsing(true);
      try {
        const rows = await parseDroppedFile(file);
        if (!rows || rows.length === 0) {
          setError('文件解析成功，但未发现有效数据行，请检查表头与内容。');
          return;
        }
        onDataParsed({ rows, fileName: file.name || '未命名文件' });
      } catch (e: unknown) {
        setError(
          e instanceof Error
            ? e.message
            : '文件解析失败，请检查文件是否损坏或格式是否正确。'
        );
      } finally {
        setIsParsing(false);
      }
    },
    [onDataParsed]
  );

  const onDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled || isParsing) return;
      dragDepth.current += 1;
      setIsDragging(true);
    },
    [disabled, isParsing]
  );

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setIsDragging(false);
      if (disabled || isParsing) return;
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      await processFile(file);
    },
    [disabled, isParsing, processFile]
  );

  const onInputChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await processFile(file);
      e.target.value = '';
    },
    [processFile]
  );

  const openPicker = () => {
    if (disabled || isParsing) return;
    inputRef.current?.click();
  };

  const busy = disabled || isParsing;

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.acceptAttr}
        className="hidden"
        disabled={busy}
        onChange={onInputChange}
      />

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        onClick={openPicker}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={[
          'premium-input relative flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-3 px-4 py-6 text-center transition-colors duration-200',
          busy ? 'cursor-not-allowed opacity-50' : 'hover:border-[#1a1a1a]/60',
          isDragging && !busy
            ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_0_2px_rgba(59,130,246,0.35)]'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isDragging && !busy && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-blue-500/15 backdrop-blur-[2px]">
            <span className="text-xs font-bold uppercase tracking-widest text-blue-800">
              松开鼠标以上传
            </span>
          </div>
        )}

        {isParsing ? (
          <Loader2 className="h-8 w-8 animate-spin text-[#1a1a1a]/50" strokeWidth={1.25} />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[rgba(26,26,26,0.15)] bg-white/80">
              <Upload className="h-6 w-6 text-[#1a1a1a]/70" strokeWidth={1.25} />
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/80">
              <FileSpreadsheet className="h-3.5 w-3.5" strokeWidth={1.5} />
              点击选择或拖拽文件
            </div>
            <p className="max-w-xs text-[10px] uppercase tracking-wider text-[#1a1a1a]/45">
              CSV / .xlsx / .xls
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
