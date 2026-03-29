'use client';
import Link from 'next/link';
import { useState } from 'react';
import { dict } from '../../i18n/dictionaries';

export default function PassportScanner() {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const t = dict[lang];

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-gray-50/50">
      <div className="flex w-full max-w-4xl justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-emerald-600 font-medium px-3 py-1.5 bg-white border rounded shadow-sm flex items-center gap-2 transition-colors">
            ← {lang === 'zh' ? '返回主页' : 'Back'}
          </Link>
          <h1 className="text-3xl font-bold">{t.passportTitle}</h1>
        </div>
        <select 
          value={lang} 
          onChange={(e) => setLang(e.target.value as 'en' | 'zh')}
          className="border p-2 rounded bg-white shadow-sm font-medium"
          title="Select Language"
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>

      <div className="w-full max-w-4xl bg-white p-8 rounded-2xl shadow-sm border mt-8 flex flex-col items-center justify-center min-h-[400px]">
        <div className="text-6xl mb-4">🛂</div>
        <h2 className="text-2xl font-semibold mb-4 text-gray-800">{lang === 'zh' ? '功能开发中...' : 'Feature under development...'}</h2>
        <p className="text-gray-500 max-w-lg text-center">
          {lang === 'zh' 
            ? '这里将提供手机拍摄护照图片的裁剪、校正、增强以及导出生成扫描件 PDF 的功能。' 
            : 'Here we will provide tools to crop, deskew, enhance, and export mobile passport photos as scanned PDF documents.'}
        </p>
      </div>
    </main>
  );
}