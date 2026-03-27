'use client';
import { useRef, useState, useEffect } from 'react';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

import 'react-image-crop/dist/ReactCrop.css';
import ReactCrop, { type Crop } from 'react-image-crop';
import { useReactToPrint } from 'react-to-print';
import { dict } from '../i18n/dictionaries';

export default function Home() {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const t = dict[lang];

  const [image, setImage] = useState<string | null>(null);
  const [segmenter, setSegmenter] = useState<ImageSegmenter | null>(null);
  const [bgColor, setBgColor] = useState<string>('#0000ff');
  const [photoSize, setPhotoSize] = useState<string>('1inch');
  const [isPrintLayout, setIsPrintLayout] = useState<boolean>(false);
  const [beautyLevel, setBeautyLevel] = useState<number>(0);
  const [edgeTrim, setEdgeTrim] = useState<number>(0);
  const [crop, setCrop] = useState<Crop>();
  const [logs, setLogs] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: resultContainerRef,
    documentTitle: 'ID-Photo',
  });

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${time}] ${msg}`]);
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    async function initSegmenter() {
      addLog('System initializing...');
      try {
        addLog('Loading MediaPipe vision tasks WASM...');
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        addLog('Fetching Selfie Segmenter model (this may take a moment)...');
        const segmenter = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
            delegate: 'GPU',
          },
          runningMode: 'IMAGE',
          outputCategoryMask: true,
          outputConfidenceMasks: true,
        });
        setSegmenter(segmenter);
        addLog('Model loaded successfully. Ready to process.');
      } catch (err: any) {
        addLog(`Error loading model: ${err.message}`);
      }
    }
    initSegmenter();
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setImage(url);
    }
  };

  const processImage = async () => {
    if (!segmenter || !imageRef.current || !canvasRef.current) {
      addLog('Cannot process: Model or image not ready.');
      return;
    }
    const img = imageRef.current;
    const canvas = canvasRef.current;

    addLog('Starting image processing...');
    
    // Calculate crop dimensions relative to the natural image size
    let sx = 0, sy = 0, sWidth = img.naturalWidth, sHeight = img.naturalHeight;
    if (crop && crop.width > 0 && crop.height > 0) {
      const scaleX = img.naturalWidth / img.width;
      const scaleY = img.naturalHeight / img.height;
      sx = crop.x * scaleX;
      sy = crop.y * scaleY;
      sWidth = crop.width * scaleX;
      sHeight = crop.height * scaleY;
    }

    // Set target canvas size based on standard photo types
    let targetWidth = sWidth;
    let targetHeight = sHeight;
    if (photoSize === '1inch') {
      targetWidth = 295; // Standard 1-inch width at 300dpi
      targetHeight = 413; // Standard 1-inch height at 300dpi
    } else if (photoSize === '2inch') {
      targetWidth = 413; // Standard 2-inch width at 300dpi
      targetHeight = 579; // Standard 2-inch height at 300dpi
    }

    const isGrid = isPrintLayout;
    const gridCols = 4;
    const gridRows = 2;
    const gridGap = 30;

    // Set canvas to the actual required pixel size
    if (isGrid) {
      canvas.width = gridCols * targetWidth + (gridCols + 1) * gridGap;
      canvas.height = gridRows * targetHeight + (gridRows + 1) * gridGap;
    } else {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create a temporary canvas matching the natural image size for processing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.naturalWidth;
    tempCanvas.height = img.naturalHeight;
    const tCtx = tempCanvas.getContext('2d');
    if (!tCtx) return;

    try {
      addLog('Running segmenter model...');
      const result = await segmenter.segment(img);
      const categoryMask = result.categoryMask;
      if (!categoryMask) {
        addLog('Error: Model returned empty mask.');
        return;
      }
      addLog('Segmenter finished. Applying background and formatting...');

      const maskData = categoryMask.getAsUint8Array();
      
      let bgConfidence: Float32Array | null = null;
      let hairConfidence: Float32Array | null = null;
      let bodyConfidence: Float32Array | null = null;
      
      if (result.confidenceMasks && result.confidenceMasks.length > 0) {
        if (result.confidenceMasks.length >= 6) {
           bgConfidence = result.confidenceMasks[0].getAsFloat32Array();
           hairConfidence = result.confidenceMasks[1].getAsFloat32Array();
           // selfie_multiclass: 0=bg, 1=hair, 2=body/skin, 3=face, 4=clothes
           
           // Sum up clothes, face, and body to get the 'solid body' mask
           bodyConfidence = new Float32Array(bgConfidence.length);
           const m2 = result.confidenceMasks[2]?.getAsFloat32Array();
           const m3 = result.confidenceMasks[3]?.getAsFloat32Array();
           const m4 = result.confidenceMasks[4]?.getAsFloat32Array();
           const m5 = result.confidenceMasks[5]?.getAsFloat32Array();
           
           for(let i=0; i<bodyConfidence.length; i++) {
              let val = 0;
              if (m2) val += m2[i];
              if (m3) val += m3[i];
              if (m4) val += m4[i];
              if (m5) val += m5[i];
              bodyConfidence[i] = val;
           }
           
           addLog('Using multiclass masks for background and hair.');
        } else if (result.confidenceMasks[1]) {
           // fallback to 2-class
           const pConf = result.confidenceMasks[1].getAsFloat32Array();
           bgConfidence = new Float32Array(pConf.length);
           for(let i=0; i<pConf.length; i++) bgConfidence[i] = 1.0 - pConf[i];
           addLog('Using 2-class masks.');
        } else {
           bgConfidence = result.confidenceMasks[0].getAsFloat32Array();
        }
      }
      
      // Draw original image first to get pixel data
      tCtx.drawImage(img, 0, 0);
      const imgData = tCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const pixels = imgData.data;

      // Create a beautified version of the image if beauty level > 0
      let beautyPixels = pixels;
      if (beautyLevel > 0) {
        const bCanvas = document.createElement('canvas');
        bCanvas.width = img.naturalWidth;
        bCanvas.height = img.naturalHeight;
        const bCtx = bCanvas.getContext('2d');
        if (bCtx) {
          // Adjust brightness, contrast, and saturation
          const brightness = 100 + (beautyLevel * 0.2); // Up to 120%
          const contrast = 100 + (beautyLevel * 0.1);   // Up to 110%
          const saturate = 100 + (beautyLevel * 0.2);   // Up to 120%
          bCtx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%)`;
          bCtx.drawImage(img, 0, 0);

          // Apply a gentle "soft focus" for skin smoothing by overlaying a blurred copy
          bCtx.globalAlpha = beautyLevel / 150; // max 0.66 at scale 100
          bCtx.filter = `blur(${Math.max(1, beautyLevel / 15)}px)`;
          bCtx.drawImage(img, 0, 0);
          
          beautyPixels = bCtx.getImageData(0, 0, bCanvas.width, bCanvas.height).data;
        }
      }

      // Parse current background color
      const hex = bgColor;
      const r = parseInt(hex.substring(1, 3), 16);
      const g = parseInt(hex.substring(3, 5), 16);
      const b = parseInt(hex.substring(5, 7), 16);

      const w = tempCanvas.width;
      const h = tempCanvas.height;
      let alphaMask = new Float32Array(maskData.length);
      
      // Determine if maskData gives 0 for person or !== 0 for person
      let isPersonZero = maskData[0] === 0 || maskData[10] === 0; 
      
      if (bgConfidence) {
        // bgConfidence is straightforward map of background
        for (let i = 0; i < alphaMask.length; i++) {
          alphaMask[i] = bgConfidence[i];
        }
      } else {
        for (let i = 0; i < maskData.length; i++) {
          alphaMask[i] = (isPersonZero ? (maskData[i] === 0 ? 0.0 : 1.0) : (maskData[i] !== 0 ? 1.0 : 0.0));
        }
      }

      if (edgeTrim > 0) {
        addLog('Applying white edge cutoff for hair...');
        const trimFactor = edgeTrim / 100; // 0.0 to 1.0
        
        for (let i = 0; i < alphaMask.length; i++) {
           let bgAlpha = alphaMask[i];
           // Only target the soft edge pixels (excluding the solid inner body where bgAlpha is ~0)
           // and already purely background pixels.
           if (bgAlpha > 0.02 && bgAlpha < 1.0) {
              
              if (hairConfidence) {
                 // Only trim if this is considered partly hair
                 // We don't want to trim skin or clothes
                 if (hairConfidence[i] < 0.05) {
                    continue;
                 }
                 
                 // CRITICAL FIX: If this hair pixel lies OVER the body/clothes 
                 // (body confidence is high), DO NOT treat it as a background blending edge!
                 if (bodyConfidence && bodyConfidence[i] > 0.3) {
                    continue;
                 }
              }

              const pr = pixels[i * 4];
              const pg = pixels[i * 4 + 1];
              const pb = pixels[i * 4 + 2];
              
              // brightness estimation
              const lum = Math.max(pr, pg, pb);
              
              // Act on mid-to-bright pixels (white background leftover)
              if (lum > 90) {
                 // Push this pixel slightly more towards background transparency
                 // The brighter the pixel, and the higher the edgeTrim setting, the more it gets cut off.
                 const brightRatio = (lum - 90) / (255 - 90); // 0.0 to 1.0
                 // MASSIVE increase to multiplier to give a highly aggressive cutoff!
                 let newBgAlpha = bgAlpha + trimFactor * brightRatio * 8.0; 
                 alphaMask[i] = Math.min(1.0, newBgAlpha);
              }
           }
        }
        
        // Minor smoothing of the pushed alpha to ensure we don't get aliased/jagged edges
        const radius = 1;
        const tempAlpha = new Float32Array(alphaMask.length);
        
        // Fast horizontal box blur
        for (let y = 0; y < h; y++) {
          let sum = 0;
          for (let i = -radius; i <= radius; i++) {
            sum += alphaMask[y * w + Math.min(Math.max(i, 0), w - 1)];
          }
          for (let x = 0; x < w; x++) {
            tempAlpha[y * w + x] = sum / (radius * 2 + 1);
            const next = x + radius + 1;
            const prev = x - radius;
            sum += alphaMask[y * w + Math.min(next, w - 1)];
            sum -= alphaMask[y * w + Math.max(prev, 0)];
          }
        }
        
        // Fast vertical box blur
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let i = -radius; i <= radius; i++) {
            sum += tempAlpha[Math.min(Math.max(i, 0), h - 1) * w + x];
          }
          for (let y = 0; y < h; y++) {
            alphaMask[y * w + x] = sum / (radius * 2 + 1);
            const next = y + radius + 1;
            const prev = y - radius;
            sum += tempAlpha[Math.min(next, h - 1) * w + x];
            sum -= tempAlpha[Math.max(prev, 0) * w + x];
          }
        }
      }

      // Apply mask based on alpha interpolation
      for (let i = 0; i < alphaMask.length; i++) {
        const bgAlpha = alphaMask[i];
        if (bgAlpha === 1.0) { 
          // Pure Background
          pixels[i * 4] = r;
          pixels[i * 4 + 1] = g;
          pixels[i * 4 + 2] = b;
          pixels[i * 4 + 3] = 255; // fully opaque
        } else if (bgAlpha > 0.0) {
          // Mixed Edge Blending
          const fgAlpha = 1.0 - bgAlpha;
          let fr = beautyLevel > 0 ? beautyPixels[i * 4] : pixels[i * 4];
          let fg = beautyLevel > 0 ? beautyPixels[i * 4 + 1] : pixels[i * 4 + 1];
          let fb = beautyLevel > 0 ? beautyPixels[i * 4 + 2] : pixels[i * 4 + 2];
          
          // Second pass: Color decontamination specifically for the bright halos that survived cutoff
          if (edgeTrim > 0 && bgAlpha > 0.01) {
             let isHairEdge = false;
             if (hairConfidence) {
                if (hairConfidence[i] > 0.05 && (!bodyConfidence || bodyConfidence[i] < 0.3)) {
                   isHairEdge = true;
                }
             } else {
                isHairEdge = true; // fallback
             }
             
             if (isHairEdge) {
                 const lum = Math.max(fr, fg, fb);
                 if (lum > 90) {
                     const trimFactor = edgeTrim / 100;
                     const bleed = (lum - 90) / (255 - 90);
                     // Brutal decontamination for white bleed: pull the darks WAY down
                     const darkenFactor = Math.max(0.05, 1.0 - (trimFactor * bleed * 1.5));
                     fr *= darkenFactor;
                     fg *= darkenFactor;
                     fb *= darkenFactor;
                 }
             }
          }
          
          pixels[i * 4] = Math.round(r * bgAlpha + fr * fgAlpha);
          pixels[i * 4 + 1] = Math.round(g * bgAlpha + fg * fgAlpha);
          pixels[i * 4 + 2] = Math.round(b * bgAlpha + fb * fgAlpha);
          pixels[i * 4 + 3] = 255;
        } else if (beautyLevel > 0) {
          // Pure Foreground
          pixels[i * 4] = beautyPixels[i * 4];
          pixels[i * 4 + 1] = beautyPixels[i * 4 + 1];
          pixels[i * 4 + 2] = beautyPixels[i * 4 + 2];
        }
      }

      tCtx.putImageData(imgData, 0, 0);

      if (isGrid) {
        // Fill white background for print
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Generate a single photo first
        const singleCanvas = document.createElement('canvas');
        singleCanvas.width = targetWidth;
        singleCanvas.height = targetHeight;
        const singleCtx = singleCanvas.getContext('2d');
        if (singleCtx) {
          singleCtx.drawImage(tempCanvas, sx, sy, sWidth, sHeight, 0, 0, targetWidth, targetHeight);
          
          // Layout in a grid
          for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
              const dx = gridGap + c * (targetWidth + gridGap);
              const dy = gridGap + r * (targetHeight + gridGap);
              ctx.drawImage(singleCanvas, 0, 0, targetWidth, targetHeight, dx, dy, targetWidth, targetHeight);
            }
          }
        }
      } else {
        // Just draw the single cropped portion
        ctx.drawImage(tempCanvas, sx, sy, sWidth, sHeight, 0, 0, targetWidth, targetHeight);
      }
      
      addLog('Output render complete.');
    } catch (e: any) {
      console.error(e);
      addLog(`Error processing image: ${e.message}`);
      alert(t.error);
    }
  };

  const handleSave = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `id-photo-${new Date().getTime()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    addLog('Image saved to disk.');
  };

  // Determine aspect ratio for cropping
  let cropAspect: number | undefined = undefined;
  if (photoSize === '1inch') cropAspect = 295 / 413;
  if (photoSize === '2inch') cropAspect = 413 / 579;

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <div className="flex w-full max-w-4xl justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">{t.title}</h1>
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
      
      <div className="flex flex-wrap items-center justify-center gap-4 mb-4 bg-white p-4 rounded-lg shadow-sm border w-full max-w-4xl">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">{t.imgLabel}</label>
          <input 
            type="file" 
            accept="image/*" 
            onChange={handleImageUpload} 
            className="border p-1.5 rounded text-sm w-48"
            title="Upload Image"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">{t.bgLabel}</label>
          <input 
            type="color" 
            value={bgColor} 
            onChange={(e) => setBgColor(e.target.value)} 
            className="h-8 w-8 p-0 border-0 rounded cursor-pointer"
            title="Background Color"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">{t.sizeLabel}</label>
          <select 
            value={photoSize}
            onChange={(e) => {
              setPhotoSize(e.target.value);
              setCrop(undefined);
            }}
            className="border p-1.5 rounded text-sm min-w-32"
            title="Select Photo Size"
          >
            <option value="1inch">{t.size1Inch}</option>
            <option value="2inch">{t.size2Inch}</option>
          </select>
        </div>
        
        <label className="flex items-center gap-2 text-sm font-medium p-1.5 cursor-pointer">
          <input 
            type="checkbox" 
            checked={isPrintLayout} 
            onChange={(e) => setIsPrintLayout(e.target.checked)} 
            className="w-4 h-4"
          />
          {t.layout}
        </label>

        <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
            {t.beautify} {beautyLevel}
          </label>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={beautyLevel} 
            onChange={(e) => setBeautyLevel(parseInt(e.target.value))} 
            className="w-32"
            title="Beautify / Smooth Skin"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
            {t.edgeTrim} {edgeTrim}
          </label>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={edgeTrim} 
            onChange={(e) => setEdgeTrim(parseInt(e.target.value))} 
            className="w-32"
            title="Edge Trim / Blending"
          />
        </div>

        <button 
          onClick={processImage} 
          disabled={!segmenter || !image}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded disabled:opacity-50 transition-colors font-semibold ml-auto"
        >
          {segmenter ? t.btnGenerate : t.btnLoading}
        </button>
      </div>

      <div className="flex gap-8 items-start w-full max-w-5xl justify-center mt-4">
        {image && (
          <div className="flex flex-col items-center flex-1">
            <h2 className="mb-2 font-semibold">{t.originalImg}</h2>
            <ReactCrop crop={crop} onChange={(c) => setCrop(c)} aspect={cropAspect}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                ref={imageRef} 
                src={image} 
                crossOrigin="anonymous" 
                alt="Uploaded" 
                className="max-w-[400px] border shadow-lg rounded"
              />
            </ReactCrop>
          </div>
        )}
        
        <div className="flex flex-col items-center flex-1">
          <h2 className="mb-2 font-semibold flex items-center gap-4">
            {t.resultImg}
            <button
              onClick={handlePrint}
              disabled={!image}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1 text-sm rounded transition-colors"
            >
              {t.btnPrint}
            </button>
            <button
              onClick={handleSave}
              disabled={!image}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1 text-sm rounded transition-colors"
            >
              {t.btnSave}
            </button>
          </h2>
          <div ref={resultContainerRef}>
            <canvas 
              ref={canvasRef} 
              className="border shadow-lg rounded bg-white max-w-full object-contain"
            />
          </div>
        </div>
      </div>

      <div className="w-full max-w-4xl mt-8 bg-gray-900 border border-gray-700 rounded-lg shadow-inner flex flex-col h-48">
        <div className="bg-gray-800 text-gray-300 text-xs font-semibold px-4 py-2 border-b border-gray-700 rounded-t-lg flex justify-between">
          <span>System execution logs</span>
          <button onClick={() => setLogs([])} className="hover:text-white">Clear</button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 font-mono text-sm text-green-400 space-y-1">
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </main>
  );
}