'use client';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import ReactCrop, { type Crop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { jsPDF } from 'jspdf';
import { dict } from '../../i18n/dictionaries';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cv: any;
  }
}

export default function PassportScanner() {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const t = dict[lang];

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [scanMode, setScanMode] = useState<'color' | 'bw'>('color');
  const [cvReady, setCvReady] = useState(false);
  const [cvProgress, setCvProgress] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasAutoCropped, setHasAutoCropped] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState<boolean>(false);

  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${time}] ${msg}`]);
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogs]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + H or Cmd + H to toggle logs
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setShowLogs(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load OpenCV dynamically
  useEffect(() => {
    if (document.getElementById('opencv-script')) {
      setCvReady(true);
      return;
    }

    addLog('System initializing: Preparing OpenCV Engine...');

    const script = document.createElement('script');
    script.id = 'opencv-script';
    
    // Instead of simply setting src, we will use XMLHttpRequest to track download progress.
    // Notice: Due to CORS, tracking progress requires the server to expose Content-Length.
    const xhr = new XMLHttpRequest();
    // Use the locally served OpenCV model to avoid Cloudflare 403 blocks or China CDN issues
    const url = '/models/opencv.js';
    xhr.open('GET', url, true);
    
    let lastLoggedProgress = 0;
    xhr.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setCvProgress(percentComplete);
        if (percentComplete >= lastLoggedProgress + 10 || percentComplete === 100) {
          addLog(`Downloading OpenCV.js... ${percentComplete}%`);
          lastLoggedProgress = percentComplete;
        }
      } else {
        // Fallback for CORS setups that don't expose Content-Length headers, simulate a slow moving load
        setCvProgress((prev) => {
          const next = prev < 90 ? prev + 5 : 90;
          if (next >= lastLoggedProgress + 10) {
            addLog(`Downloading OpenCV.js (Simulated)... ${next}%`);
            lastLoggedProgress = next;
          }
          return next;
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        setCvProgress(100);
        addLog('OpenCV Engine downloaded successfully. Injecting to memory...');
        script.textContent = xhr.responseText;
        document.body.appendChild(script);
        
        const checkCv = setInterval(() => {
          if (window.cv && window.cv.Mat) {
            clearInterval(checkCv);
            setCvReady(true);
            addLog('OpenCV Engine loaded and ready for document deskewing.');
          }
        }, 100);
      } else {
        addLog(`Error loading OpenCV: HTTP ${xhr.status}`);
      }
    };

    xhr.onerror = () => {
      addLog('Failed to fetch OpenCV.js Check network connection.');
    };

    xhr.send();
  }, []);

  // Update preview automatically whenever crop or mode changes
  useEffect(() => {
    if (!imageRef.current || !canvasRef.current || !crop || crop.width === 0 || crop.height === 0) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    const img = imageRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Calculate actual pixel dimensions relative to original image size
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    
    const sX = crop.x * scaleX;
    const sY = crop.y * scaleY;
    const sWidth = crop.width * scaleX;
    const sHeight = crop.height * scaleY;

    canvas.width = sWidth;
    canvas.height = sHeight;

    // Base filter for scan enhancements
    if (scanMode === 'bw') {
      ctx.filter = 'grayscale(100%) contrast(120%) brightness(110%)';
    } else {
      ctx.filter = 'none';
    }

    // Fill background with white in case of transparency
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sWidth, sHeight);
    
    try {
      ctx.drawImage(img, sX, sY, sWidth, sHeight, 0, 0, sWidth, sHeight);
      
      // OpenCV Wrinkle Removal & Illumination fix for B&W
      // This wipes out shadows and creases to create a perfectly flat document look
      if (scanMode === 'bw' && window.cv && window.cv.Mat) {
         ctx.filter = 'none'; // reset so next frames aren't double-filtered
         
         const src = window.cv.imread(canvas);
         const gray = new window.cv.Mat();
         window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
         const mask = new window.cv.Mat();
         
         // Adaptive threshold completely flattens shadows/wrinkles into a clean B&W scan
         window.cv.adaptiveThreshold(gray, mask, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY, 21, 15);
         
         window.cv.imshow(canvas, mask);
         src.delete(); gray.delete(); mask.delete();
      }
    } catch (e) {
      console.error(e);
    }
  }, [crop, scanMode, imageSrc]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsProcessing(true);
    const url = URL.createObjectURL(file);
    
    if (!window.cv || !window.cv.Mat) {
       setImageSrc(url);
       setCrop(undefined);
       setIsProcessing(false);
       return;
    }

    const img = new Image();
    img.onload = () => {
        try {
            const src = window.cv.imread(img);
            
            // Downscale for faster contour detection
            const maxDim = 800;
            let scale = 1;
            const procSrc = src.clone();
            if (src.cols > maxDim || src.rows > maxDim) {
                scale = Math.min(maxDim / src.cols, maxDim / src.rows);
                window.cv.resize(src, procSrc, new window.cv.Size(src.cols * scale, src.rows * scale), 0, 0, window.cv.INTER_AREA);
            }

            const gray = new window.cv.Mat();
            window.cv.cvtColor(procSrc, gray, window.cv.COLOR_RGBA2GRAY, 0);
            
            const blurred = new window.cv.Mat();
            window.cv.GaussianBlur(gray, blurred, new window.cv.Size(5, 5), 0, 0, window.cv.BORDER_DEFAULT);
            
            const edges = new window.cv.Mat();
            window.cv.Canny(blurred, edges, 75, 200);
            
            const contours = new window.cv.MatVector();
            const hierarchy = new window.cv.Mat();
            window.cv.findContours(edges, contours, hierarchy, window.cv.RETR_LIST, window.cv.CHAIN_APPROX_SIMPLE);
            
            let maxArea = 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let maxApprox: any = null;
            
            for (let i = 0; i < contours.size(); i++) {
                const cnt = contours.get(i);
                const area = window.cv.contourArea(cnt);
                if (area > 10000) {
                    const approx = new window.cv.Mat();
                    const epsilon = 0.02 * window.cv.arcLength(cnt, true);
                    window.cv.approxPolyDP(cnt, approx, epsilon, true);
                    if (approx.rows === 4 && area > maxArea) {
                        maxArea = area;
                        if (maxApprox) maxApprox.delete();
                        maxApprox = approx.clone();
                    }
                    approx.delete();
                }
            }
            
            const result = new window.cv.Mat();
            if (maxApprox) {
                const corners = [];
                for (let i=0; i<4; i++) {
                    corners.push({ 
                      x: maxApprox.data32S[i*2] / scale, 
                      y: maxApprox.data32S[i*2+1] / scale 
                    });
                }
                
                const sums = corners.map((p) => p.x + p.y);
                const diffs = corners.map((p) => p.x - p.y);
                const tl = corners[sums.indexOf(Math.min(...sums))];
                const br = corners[sums.indexOf(Math.max(...sums))];
                const tr = corners[diffs.indexOf(Math.max(...diffs))];
                const bl = corners[diffs.indexOf(Math.min(...diffs))];
                
                const width = Math.max(
                    Math.hypot(tr.x - tl.x, tr.y - tl.y),
                    Math.hypot(br.x - bl.x, br.y - bl.y)
                );
                const height = Math.max(
                    Math.hypot(tl.x - bl.x, tl.y - bl.y),
                    Math.hypot(tr.x - br.x, tr.y - br.y)
                );
                
                const srcTri = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [
                    tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y
                ]);
                const dstTri = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [
                    0, 0, width-1, 0, width-1, height-1, 0, height-1
                ]);
                
                const M = window.cv.getPerspectiveTransform(srcTri, dstTri);
                window.cv.warpPerspective(src, result, M, new window.cv.Size(width, height));
                
                srcTri.delete(); dstTri.delete(); M.delete();
                
                const outCanvas = document.createElement('canvas');
                window.cv.imshow(outCanvas, result);
                setImageSrc(outCanvas.toDataURL('image/jpeg', 0.95));
                setHasAutoCropped(true);
                
                // When we upload a new image, ReactCrop doesn't immediately fire an event to set our initial crop size.
                // It requires a manual init trick so that the preview panel displays the fully cropped bounding box immediately
                // without waiting for the user to touch the image first. 
                setTimeout(() => {
                    setCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
                }, 100);
            } else {
                setImageSrc(url);
                setCrop(undefined);
                setHasAutoCropped(false);
            }
            
            src.delete(); procSrc.delete(); gray.delete(); blurred.delete(); edges.delete();
            contours.delete(); hierarchy.delete(); if (maxApprox) maxApprox.delete(); result.delete();
        } catch (err) {
            console.error("CV Processing Error: ", err);
            setImageSrc(url);
            setCrop(undefined);
        } finally {
            setIsProcessing(false);
        }
    };
    img.src = url;
  };

  const generatePDF = () => {
    if (!canvasRef.current || !crop || crop.width === 0) return;
    const canvas = canvasRef.current;
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Auto-detect orientation (landscape if width > height)
    const orientation = width > height ? 'l' : 'p';
    
    // Initialize jsPDF matching the actual cropped size
    const pdf = new jsPDF({
      orientation: orientation,
      unit: 'px',
      format: [width, height],
    });
    
    pdf.addImage(imgData, 'JPEG', 0, 0, width, height);
    pdf.save(`passport-scan-${new Date().getTime()}.pdf`);
  };

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

      {!cvReady && (
        <div className="w-full max-w-4xl mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 flex flex-col items-center shadow-sm">
          <span className="font-semibold mb-2">
            {lang === 'zh' ? `正在下载 OpenCV 智能引擎组件 (${cvProgress}%)` : `Downloading OpenCV AI Engine (${cvProgress}%)`}
          </span>
          <div className="w-full bg-emerald-200 rounded-full h-2.5">
            <div className="bg-emerald-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${cvProgress}%` }}></div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-6 mb-4 bg-white p-4 rounded-lg shadow-sm border w-full max-w-4xl mt-4">
        <div className="flex items-center gap-2 relative">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">{t.pspUpload}:</label>
          <div className="relative">
            <input 
              type="file" 
              accept="image/*" 
              onChange={handleImageUpload} 
              disabled={(!cvReady && !isProcessing) || isProcessing}
              className="border p-1.5 rounded text-sm w-56 text-gray-600 disabled:opacity-50"
              title="Upload Image"
            />
            {(!cvReady || isProcessing) && (
              <div className="absolute inset-0 bg-white/80 flex items-center justify-center text-xs font-semibold text-emerald-600 rounded pointer-events-none">
                {isProcessing ? (lang === 'zh' ? '正在智能矫正...' : 'Auto Deskewing...') : (lang === 'zh' ? '加载AI引擎中...' : 'Loading Engine...')}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">{t.pspEnhance}:</label>
          <select 
            value={scanMode}
            onChange={(e) => setScanMode(e.target.value as 'color' | 'bw')}
            className="border p-1.5 rounded text-sm font-medium focus:ring-emerald-500 cursor-pointer min-w-[140px]"
            title="Select Scan Mode"
          >
            <option value="color">{t.pspModeColor}</option>
            <option value="bw">{t.pspModeScan}</option>
          </select>
        </div>

        <button 
          onClick={generatePDF} 
          disabled={!imageSrc || !crop || crop.width === 0}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded disabled:opacity-50 transition-colors font-semibold ml-auto flex items-center gap-2 shadow-sm"
        >
          📄 {t.pspGeneratePdf}
        </button>
      </div>

      {imageSrc ? (
        <div className="flex flex-col md:flex-row gap-8 items-start w-full max-w-5xl justify-center mt-4">
          {!hasAutoCropped && (
          <div className="flex flex-col items-center flex-1 w-full md:w-1/2">
            <h2 className="mb-3 font-semibold text-gray-700">{t.pspCrop}</h2>
            <div className="p-2 bg-white rounded-lg shadow-sm border w-full flex justify-center">
              <ReactCrop crop={crop} onChange={(c) => setCrop(c)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  ref={imageRef} 
                  src={imageSrc} 
                  alt="Passport Uploaded" 
                  className="max-h-[500px] w-auto rounded object-contain border border-gray-200"
                />
              </ReactCrop>
            </div>
            <p className="mt-4 text-xs text-emerald-700 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100 shadow-sm text-center">
              {lang === 'zh' ? '💡 提示：您可以拖拽框选清理边缘瑕疵' : '💡 Tip: You can crop to clean edges.'}
            </p>
          </div>
          )}

          {/* Render image exclusively for AutoCrop case */}
          {hasAutoCropped && (
            <div className="hidden">
              <ReactCrop crop={crop} onChange={(c) => setCrop(c)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  ref={imageRef} 
                  src={imageSrc} 
                  alt="Hidden AutoCrop Reference" 
                />
              </ReactCrop>
            </div>
          )}
          
          <div className="flex flex-col items-center flex-1 w-full md:w-1/2">
            <h2 className="mb-3 font-semibold text-gray-700">{t.pspPreview}</h2>
            <div className="p-4 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg w-full min-h-[400px] flex items-center justify-center relative overflow-hidden shadow-inner">
              <canvas 
                ref={canvasRef} 
                className={`max-w-[100%] max-h-[500px] shadow-lg bg-white object-contain border border-gray-300 ${(crop && crop.width > 0) ? 'block' : 'hidden'}`}
              />
              {(!crop || crop.width === 0) && (
                <span className="text-gray-400 absolute font-medium">
                  {lang === 'zh' ? '请在左侧框选文档区域以预览' : 'Make a selection on the left to preview'}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-4xl bg-white p-12 rounded-2xl shadow-sm border mt-4 flex flex-col items-center justify-center text-gray-400 border-dashed border-2">
          <div className="text-6xl mb-6 opacity-30 text-emerald-600">📸</div>
          <p className="font-medium text-lg text-gray-500">{lang === 'zh' ? '请先上传您的护照照片，自动矫正生成扫描件' : 'Upload passport photo to auto-deskew and scan'}</p>
        </div>
      )}

      {(process.env.NODE_ENV === 'development' || showLogs) && (
        <div className="w-full max-w-4xl mt-8 bg-gray-900 border border-gray-700 rounded-lg shadow-inner flex flex-col h-48">
          <div className="bg-gray-800 text-gray-300 text-xs font-semibold px-4 py-2 border-b border-gray-700 rounded-t-lg flex justify-between">
            <span>System execution logs (Passport Scanner)</span>
            <button onClick={() => setLogs([])} className="hover:text-white">Clear</button>
          </div>
          <div className="p-4 overflow-y-auto flex-1 font-mono text-sm text-emerald-400 space-y-1">
            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </main>
  );
}