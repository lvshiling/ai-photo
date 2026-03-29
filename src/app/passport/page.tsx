'use client';
import Link from 'next/link';
import Script from 'next/script';
import { useState, useRef, useEffect, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import { dict } from '../../i18n/dictionaries';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cv: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ort: any;
  }
}

export default function PassportScanner() {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const t = dict[lang];

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [originalImageSrc, setOriginalImageSrc] = useState<string | null>(null);
  const [anchorPoints, setAnchorPoints] = useState<{x: number, y: number}[] | null>(null);
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null);
  const [imageDims, setImageDims] = useState<{w: number, h: number} | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  
  const [scanMode, setScanMode] = useState<'color' | 'bw'>('color');
  const [useOnnx, setUseOnnx] = useState(false);
  const [onnxReady, setOnnxReady] = useState(false);
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

  // Replace old effect with perspective update loop
  const updatePreviewCanvas = useCallback(() => {
    if (!window.cv || !anchorPoints || !imageRef.current || !canvasRef.current) return;
    const img = imageRef.current;
    if (!img.naturalWidth) return;

    try {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = img.naturalWidth;
          tempCanvas.height = img.naturalHeight;
          const tempCtx = tempCanvas.getContext('2d')!;
          tempCtx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
          const src = window.cv.imread(tempCanvas);

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

              if (finalWidth <= 0 || finalHeight <= 0) {
                 src.delete();
                 return;
              }

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
              
              window.cv.imshow(canvasRef.current, result);
              src.delete(); result.delete();
          } else {
              const [tl, tr, br, bl] = anchorPoints;
              const width = Math.max(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(br.x - bl.x, br.y - bl.y));
              const height = Math.max(Math.hypot(tl.x - bl.x, tl.y - bl.y), Math.hypot(tr.x - br.x, tr.y - br.y));
              const finalWidth = Math.round(width);
              const finalHeight = Math.round(height);
              if (finalWidth <= 0 || finalHeight <= 0) {
                 src.delete();
                 return;
              }
              const result = new window.cv.Mat();
              const srcTri = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
              const dstTri = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [0, 0, finalWidth-1, 0, finalWidth-1, finalHeight-1, 0, finalHeight-1]);
              const M = window.cv.getPerspectiveTransform(srcTri, dstTri);
              window.cv.warpPerspective(src, result, M, new window.cv.Size(finalWidth, finalHeight));

              if (scanMode === 'bw') {
                  window.cv.cvtColor(result, result, window.cv.COLOR_RGBA2GRAY, 0);
                  window.cv.adaptiveThreshold(result, result, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY, 21, 15);
              }
              window.cv.imshow(canvasRef.current, result);
              src.delete(); result.delete(); srcTri.delete(); dstTri.delete(); M.delete();
          }
      } catch (err) {
          console.error("Preview Update Error:", err);
      }
  }, [anchorPoints, scanMode]);

  useEffect(() => {
    if (anchorPoints && draggingPoint === null) {
        updatePreviewCanvas();
    }
  }, [anchorPoints, draggingPoint, updatePreviewCanvas]);

  const handlePointerDown = (idx: number, e: React.PointerEvent<SVGCircleElement>) => {
    setDraggingPoint(idx);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingPoint === null || !svgRef.current || !anchorPoints || !imageDims) return;
    const rect = svgRef.current.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    
    // Convert to bounded natural coords
    const x = Math.max(0, Math.min((rawX / rect.width) * imageDims.w, imageDims.w));
    const y = Math.max(0, Math.min((rawY / rect.height) * imageDims.h, imageDims.h));
    
    const newPoints = [...anchorPoints];
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsProcessing(true);
    const url = URL.createObjectURL(file);
    setOriginalImageSrc(url);
    
    if (!window.cv || !window.cv.Mat) {
       setImageSrc(url);
       setHasAutoCropped(false);
       setIsProcessing(false);
       return;
    }

    const img = new Image();
    img.onload = async () => {
        try {
            const src = window.cv.imread(img);
            let maxApproxCorners: {x:number, y:number}[] | null = null;
            
            // Downscale for faster contour detection
            const maxDim = 800;
            let scale = 1;
            const procSrc = src.clone();
            if (src.cols > maxDim || src.rows > maxDim) {
                scale = Math.min(maxDim / src.cols, maxDim / src.rows);
                window.cv.resize(src, procSrc, new window.cv.Size(src.cols * scale, src.rows * scale), 0, 0, window.cv.INTER_AREA);
            }

            // === OPTIONAL ONNX PIPELINE ===
            if (useOnnx) {
                try {
                    addLog("Running ONNX deep learning inference...");
                    if (!window.ort) {
                        throw new Error("onnxruntime-web not loaded yet.");
                    }
                    const ort = window.ort;
                    // Ensure you have placed a valid corner detection model in your public/models folder
                    // Expected to be a regression model returning exactly 8 floats: [tl_x, tl_y, tr_x, tr_y, br_x, br_y, bl_x, bl_y]
                    const session = await ort.InferenceSession.create('/models/document-corner.onnx', { executionProviders: ['wasm'] });
                    
                    // Assuming model requires 256x256 normalized float32 tensor
                    const size = 256;
                    const onnxCanvas = document.createElement('canvas');
                    onnxCanvas.width = size; onnxCanvas.height = size;
                    const oCtx = onnxCanvas.getContext('2d')!;
                    oCtx.drawImage(img, 0, 0, size, size);
                    const imgData = oCtx.getImageData(0, 0, size, size).data;
                    
                    const float32Data = new Float32Array(3 * size * size);
                    // R, G, B planar format
                    for (let i = 0; i < size * size; i++) {
                        float32Data[i] = imgData[i * 4] / 255.0;            // R
                        float32Data[i + size * size] = imgData[i * 4 + 1] / 255.0; // G
                        float32Data[i + 2 * size * size] = imgData[i * 4 + 2] / 255.0; // B
                    }
                    
                    const tensor = new ort.Tensor('float32', float32Data, [1, 3, size, size]);
                    // E.g. 'input' -> Model's input name. 'output' -> Model's output name.
                    const results = await session.run({ [session.inputNames[0]]: tensor });
                    const outputArray = results[session.outputNames[0]].data as Float32Array;
                    
                    // We expect [1, 8] vector normalized. Map back to original image size
                    if (outputArray.length >= 8) {
                        maxApproxCorners = [
                            { x: outputArray[0] * img.naturalWidth, y: outputArray[1] * img.naturalHeight }, // TL
                            { x: outputArray[2] * img.naturalWidth, y: outputArray[3] * img.naturalHeight }, // TR
                            { x: outputArray[4] * img.naturalWidth, y: outputArray[5] * img.naturalHeight }, // BR
                            { x: outputArray[6] * img.naturalWidth, y: outputArray[7] * img.naturalHeight }, // BL
                        ];
                        addLog("ONNX 4-corner detection successful.");
                    }
                } catch (onnxErr) {
                    addLog("ONNX Inference failed or model not found. Falling back to OpenCV.");
                    console.warn(onnxErr);
                }
            }

            // === FALLBACK: JSCANIFY PIPELINE ===
            let fallbackBoundingRect: any = null;

            if (!maxApproxCorners) {
                // @ts-ignore
                const jscanifyModule = await import('jscanify/client');
                const JScanify = jscanifyModule.default || jscanifyModule;
                const scanner = new JScanify();
                
                addLog("Using jscanify for paper contour detection...");
                
                const paperContour = scanner.findPaperContour(procSrc);
                
                if (paperContour && window.cv.contourArea(paperContour) > 10000) {
                    let bestCorners = null;
                    
                    // Strategy 1: Strict Poly Approximation to avoid edge bulges and shadows
                    for (let ep = 0.01; ep <= 0.06; ep += 0.01) {
                        const approx = new window.cv.Mat();
                        const epsilon = ep * window.cv.arcLength(paperContour, true);
                        window.cv.approxPolyDP(paperContour, approx, epsilon, true);
                        if (approx.rows === 4) {
                            const temp = [];
                            for(let j=0; j<4; j++) {
                                temp.push({x: approx.data32S[j*2], y: approx.data32S[j*2+1]});
                            }
                            const sums = temp.map(p => p.x + p.y);
                            const diffs = temp.map(p => p.x - p.y);
                            bestCorners = {
                                topLeftCorner: temp[sums.indexOf(Math.min(...sums))],
                                bottomRightCorner: temp[sums.indexOf(Math.max(...sums))],
                                topRightCorner: temp[diffs.indexOf(Math.max(...diffs))],
                                bottomLeftCorner: temp[diffs.indexOf(Math.min(...diffs))]
                            };
                            approx.delete();
                            addLog(`Used strict approxPolyDP (epsilon ${ep.toFixed(2)}) for straight edges.`);
                            break;
                        }
                        approx.delete();
                    }

                    // Strategy 2: Fallback to jscanify heuristic points
                    if (!bestCorners) {
                        bestCorners = scanner.getCornerPoints(paperContour);
                        addLog("Used jscanify default corner points algorithm.");
                    }
                    
                    if (bestCorners && bestCorners.topLeftCorner) {
                        const tl = bestCorners.topLeftCorner;
                        const tr = bestCorners.topRightCorner;
                        const br = bestCorners.bottomRightCorner;
                        const bl = bestCorners.bottomLeftCorner;
                        
                        // Centroid calculation
                        const cx = (tl.x + tr.x + br.x + bl.x) / 4;
                        const cy = (tl.y + tr.y + br.y + bl.y) / 4;
                        
                        // Shrink edges inward by 2.5% to firmly eliminate background artifacts / shadows
                        const shrink = 0.975;
                        const insetPoint = (p: any) => ({
                            x: Math.round(cx + (p.x - cx) * shrink),
                            y: Math.round(cy + (p.y - cy) * shrink)
                        });

                        const iTl = insetPoint(tl);
                        const iTr = insetPoint(tr);
                        const iBr = insetPoint(br);
                        const iBl = insetPoint(bl);

                        maxApproxCorners = [
                            { x: Math.round(iTl.x / scale), y: Math.round(iTl.y / scale) },
                            { x: Math.round(iTr.x / scale), y: Math.round(iTr.y / scale) },
                            { x: Math.round(iBr.x / scale), y: Math.round(iBr.y / scale) },
                            { x: Math.round(iBl.x / scale), y: Math.round(iBl.y / scale) }
                        ];
                        addLog("Corners successfully mapped and inset inwards to eliminate fuzzy bleed.");
                    }
                    
                    // Always calculate a bounding box for fallback just in case
                    fallbackBoundingRect = window.cv.boundingRect(paperContour);
                } else {
                    addLog("jscanify could not find any suitable contours.");
                }
            }
            
            if (maxApproxCorners) {
                const tl = maxApproxCorners[0];
                const tr = maxApproxCorners[1];
                const br = maxApproxCorners[2];
                const bl = maxApproxCorners[3];
                
                addLog(`Quadrilateral extracted!`);
                addLog(`TL: (${tl.x}, ${tl.y}) TR: (${tr.x}, ${tr.y})`);
                addLog(`BL: (${bl.x}, ${bl.y}) BR: (${br.x}, ${br.y})`);
                
                const rm = { x: Math.round((tr.x + br.x) / 2), y: Math.round((tr.y + br.y) / 2) };
                const lm = { x: Math.round((tl.x + bl.x) / 2), y: Math.round((tl.y + bl.y) / 2) };
                setAnchorPoints([{...tl}, {...tr}, {...rm}, {...br}, {...bl}, {...lm}]);
                setImageDims({ w: img.naturalWidth, h: img.naturalHeight });
                setHasAutoCropped(true);
            } else {
                setHasAutoCropped(false);
                
                if (fallbackBoundingRect) {
                    const fx = Math.round(fallbackBoundingRect.x / scale);
                    const fy = Math.round(fallbackBoundingRect.y / scale);
                    const fw = Math.round(fallbackBoundingRect.width / scale);
                    const fh = Math.round(fallbackBoundingRect.height / scale);
                    addLog(`Using bounding rect fallback: x=${fx}, y=${fy}, w=${fw}, h=${fh}`);
                    
                    setAnchorPoints([
                        { x: fx, y: fy },
                        { x: fx + fw, y: fy },
                        { x: fx + fw, y: fy + fh / 2 },
                        { x: fx + fw, y: fy + fh },
                        { x: fx, y: fy + fh },
                        { x: fx, y: fy + fh / 2 }
                    ]);
                } else {
                    addLog(`Manual fallback required.`);
                    setAnchorPoints([
                        { x: img.naturalWidth * 0.1, y: img.naturalHeight * 0.1 },
                        { x: img.naturalWidth * 0.9, y: img.naturalHeight * 0.1 },
                        { x: img.naturalWidth * 0.9, y: img.naturalHeight * 0.5 },
                        { x: img.naturalWidth * 0.9, y: img.naturalHeight * 0.9 },
                        { x: img.naturalWidth * 0.1, y: img.naturalHeight * 0.9 },
                        { x: img.naturalWidth * 0.1, y: img.naturalHeight * 0.5 }
                    ]);
                }
                setImageDims({ w: img.naturalWidth, h: img.naturalHeight });
            }
            // Trigger processing end, preview will be generated via useEffect
            setImageSrc(url);
            
            src.delete(); procSrc.delete();
        } catch (err) {
            console.error("CV Processing Error: ", err);
            setImageSrc(url);
            setHasAutoCropped(false);
        } finally {
            setIsProcessing(false);
        }
    };
    img.src = url;
  };

  const generatePDF = () => {
    if (!canvasRef.current || !anchorPoints) return;
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
      <Script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js" strategy="lazyOnload" onLoad={() => setOnnxReady(true)} />
      
      <div className="flex w-full max-w-4xl justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-emerald-600 font-medium px-3 py-1.5 bg-white border rounded shadow-sm flex items-center gap-2 transition-colors">
            ← {lang === 'zh' ? '返回主页' : 'Back'}
          </Link>
          <h1 className="text-3xl font-bold">{t.passportTitle}</h1>
          {/* Defaulting to hidden in UI since open-source pure 8-point regression ONNX models are not standard available */}
          <label className="hidden ml-4 items-center gap-2 text-sm text-gray-700 bg-white px-3 py-1.5 rounded border shadow-sm cursor-pointer hover:bg-gray-50 transition-colors">
            <input 
              type="checkbox" 
              checked={useOnnx} 
              onChange={(e) => setUseOnnx(e.target.checked)} 
              className="w-4 h-4 accent-emerald-600"
            />
            {lang === 'zh' ? '使用深度学习边缘检测 (ONNX)' : 'Use Deep Learning Edge Detection'}
          </label>
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
          disabled={!imageSrc || !anchorPoints}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded disabled:opacity-50 transition-colors font-semibold ml-auto flex items-center gap-2 shadow-sm"
        >
          📄 {t.pspGeneratePdf}
        </button>
      </div>

      {imageSrc ? (
        <div className="flex flex-col md:flex-row gap-8 items-start w-full max-w-5xl justify-center mt-4">
          <div className="flex flex-col items-center flex-1 w-full md:w-1/2">   
            <h2 className="mb-3 font-semibold text-gray-700">{lang === 'zh' ? '原始图片' : 'Original Photo'}</h2>
            <div className="relative inline-block border border-gray-200 shadow-sm rounded-lg" style={{ touchAction: 'none' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}        
              <img
                ref={imageRef}
                src={originalImageSrc || imageSrc}
                alt="Original Passport"
                style={{ maxHeight: '500px', maxWidth: '100%', width: 'auto', height: 'auto', display: 'block' }}
                onLoad={updatePreviewCanvas}
                className="opacity-90"
              />
              {anchorPoints && imageDims && (
                  <svg 
                      ref={svgRef}
                      className="absolute top-0 left-0 w-full h-full z-10"
                      viewBox={`0 0 ${imageDims.w} ${imageDims.h}`}
                      preserveAspectRatio="none"
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                  >
                      <polygon 
                          points={anchorPoints.map(p => `${p.x},${p.y}`).join(' ')}
                          fill="rgba(16, 185, 129, 0.2)"
                          stroke="#10b981"
                          strokeWidth={Math.max(2, imageDims.w * 0.005)}
                      />
                      {anchorPoints.length === 6 && (
                          <line
                              x1={anchorPoints[5].x} y1={anchorPoints[5].y}
                              x2={anchorPoints[2].x} y2={anchorPoints[2].y}
                              stroke="#10b981"
                              strokeWidth={Math.max(2, imageDims.w * 0.005)}
                              strokeDasharray={`${Math.max(5, imageDims.w * 0.01)}, ${Math.max(5, imageDims.w * 0.01)}`}
                          />
                      )}
                      {anchorPoints.map((p, i) => (
                          <circle 
                              key={i}
                              cx={p.x}
                              cy={p.y}
                              r={Math.max(10, imageDims.w * 0.03)}
                              fill="white"
                              stroke="#10b981"
                              strokeWidth={Math.max(2, imageDims.w * 0.005)}
                              onPointerDown={(e) => handlePointerDown(i, e)}
                              style={{ cursor: draggingPoint === i ? 'grabbing' : 'grab' }}
                          />
                      ))}
                  </svg>
              )}
            </div>
            <p className="mt-4 text-xs text-emerald-700 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100 shadow-sm text-center">
              {lang === 'zh' ? '💡 提示：您可以自由拖拽 4 个控制点以对齐照片' : '💡 Tip: You can drag the 4 corner anchors to align.'}
            </p>
          </div>

          <div className="flex flex-col items-center flex-1 w-full md:w-1/2">   
            <h2 className="mb-3 font-semibold text-gray-700">{t.pspPreview}</h2>
            <div className="p-4 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg w-full min-h-[400px] flex items-center justify-center relative overflow-hidden shadow-inner">
              <canvas
                ref={canvasRef}
                className={`max-w-[100%] max-h-[500px] shadow-lg bg-white object-contain border border-gray-300 ${anchorPoints ? 'block' : 'hidden'}`}
              />
              {!anchorPoints && (
                <span className="text-gray-400 absolute font-medium">
                  {lang === 'zh' ? '请在左侧确认锚点位置以预览' : 'Adjust points on the left to preview'}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-4xl bg-white p-12 rounded-2xl shadow-sm border mt-4 flex flex-col items-center justify-center text-gray-400 border-dashed border-2">
          <div className="text-6xl mb-6 opacity-30 text-emerald-600">📸</div>   
          <p className="font-medium text-lg text-gray-500">{lang === 'zh' ? '请先上传您的照片以进行扫描矫正' : 'Upload photo to auto-deskew and scan'}</p>
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

