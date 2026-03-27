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
  const [photoSize, setPhotoSize] = useState<string>('free');
  const [isPrintLayout, setIsPrintLayout] = useState<boolean>(false);
  const [beautyLevel, setBeautyLevel] = useState<number>(0);
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
              'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
            delegate: 'GPU',
          },
          runningMode: 'IMAGE',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
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

    const isGrid = isPrintLayout && photoSize !== 'free';
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

      // Apply mask: For selfie_segmenter, maskData might be 0 for person and non-zero for background, or vice versa.
      // Since it previously colored the person, we reverse the condition.
      for (let i = 0; i < maskData.length; i++) {
        // If the original condition colored the person, we invert it to color the background
        if (maskData[i] !== 0) { 
          // Set background pixels to selected color
          pixels[i * 4] = r;
          pixels[i * 4 + 1] = g;
          pixels[i * 4 + 2] = b;
          pixels[i * 4 + 3] = 255; // fully opaque
        } else if (beautyLevel > 0) {
          // Keep foreground, but apply beautified pixels
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
            <option value="free">{t.sizeFree}</option>
            <option value="1inch">{t.size1Inch}</option>
            <option value="2inch">{t.size2Inch}</option>
          </select>
        </div>
        
        {photoSize !== 'free' && (
          <label className="flex items-center gap-2 text-sm font-medium p-1.5 cursor-pointer">
            <input 
              type="checkbox" 
              checked={isPrintLayout} 
              onChange={(e) => setIsPrintLayout(e.target.checked)} 
              className="w-4 h-4"
            />
            {t.layout}
          </label>
        )}

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