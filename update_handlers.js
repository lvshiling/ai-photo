const fs = require('fs');

let content = fs.readFileSync('src/app/passport/page.tsx', 'utf8');

// --- Replace the bottom half of handleImageUpload ---
const startStr = '            if (maxApproxCorners) {';
const endStr = '    img.src = url;\n  };';
const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr) + endStr.length;

const newHandleImage = `
            if (maxApproxCorners) {
                addLog('Quadrilateral extracted!');
                setAnchorPoints(maxApproxCorners);
            } else if (fallbackBoundingRect) {
                const fx = Math.round(fallbackBoundingRect.x / scale);
                const fy = Math.round(fallbackBoundingRect.y / scale);
                const fw = Math.round(fallbackBoundingRect.width / scale);
                const fh = Math.round(fallbackBoundingRect.height / scale);
                addLog(\`Using bounding rect fallback: x=\${fx}, y=\${fy}, w=\${fw}, h=\${fh}\`);
                setAnchorPoints([
                    { x: fx, y: fy },
                    { x: fx + fw, y: fy },
                    { x: fx + fw, y: fy + fh },
                    { x: fx, y: fy + fh }
                ]);
            } else {
                addLog('Default centered crop.');
                const w = img.naturalWidth;
                const h = img.naturalHeight;
                setAnchorPoints([
                    { x: w * 0.1, y: h * 0.1 },
                    { x: w * 0.9, y: h * 0.1 },
                    { x: w * 0.9, y: h * 0.9 },
                    { x: w * 0.1, y: h * 0.9 }
                ]);
            }
            
            setImageDims({ w: img.naturalWidth, h: img.naturalHeight });
            setImageSrc(url);

            src.delete(); procSrc.delete();
        } catch (err) {
            console.error("CV Processing Error: ", err);
            setImageSrc(url);
            setImageDims({ w: img.naturalWidth, h: img.naturalHeight });
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            setAnchorPoints([
               { x: w * 0.1, y: h * 0.1 },
               { x: w * 0.9, y: h * 0.1 },
               { x: w * 0.9, y: h * 0.9 },
               { x: w * 0.1, y: h * 0.9 }
            ]);
        } finally {
            setIsProcessing(false);
        }
    };
    img.src = url;
  };
`;

content = content.substring(0, startIndex) + newHandleImage + content.substring(endIndex);

// --- Add pointer handlers ---
const handlers = `
  const handleSvgPointerDown = (e: React.PointerEvent, index: number) => {
    e.preventDefault();
    setDraggingPoint(index);
    if (svgRef.current) {
        svgRef.current.setPointerCapture(e.pointerId);
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent) => {
    if (draggingPoint === null || !anchorPoints || !imageDims || !svgRef.current) return;
    
    const svgRect = svgRef.current.getBoundingClientRect();
    const scaleX = imageDims.w / svgRect.width;
    const scaleY = imageDims.h / svgRect.height;
    
    const rawX = (e.clientX - svgRect.left) * scaleX;
    const rawY = (e.clientY - svgRect.top) * scaleY;
    
    const nextPoints = [...anchorPoints];
    nextPoints[draggingPoint] = {
      x: Math.max(0, Math.min(imageDims.w, rawX)),
      y: Math.max(0, Math.min(imageDims.h, rawY))
    };
    setAnchorPoints(nextPoints);
  };

  const handleSvgPointerUp = (e: React.PointerEvent) => {
    setDraggingPoint(null);
    if (svgRef.current) {
         svgRef.current.releasePointerCapture(e.pointerId);
    }
  };

  const generatePDF`;

content = content.replace('  const generatePDF', handlers);

fs.writeFileSync('src/app/passport/page.tsx', content);
console.log('Update 2 done');
