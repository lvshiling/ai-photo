'use client';
/* eslint-disable */
import Link from 'next/link';
import Script from 'next/script';
import { useState, useRef, useEffect, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { dict } from '../../i18n/dictionaries';

declare global {
  interface Window {
    cv: any;
    ort: any;
  }
}

export interface ScanDocument {
  id: string;
  originalUrl: string;
  anchorPoints: {x: number, y: number}[] | null;
  dims: {w: number, h: number} | null;
  hasAutoCropped: boolean;
  previewUrl: string | null;
  previewDims: {w: number, h: number} | null;
}

export default function PassportScanner() {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const t = dict[lang];

  const [docs, setDocs] = useState<ScanDocument[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const activeDoc = docs[activeIdx] || null;

  const [draggingPoint, setDraggingPoint] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  
  const [scanMode, setScanMode] = useState<'color' | 'bw'>('color');
  const [useOnnx, setUseOnnx] = useState(false);
  const [onnxReady, setOnnxReady] = useState(false);
  const [cvReady, setCvReady] = useState(false);
  const [cvProgress, setCvProgress] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setShowLogs(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (document.getElementById('opencv-script')) {
      setCvReady(true);
      return;
    }
    addLog('System initializing: Preparing OpenCV Engine...');
    const script = document.createElement('script');
    script.id = 'opencv-script';
    
    const xhr = new XMLHttpRequest();
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
    xhr.onerror = () => addLog('Failed to fetch OpenCV.js Check network connection.');
    xhr.send();
  }, []);

  const setAnchorPoints = (points: {x:number, y:number}[]) => {
     if (activeIdx < 0) return;
     setDocs(prev => {
        const next = [...prev];
        next[activeIdx] = { ...next[activeIdx], anchorPoints: points };
        return next;
     });
  };

  const updatePreviewCanvas = useCallback(() => {
    if (!window.cv || !activeDoc?.anchorPoints || !imageRef.current || !canvasRef.current) return;
    const img = imageRef.current;
    if (!img.naturalWidth) return;
    const anchorPoints = activeDoc.anchorPoints;

    try {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.naturalWidth;
        tempCanvas.height = img.naturalHeight;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
        const src = window.cv.imread(tempCanvas);

        let finalExtractedWidth = 0;
        let finalExtractedHeight = 0;

        if (anchorPoints.length === 6) {
            const [tl, tr, rm, br, bl, lm] = anchorPoints;
            const topWidth = Math.max(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(rm.x - lm.x, rm.y - lm.y));
            const topHeight = Math.max(Math.hypot(tl.x - lm.x, tl.y - lm.y), Math.hypot(tr.x - rm.x, tr.y - rm.y));
            const botWidth = Math.max(Math.hypot(rm.x - lm.x, rm.y - lm.y), Math.hypot(br.x - bl.x, br.y - bl.y));
            const botHeight = Math.max(Math.hypot(lm.x - bl.x, lm.y - bl.y), Math.hypot(rm.x - br.x, rm.y - br.y));

            const finalWidth = Math.round(Math.max(topWidth, botWidth));
            const th = Math.round(topHeight);
            const bh = Math.round(botHeight);
            const finalHeight = th + bh;

            if (finalWidth <= 0 || finalHeight <= 0) { src.delete(); return; }

            const result = new window.cv.Mat.zeros(finalHeight, finalWidth, src.type());

            const srcTriTop = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, rm.x, rm.y, lm.x, lm.y]);
            const dstTriTop = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [0, 0, finalWidth-1, 0, finalWidth-1, th-1, 0, th-1]);
            const mTop = window.cv.getPerspectiveTransform(srcTriTop, dstTriTop);
            const topWarped = new window.cv.Mat();
            window.cv.warpPerspective(src, topWarped, mTop, new window.cv.Size(finalWidth, th));

            const srcTriBot = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [lm.x, lm.y, rm.x, rm.y, br.x, br.y, bl.x, bl.y]);
            const dstTriBot = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [0, 0, finalWidth-1, 0, finalWidth-1, bh-1, 0, bh-1]);
            const mBot = window.cv.getPerspectiveTransform(srcTriBot, dstTriBot);
            const botWarped = new window.cv.Mat();
            window.cv.warpPerspective(src, botWarped, mBot, new window.cv.Size(finalWidth, bh));

            const roiTopMat = result.roi(new window.cv.Rect(0, 0, finalWidth, th));
            topWarped.copyTo(roiTopMat);
            roiTopMat.delete(); topWarped.delete(); mTop.delete(); srcTriTop.delete(); dstTriTop.delete();

            const roiBotMat = result.roi(new window.cv.Rect(0, th, finalWidth, bh));
            botWarped.copyTo(roiBotMat);
            roiBotMat.delete(); botWarped.delete(); mBot.delete(); srcTriBot.delete(); dstTriBot.delete();

            if (scanMode === 'bw') {
                window.cv.cvtColor(result, result, window.cv.COLOR_RGBA2GRAY, 0);
                window.cv.adaptiveThreshold(result, result, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY, 21, 15);
            }
            
            finalExtractedWidth = finalWidth;
            finalExtractedHeight = finalHeight;
            window.cv.imshow(canvasRef.current, result);
            src.delete(); result.delete();
        } else {
            const [tl, tr, br, bl] = anchorPoints;
            const width = Math.max(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(br.x - bl.x, br.y - bl.y));
            const height = Math.max(Math.hypot(tl.x - bl.x, tl.y - bl.y), Math.hypot(tr.x - br.x, tr.y - br.y));
            const finalWidth = Math.round(width);
            const finalHeight = Math.round(height);
            if (finalWidth <= 0 || finalHeight <= 0) { src.delete(); return; }

            const result = new window.cv.Mat();
            const srcTri = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
            const dstTri = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [0, 0, finalWidth-1, 0, finalWidth-1, finalHeight-1, 0, finalHeight-1]);
            const M = window.cv.getPerspectiveTransform(srcTri, dstTri);
            window.cv.warpPerspective(src, result, M, new window.cv.Size(finalWidth, finalHeight));

            if (scanMode === 'bw') {
                window.cv.cvtColor(result, result, window.cv.COLOR_RGBA2GRAY, 0);
                window.cv.adaptiveThreshold(result, result, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY, 21, 15);
            }
            
            finalExtractedWidth = finalWidth;
            finalExtractedHeight = finalHeight;
            window.cv.imshow(canvasRef.current, result);
            src.delete(); result.delete(); srcTri.delete(); dstTri.delete(); M.delete();
        }

        const previewDataUrl = canvasRef.current.toDataURL('image/jpeg', 0.95);
        setDocs(prev => {
            const next = [...prev];
            if (next[activeIdx]) {
                next[activeIdx] = { 
                    ...next[activeIdx], 
                    previewUrl: previewDataUrl, 
                    previewDims: { w: finalExtractedWidth, h: finalExtractedHeight } 
                };
            }
            return next;
        });

    } catch (err) {
        console.error("Preview Update Error:", err);
    }
  }, [activeDoc?.anchorPoints, scanMode, activeIdx]);

  useEffect(() => {
    if (activeDoc?.anchorPoints && draggingPoint === null) {
        updatePreviewCanvas();
    }
  }, [activeDoc?.anchorPoints, draggingPoint, updatePreviewCanvas]);

  const handlePointerDown = (idx: number, e: React.PointerEvent<SVGCircleElement>) => {
    setDraggingPoint(idx);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingPoint === null || !svgRef.current || !activeDoc?.anchorPoints || !activeDoc?.dims) return;
    const rect = svgRef.current.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    
    const x = Math.max(0, Math.min((rawX / rect.width) * activeDoc.dims.w, activeDoc.dims.w));
    const y = Math.max(0, Math.min((rawY / rect.height) * activeDoc.dims.h, activeDoc.dims.h));
    
    const newPoints = [...activeDoc.anchorPoints];
    newPoints[draggingPoint] = {x, y};
    setAnchorPoints(newPoints);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement> | React.PointerEvent<SVGCircleElement>) => {
    if (draggingPoint !== null) {
        if ('releasePointerCapture' in e.currentTarget && e.pointerId) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setDraggingPoint(null);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsProcessing(true);
    let newDocs: ScanDocument[] = [];
    const startIndex = docs.length;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const url = URL.createObjectURL(file);
        const id = Date.now().toString() + "_" + i + "_" + Math.random().toString();

        if (!window.cv || !window.cv.Mat) {
            newDocs.push({ id, originalUrl: url, anchorPoints: null, dims: null, hasAutoCropped: false, previewUrl: null, previewDims: null });
            continue;
        }

        await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = async () => {
                let currentDoc: ScanDocument = { id, originalUrl: url, anchorPoints: null, dims: {w: img.naturalWidth, h: img.naturalHeight}, hasAutoCropped: false, previewUrl: null, previewDims: null };
                try {
                    const src = window.cv.imread(img);
                    let maxApproxCorners: any = null;
                    let fallbackBoundingRect: any = null;

                    const maxDim = 800;
                    let scale = 1;
                    const procSrc = src.clone();
                    if (src.cols > maxDim || src.rows > maxDim) {
                        scale = Math.min(maxDim / src.cols, maxDim / src.rows);
                        window.cv.resize(src, procSrc, new window.cv.Size(src.cols * scale, src.rows * scale), 0, 0, window.cv.INTER_AREA);
                    }

                    // @ts-ignore
                    const jscanifyModule = await import('jscanify/client');
                    const JScanify = jscanifyModule.default || jscanifyModule;
                    const scanner = new JScanify();
                    addLog(`Processing ${file.name}...`);
                    
                    const paperContour = scanner.findPaperContour(procSrc);
                    if (paperContour && window.cv.contourArea(paperContour) > 10000) {
                        let bestCorners = null;
                        for (let ep = 0.01; ep <= 0.06; ep += 0.01) {
                            const approx = new window.cv.Mat();
                            const epsilon = ep * window.cv.arcLength(paperContour, true);
                            window.cv.approxPolyDP(paperContour, approx, epsilon, true);
                            if (approx.rows === 4) {
                                const temp = [];
                                for(let j=0; j<4; j++) temp.push({x: approx.data32S[j*2], y: approx.data32S[j*2+1]});
                                const sums = temp.map(p => p.x + p.y);
                                const diffs = temp.map(p => p.x - p.y);
                                bestCorners = {
                                    topLeftCorner: temp[sums.indexOf(Math.min(...sums))],
                                    bottomRightCorner: temp[sums.indexOf(Math.max(...sums))],
                                    topRightCorner: temp[diffs.indexOf(Math.max(...diffs))],
                                    bottomLeftCorner: temp[diffs.indexOf(Math.min(...diffs))]
                                };
                                approx.delete();
                                break;
                            }
                            approx.delete();
                        }
                        if (!bestCorners) bestCorners = scanner.getCornerPoints(paperContour);
                        
                        if (bestCorners && bestCorners.topLeftCorner) {
                            const tl = bestCorners.topLeftCorner; const tr = bestCorners.topRightCorner;
                            const br = bestCorners.bottomRightCorner; const bl = bestCorners.bottomLeftCorner;
                            const cx = (tl.x + tr.x + br.x + bl.x) / 4; const cy = (tl.y + tr.y + br.y + bl.y) / 4;
                            const shrink = 0.975;
                            const insetPoint = (p: any) => ({ x: Math.round(cx + (p.x - cx) * shrink), y: Math.round(cy + (p.y - cy) * shrink) });
                            const iTl = insetPoint(tl); const iTr = insetPoint(tr); const iBr = insetPoint(br); const iBl = insetPoint(bl);

                            maxApproxCorners = [
                                { x: Math.round(iTl.x / scale), y: Math.round(iTl.y / scale) },
                                { x: Math.round(iTr.x / scale), y: Math.round(iTr.y / scale) },
                                { x: Math.round(iBr.x / scale), y: Math.round(iBr.y / scale) },
                                { x: Math.round(iBl.x / scale), y: Math.round(iBl.y / scale) }
                            ];
                        }
                        fallbackBoundingRect = window.cv.boundingRect(paperContour);
                    }

                    if (maxApproxCorners) {
                        const tl = maxApproxCorners[0]; const tr = maxApproxCorners[1];
                        const br = maxApproxCorners[2]; const bl = maxApproxCorners[3];
                        const rm = { x: Math.round((tr.x + br.x) / 2), y: Math.round((tr.y + br.y) / 2) };
                        const lm = { x: Math.round((tl.x + bl.x) / 2), y: Math.round((tl.y + bl.y) / 2) };
                        
                        currentDoc.anchorPoints = [{...tl}, {...tr}, {...rm}, {...br}, {...bl}, {...lm}];
                        currentDoc.hasAutoCropped = true;
                    } else {
                        currentDoc.hasAutoCropped = false;
                        if (fallbackBoundingRect) {
                            const fx = Math.round(fallbackBoundingRect.x / scale); const fy = Math.round(fallbackBoundingRect.y / scale);
                            const fw = Math.round(fallbackBoundingRect.width / scale); const fh = Math.round(fallbackBoundingRect.height / scale);
                            currentDoc.anchorPoints = [ { x: fx, y: fy }, { x: fx + fw, y: fy }, { x: fx + fw, y: fy + fh / 2 }, { x: fx + fw, y: fy + fh }, { x: fx, y: fy + fh }, { x: fx, y: fy + fh / 2 } ];
                        } else {
                            const iw = img.naturalWidth; const ih = img.naturalHeight;
                            currentDoc.anchorPoints = [ { x: iw * 0.1, y: ih * 0.1 }, { x: iw * 0.9, y: ih * 0.1 }, { x: iw * 0.9, y: ih * 0.5 }, { x: iw * 0.9, y: ih * 0.9 }, { x: iw * 0.1, y: ih * 0.9 }, { x: iw * 0.1, y: ih * 0.5 } ];
                        }
                    }
                    
                    if (currentDoc.anchorPoints && currentDoc.anchorPoints.length === 6) {
                        const tempCanvas = document.createElement('canvas'); tempCanvas.width = img.naturalWidth; tempCanvas.height = img.naturalHeight;
                        const tempCtx = tempCanvas.getContext('2d')!; tempCtx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
                        const rawSrc = window.cv.imread(tempCanvas);
                        const [tl, tr, rm, br, bl, lm] = currentDoc.anchorPoints;
                        const topWidth = Math.max(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(rm.x - lm.x, rm.y - lm.y));
                        const topHeight = Math.max(Math.hypot(tl.x - lm.x, tl.y - lm.y), Math.hypot(tr.x - rm.x, tr.y - rm.y));
                        const botWidth = Math.max(Math.hypot(rm.x - lm.x, rm.y - lm.y), Math.hypot(br.x - bl.x, br.y - bl.y));
                        const botHeight = Math.max(Math.hypot(lm.x - bl.x, lm.y - bl.y), Math.hypot(rm.x - br.x, rm.y - br.y));
                        const finalWidth = Math.round(Math.max(topWidth, botWidth));
                        const th = Math.round(topHeight); const bh = Math.round(botHeight); const finalHeight = th + bh;

                        const result = new window.cv.Mat.zeros(finalHeight, finalWidth, rawSrc.type());
                        const srcTriTop = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, rm.x, rm.y, lm.x, lm.y]);
                        const dstTriTop = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [0, 0, finalWidth-1, 0, finalWidth-1, th-1, 0, th-1]);
                        const mTop = window.cv.getPerspectiveTransform(srcTriTop, dstTriTop);
                        const topWarped = new window.cv.Mat();
                        window.cv.warpPerspective(rawSrc, topWarped, mTop, new window.cv.Size(finalWidth, th));
                        
                        const srcTriBot = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [lm.x, lm.y, rm.x, rm.y, br.x, br.y, bl.x, bl.y]);
                        const dstTriBot = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [0, 0, finalWidth-1, 0, finalWidth-1, bh-1, 0, bh-1]);
                        const mBot = window.cv.getPerspectiveTransform(srcTriBot, dstTriBot);
                        const botWarped = new window.cv.Mat();
                        window.cv.warpPerspective(rawSrc, botWarped, mBot, new window.cv.Size(finalWidth, bh));

                        const roiTopMat = result.roi(new window.cv.Rect(0, 0, finalWidth, th)); topWarped.copyTo(roiTopMat);
                        const roiBotMat = result.roi(new window.cv.Rect(0, th, finalWidth, bh)); botWarped.copyTo(roiBotMat);
                        
                        const outCanvas = document.createElement('canvas');
                        window.cv.imshow(outCanvas, result);
                        currentDoc.previewUrl = outCanvas.toDataURL('image/jpeg', 0.8);
                        currentDoc.previewDims = { w: finalWidth, h: finalHeight };

                        roiTopMat.delete(); topWarped.delete(); mTop.delete(); srcTriTop.delete(); dstTriTop.delete();
                        roiBotMat.delete(); botWarped.delete(); mBot.delete(); srcTriBot.delete(); dstTriBot.delete();
                        rawSrc.delete(); result.delete();
                    }
                    
                    src.delete(); procSrc.delete();
                } catch (err) {
                    console.error("CV Processing Error on file: ", file.name, err);
                }
                newDocs.push(currentDoc);
                resolve();
            };
            img.src = url;
        });
    }

    setDocs(prev => {
        const updated = [...prev, ...newDocs];
        if (activeIdx < 0 && updated.length > 0) {
            setActiveIdx(0);
        }
        return updated;
    });
    
    setIsProcessing(false);
    e.target.value = ''; 
  };

  const removeDoc = (idx: number) => {
    setDocs(prev => {
        const next = [...prev];
        next.splice(idx, 1);
        return next;
    });
    setActiveIdx(prev => {
        if (prev === idx) return Math.max(0, docs.length - 2);
        if (prev > idx) return prev - 1;
        return prev;
    });
    if (docs.length <= 1) {
       setActiveIdx(-1);
    }
  };

  const generatePDF = () => {
    if (docs.length === 0) return;

    let pdf: jsPDF | null = null;
    
    // Standard ISO 7810 ID-3 dimension (Passport size) is 125mm x 88mm.
    const passportWidthMm = 125;
    const passportHeightMm = 88;

    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        if (!doc.previewUrl || !doc.previewDims) continue;
        
        const { w: width, h: height } = doc.previewDims;
        
        // Define standard passport dimensions based on extraction aspect ratio
        let targetWidth = passportWidthMm;
        let targetHeight = passportHeightMm;
        let orientation: 'l' | 'p' = 'l';

        if (height > width) {
            targetWidth = passportHeightMm;
            targetHeight = passportWidthMm;
            orientation = 'p';
        }

        if (!pdf) {
            // Create PDF with mm units mapped to exactly the real passport dimensions
            pdf = new jsPDF({ orientation, unit: 'mm', format: [targetWidth, targetHeight] });
        } else {
            pdf.addPage([targetWidth, targetHeight], orientation);
        }
        
        // Ensure image fits perfectly filling physical space
        pdf.addImage(doc.previewUrl, 'JPEG', 0, 0, targetWidth, targetHeight);
    }
    
    if (pdf) {
        pdf.save(`passport-scan-multi-${new Date().getTime()}.pdf`);
    } else {
        addLog("No processed images found to generate PDF.");
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-gray-50/50">
      <Script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js" strategy="lazyOnload" onLoad={() => setOnnxReady(true)} />

      <div className="flex w-full max-w-5xl justify-between items-center mb-4"> 
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-emerald-600 font-medium px-3 py-1.5 bg-white border rounded shadow-sm flex items-center gap-2 transition-colors">
             {lang === 'zh' ? '返回主页' : 'Back'}
          </Link>
          <h1 className="text-3xl font-bold">{t.passportTitle}</h1>
        </div>
        <select value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'zh')} className="border p-2 rounded bg-white shadow-sm font-medium">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>

      {!cvReady && (
        <div className="w-full max-w-5xl mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 flex flex-col items-center shadow-sm">    
          <span className="font-semibold mb-2">
            {lang === 'zh' ? `正在下载 OpenCV 智能引擎组件 (${cvProgress}%)` : `Downloading OpenCV AI Engine (${cvProgress}%)`}
          </span>
          <div className="w-full bg-emerald-200 rounded-full h-2.5">
            <div className="bg-emerald-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${cvProgress}%` }}></div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-6 mb-4 bg-white p-4 rounded-lg shadow-sm border w-full max-w-5xl mt-4">
        <div className="flex items-center gap-2 relative">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">{t.pspUpload}:</label>
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              disabled={(!cvReady && !isProcessing) || isProcessing}
              className="border p-1.5 rounded text-sm w-56 text-gray-600 disabled:opacity-50"
              title="Upload Multiple Images"
            />
            {(!cvReady || isProcessing) && (
              <div className="absolute inset-0 bg-white/80 flex items-center justify-center text-xs font-semibold text-emerald-600 rounded pointer-events-none">
                {isProcessing ? (lang === 'zh' ? '正在批量处理...' : 'Processing Batch...') : (lang === 'zh' ? '加载引擎中...' : 'Loading Engine...')}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">{t.pspEnhance}:</label>
          <select
            value={scanMode}
            onChange={(e) => {
              setScanMode(e.target.value as 'color' | 'bw');
              setTimeout(updatePreviewCanvas, 50);
            }}
            className="border p-1.5 rounded text-sm font-medium focus:ring-emerald-500 cursor-pointer min-w-[140px]"
            title="Select Scan Mode"
          >
            <option value="color">{t.pspModeColor}</option>
            <option value="bw">{t.pspModeScan}</option>
          </select>
        </div>

        <button
          onClick={generatePDF}
          disabled={docs.length === 0 || isProcessing}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded disabled:opacity-50 transition-colors font-semibold ml-auto flex items-center gap-2 shadow-sm"
        >
           {lang === 'zh' ? '导出多页 PDF' : 'Export Multi-page PDF'} ({docs.length})
        </button>
      </div>

      {docs.length > 0 && (
          <div className="flex w-full max-w-5xl gap-4 mb-4 overflow-x-auto overflow-y-hidden p-4 bg-white rounded-lg shadow-sm border items-center">
             <span className="text-sm font-bold text-gray-500 shrink-0">{lang === 'zh' ? '文档列表' : 'Documents'}</span>
             {docs.map((doc, idx) => (
                <div 
                   key={doc.id}
                   onClick={() => setActiveIdx(idx)}
                   className={`relative cursor-pointer border-2 rounded-lg shrink-0 w-20 h-24 flex items-center justify-center transition-all bg-gray-50 ${idx === activeIdx ? 'border-emerald-500 shadow-md ring-2 ring-emerald-200 opacity-100' : 'border-gray-200 opacity-60 hover:opacity-100'}`}
                >
                   {/* eslint-disable-next-line @next/next/no-img-element */}
                   <img src={doc.previewUrl || doc.originalUrl} alt={`Doc ${idx+1}`} className="max-w-full max-h-full object-contain pointer-events-none" />
                   <button 
                       onClick={(e) => { e.stopPropagation(); removeDoc(idx); }}
                       className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow z-10"
                   ></button>
                   <div className="absolute bottom-0 w-full text-center bg-black/50 text-white text-[10px]">
                      {idx + 1}
                   </div>
                </div>
             ))}
          </div>
      )}

      {activeDoc ? (
        <div className="flex flex-col md:flex-row gap-8 items-start w-full max-w-5xl justify-center">
          <div className="flex flex-col items-center flex-1 w-full md:w-1/2">   
            <h2 className="mb-3 font-semibold text-gray-700">{lang === 'zh' ? '原始图片' : 'Original Photo'}</h2>
            <div className="relative inline-block border border-gray-200 shadow-sm rounded-lg" style={{ touchAction: 'none' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}        
              <img
                key={activeDoc.id}
                ref={imageRef}
                src={activeDoc.originalUrl}
                alt="Original Passport"
                style={{ maxHeight: '500px', maxWidth: '100%', width: 'auto', height: 'auto', display: 'block' }}
                onLoad={updatePreviewCanvas}
                className="opacity-90"
              />
              {activeDoc.anchorPoints && activeDoc.dims && (
                  <svg 
                      ref={svgRef}
                      className="absolute top-0 left-0 w-full h-full z-10"
                      viewBox={`0 0 ${activeDoc.dims.w} ${activeDoc.dims.h}`}
                      preserveAspectRatio="none"
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                  >
                      <polygon 
                          points={activeDoc.anchorPoints.map(p => `${p.x},${p.y}`).join(' ')}
                          fill="rgba(16, 185, 129, 0.2)"
                          stroke="#10b981"
                          strokeWidth={Math.max(2, activeDoc.dims.w * 0.005)}
                      />
                      {activeDoc.anchorPoints.length === 6 && (
                          <line
                              x1={activeDoc.anchorPoints[5].x} y1={activeDoc.anchorPoints[5].y}
                              x2={activeDoc.anchorPoints[2].x} y2={activeDoc.anchorPoints[2].y}
                              stroke="#10b981"
                              strokeWidth={Math.max(2, activeDoc.dims.w * 0.005)}
                              strokeDasharray={`${Math.max(5, activeDoc.dims.w * 0.01)}, ${Math.max(5, activeDoc.dims.w * 0.01)}`}
                          />
                      )}
                      {activeDoc.anchorPoints.map((p, i) => (
                          <circle 
                              key={i}
                              cx={p.x}
                              cy={p.y}
                              r={Math.max(10, activeDoc.dims!.w * 0.03)}
                              fill="white"
                              stroke="#10b981"
                              strokeWidth={Math.max(2, activeDoc.dims!.w * 0.005)}
                              onPointerDown={(e) => handlePointerDown(i, e)}
                              style={{ cursor: draggingPoint === i ? 'grabbing' : 'grab' }}
                          />
                      ))}
                  </svg>
              )}
            </div>
            <p className="mt-4 text-xs text-emerald-700 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100 shadow-sm text-center">
              {lang === 'zh' ? ' 提示：您可以自由拖拽 6 个控制点以对齐照片' : ' Tip: You can drag the 6 anchors to align.'}
            </p>
          </div>

          <div className="flex flex-col items-center flex-1 w-full md:w-1/2">   
            <h2 className="mb-3 font-semibold text-gray-700">{t.pspPreview}</h2>
            <div className="p-4 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg w-full min-h-[400px] flex items-center justify-center relative overflow-hidden shadow-inner">
              <canvas
                ref={canvasRef}
                className={`max-w-[100%] max-h-[500px] shadow-lg bg-white object-contain border border-gray-300 ${activeDoc.anchorPoints ? 'block' : 'hidden'}`}
              />
              {!activeDoc.anchorPoints && (
                <span className="text-gray-400 absolute font-medium">
                  {lang === 'zh' ? '请在左侧确认锚点位置以预览' : 'Adjust points on the left to preview'}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-4xl bg-white p-12 rounded-2xl shadow-sm border flex flex-col items-center justify-center text-gray-400 border-dashed border-2">
          <div className="text-6xl mb-6 opacity-30 text-emerald-600"></div>   
          <p className="font-medium text-lg text-gray-500">{lang === 'zh' ? '请先上传您的照片以进行扫描矫正（支持多选）' : 'Upload photos to auto-deskew and scan'}</p>
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
