const fs = require('fs');

let content = fs.readFileSync('src/app/passport/page.tsx', 'utf8');

const startStr = '  // Update preview automatically whenever crop or mode changes\\n  useEffect(() => {';
const endStr = '  }, [crop, scanMode, imageSrc, hasAutoCropped]);\\n';

const startIndex = content.indexOf('  // Update preview automatically');
const endIndex = content.indexOf('  }, [crop, scanMode, imageSrc, hasAutoCropped]);') + '  }, [crop, scanMode, imageSrc, hasAutoCropped]);\n'.length;

const oldEffect = content.substring(startIndex, endIndex);

const newEffect = `  const updatePreviewCanvas = useCallback(() => {
    if (!canvasRef.current || !imageRef.current || !anchorPoints || anchorPoints.length !== 4) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!img.complete || img.naturalWidth === 0) return;

    // Calculate dimensions
    const tl = anchorPoints[0];
    const tr = anchorPoints[1];
    const br = anchorPoints[2];
    const bl = anchorPoints[3];

    // Compute max width and height 
    const widthA = Math.hypot(br.x - bl.x, br.y - bl.y);
    const widthB = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const maxWidth = Math.max(widthA, widthB);

    const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
    const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
    const maxHeight = Math.max(heightA, heightB);

    if (maxWidth === 0 || maxHeight === 0) return;

    canvas.width = Math.round(maxWidth);
    canvas.height = Math.round(maxHeight);

    try {
      if (!window.cv || !window.cv.Mat) {
         const ctx = canvas.getContext('2d');
         if (ctx) ctx.drawImage(img, 0, 0);
         return;
      }
      
      const src = window.cv.imread(img);
      const dst = new window.cv.Mat();

      const srcCoords = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [
        tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y
      ]);

      const dstCoords = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [
        0, 0, maxWidth - 1, 0, maxWidth - 1, maxHeight - 1, 0, maxHeight - 1
      ]);

      const M = window.cv.getPerspectiveTransform(srcCoords, dstCoords);
      const dsize = new window.cv.Size(canvas.width, canvas.height);
      
      window.cv.warpPerspective(src, dst, M, dsize, window.cv.INTER_LINEAR, window.cv.BORDER_CONSTANT, new window.cv.Scalar());

      if (scanMode === 'bw') {
          const gray = new window.cv.Mat();
          window.cv.cvtColor(dst, gray, window.cv.COLOR_RGBA2GRAY, 0);
          const mask = new window.cv.Mat();
          window.cv.adaptiveThreshold(gray, mask, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY, 21, 15);
          window.cv.imshow(canvas, mask);
          gray.delete(); mask.delete();
      } else {
          window.cv.imshow(canvas, dst);
      }

      src.delete(); dst.delete(); M.delete(); srcCoords.delete(); dstCoords.delete();
    } catch (e) {
      console.error('Warp Error:', e);
    }
  }, [anchorPoints, scanMode]);

  useEffect(() => {
    if (draggingPoint === null && anchorPoints) {
      updatePreviewCanvas();
    }
  }, [anchorPoints, draggingPoint, scanMode, updatePreviewCanvas]);
`;

content = content.replace(oldEffect, newEffect);
fs.writeFileSync('src/app/passport/page.tsx', content);

console.log('Update successful');
